#!/usr/bin/env node
/**
 * How much gas a CRE report delivery really needs on Monad testnet, against
 * what `eth_estimateGas` says. Read-only: `eth_estimateGas`, `eth_call` and
 * `debug_traceCall`; nothing is signed or sent.
 *
 *   pnpm --filter @polaris/cre-workflows report-gas              # a table
 *   pnpm --filter @polaris/cre-workflows report-gas --json <file>
 *
 * Every report goes through Chainlink's MockKeystoneForwarder (the record's
 * `cre.forwarder`) from the recorded simulation transmitter (the receivers
 * check `tx.origin`), shaped as the CRE CLI sends it: the 109-byte header, a
 * 96-byte report context and four 65-byte signatures. For each one:
 *
 *   estimate  `eth_estimateGas` of `forwarder.report(...)`: what
 *             `estimateDelivery` in src/shared/evm.ts gets;
 *   needed    the smallest gas limit at which the forwarder's `route` call
 *             returns true (the receiver ran to its end), by bisecting
 *             `debug_traceCall` at that limit, to the unit;
 *   receiver  the gas `onReport` itself used, traced with room to spare.
 *
 * It also asks for the estimate the workflows use behind the production
 * forwarder, `onReport` sent from the forwarder's address, which the
 * receivers refuse while a simulation transmitter is set.
 *
 * Two sets: the three deliveries in evidence/2026-09-28 replayed at their
 * parent blocks (there the estimate equals the one the run logged), and
 * reports built now with the workflows' own encoders against the latest
 * block: collections (collect, collect + liquidate, skips, a batch),
 * underwriting (a new buyer, a buyer with a linked wallet, a thin file) and
 * the guardian (a healthy attestation, a pause, a refusal).
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectionsReceiverAbi,
  guardianReceiverAbi,
  underwritingReceiverAbi,
} from "@polarispay/contracts/abi";
import {
  concat,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  sha256,
  stringToHex,
  toHex,
} from "viem";
import { encodeCollectionsReport } from "../src/collections/tasks.ts";
import { buildAttestation, encodeGuardianReport } from "../src/guardian/attestation.ts";
import { encodeUnderwritingReport } from "../src/underwriting/report.ts";

const RPC = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const record = JSON.parse(readFileSync(fileURLToPath(new URL("../../packages/contracts/deployments/monad-testnet.json", import.meta.url)), "utf8"));
const runs = JSON.parse(readFileSync(fileURLToPath(new URL("../evidence/2026-09-28/runs.json", import.meta.url)), "utf8"));

const FORWARDER = record.cre.forwarder;
const TRANSMITTER = record.cre.simulationTransmitter;
const C = Object.fromEntries(Object.entries(record.contracts).map(([k, v]) => [k, v.address]));

const FORWARDER_ABI = parseAbi([
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
]);
const READ_ABI = parseAbi([
  "function poolState() view returns ((uint256 freeCash, uint256 totalOwed, uint256 badDebt, uint256 totalOriginated))",
  "function thresholds() view returns ((int256 minPrice, int256 maxPrice, uint256 minFreeCash, uint16 maxBadDebtBps, uint256 minOriginated, uint32 maxPriceAge))",
  "function badDebtAcknowledged() view returns (uint256)",
  "function latestAttestation() view returns ((uint80 priceRoundId, int256 price, uint64 priceUpdatedAt, uint256 freeCash, uint256 totalOwed, uint256 badDebt, uint256 totalOriginated, uint64 observedAt, bool creditPaused, uint8 reasons))",
]);
const ROUTE_SELECTOR = "0x233fd52d";

let id = 0;
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const j = await res.json();
  if (j.error) {
    const e = new Error(`${method}: ${j.error.message}`);
    e.data = j.error.data;
    throw e;
  }
  return j.result;
}

async function read(address, functionName, block) {
  const data = encodeFunctionData({ abi: READ_ABI, functionName });
  const out = await rpc("eth_call", [{ to: address, data }, block]);
  return decodeFunctionResult({ abi: READ_ABI, functionName, data: out });
}

/** The 109-byte header the CLI's simulator writes, then the body. */
function rawReport(body, workflowName, timestamp) {
  return concat([
    "0x01",
    toHex(randomBytes(32)), // execution id
    numberToHex(timestamp, { size: 4 }),
    numberToHex(100, { size: 4 }), // DON id
    numberToHex(1, { size: 4 }), // config version
    `0x${"11".repeat(32)}`, // workflow id
    stringToHex(sha256(stringToHex(workflowName)).slice(2, 12)),
    `0x${"aa".repeat(20)}`, // workflow owner
    "0x0001", // report id
    body,
  ]);
}

function deliveryData(receiver, body, workflowName, timestamp) {
  return encodeFunctionData({
    abi: FORWARDER_ABI,
    functionName: "report",
    args: [receiver, rawReport(body, workflowName, timestamp), toHex(randomBytes(96)), [0, 1, 2, 3].map(() => toHex(randomBytes(65)))],
  });
}

/** The forwarder's `route` frame and the receiver's frame in a callTracer trace. */
function frames(trace) {
  const route = (trace.calls ?? []).find((c) => c.input.startsWith(ROUTE_SELECTOR));
  const receiver = route?.calls?.find((c) => c.type === "CALL");
  return { route, receiver };
}

async function trace(data, gas, block, withLog = false) {
  return rpc("debug_traceCall", [{ from: TRANSMITTER, to: FORWARDER, data, gas: numberToHex(gas) }, block, { tracer: "callTracer", tracerConfig: { withLog } }]);
}

const RECEIVER_EVENTS = [...collectionsReceiverAbi, ...underwritingReceiverAbi, ...guardianReceiverAbi].filter((x) => x.type === "event");

/** The receiver's own events in a traced delivery, by name, e.g. "TaskExecuted ×3, CollectionsRun". */
function receiverEvents(t, receiver) {
  const all = (c) => [...(c.logs ?? []), ...(c.calls ?? []).flatMap(all)];
  const names = [];
  for (const log of all(t)) {
    if (log.address.toLowerCase() !== receiver.toLowerCase()) continue;
    try {
      names.push(decodeEventLog({ abi: RECEIVER_EVENTS, data: log.data, topics: log.topics }).eventName);
    } catch {
      names.push("?");
    }
  }
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
}

/** Delivered at this limit: the transaction did not fail and `route` returned true. */
async function delivered(data, gas, block) {
  const t = await trace(data, gas, block);
  if (t.error) return false;
  const { route } = frames(t);
  return Boolean(route && !route.error && route.output && BigInt(route.output) === 1n);
}

async function measure(label, receiver, data, block) {
  const estimate = BigInt(await rpc("eth_estimateGas", [{ from: TRANSMITTER, to: FORWARDER, data }, block]));
  const roomy = await trace(data, 3_000_000, block, true);
  const { receiver: rf } = frames(roomy);
  const events = receiverEvents(roomy, receiver);
  if (!(await delivered(data, 3_000_000, block))) {
    return { label, receiver, estimate, needed: null, receiverGas: rf ? BigInt(rf.gasUsed) : null, events, note: "not delivered even at 3,000,000" };
  }
  let lo = 21_000n; // fails
  let hi = 3_000_000n; // delivers
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await delivered(data, mid, block)) hi = mid;
    else lo = mid;
  }
  const atEstimate = await delivered(data, estimate, block);
  return { label, receiver, estimate, needed: hi, receiverGas: BigInt(rf.gasUsed), events, deliveredAtEstimate: atEstimate };
}

async function replays() {
  const out = [];
  for (const run of runs) {
    for (const tx of run.txs ?? []) {
      const t = await rpc("eth_getTransactionByHash", [tx.hash]);
      const { args } = decodeFunctionData({ abi: FORWARDER_ABI, data: t.input });
      const parent = numberToHex(BigInt(t.blockNumber) - 1n);
      const m = await measure(`replay: ${run.workflow} (${run.result?.tasks?.map((x) => `${x.action} #${x.id}`).join(", ") || run.result?.why || ""})`, args[0], t.input, parent);
      out.push({ ...m, sentLimit: BigInt(t.gas) });
    }
  }
  return out;
}

const facts = (now, over = {}) => ({
  walletAgeDays: 400,
  txCount: 120,
  stableBalance: 2_500_000_000n,
  defiTenureDays: 200,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: true,
  observedAt: now,
  ...over,
});

const addr = () => toHex(randomBytes(20));

async function current() {
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const block = head.number;
  const now = BigInt(head.timestamp);
  const ts = Number(now);
  const out = [];

  const coll = (label, tasks) =>
    measure(`collections: ${label}`, C.CollectionsReceiver, deliveryData(C.CollectionsReceiver, encodeCollectionsReport(tasks), "polaris-collections", ts), block);
  out.push(await coll("collect #2 (due)", [{ action: 1, id: 2n }]));
  out.push(await coll("collect #2, liquidate #2", [{ action: 1, id: 2n }, { action: 3, id: 2n }]));
  out.push(await coll("charge #1 (not due: skipped)", [{ action: 2, id: 1n }]));
  out.push(await coll("collect #1 (not due: skipped)", [{ action: 1, id: 1n }]));
  const collect2 = { action: 1, id: 2n };
  const skips = (n) => Array.from({ length: n }, (_, i) => ({ action: [1, 2, 3][i % 3], id: 1n }));
  out.push(await coll("3 × collect #2 (three instalments due)", [collect2, collect2, collect2]));
  out.push(await coll("25 tasks: 3 × collect #2, then 22 skips", [collect2, collect2, collect2, ...skips(22)]));
  out.push(await coll("25 tasks: 22 skips, then 3 × collect #2", [...skips(22), collect2, collect2, collect2]));
  out.push(
    await coll(
      "8 tasks: collect #2, liquidate #2, 6 skips",
      [
        { action: 1, id: 2n },
        { action: 3, id: 2n },
        { action: 1, id: 1n },
        { action: 3, id: 1n },
        { action: 2, id: 1n },
        { action: 1, id: 1n },
        { action: 2, id: 1n },
        { action: 3, id: 1n },
      ],
    ),
  );

  const uw = (label, items) =>
    measure(`underwriting: ${label}`, C.UnderwritingReceiver, deliveryData(C.UnderwritingReceiver, encodeUnderwritingReport(items), "polaris-underwrite", ts), block);
  out.push(await uw("a new buyer", [{ user: addr(), linkedWallet: null, facts: facts(now) }]));
  out.push(await uw("a new buyer with a linked wallet", [{ user: addr(), linkedWallet: addr(), facts: facts(now) }]));
  out.push(await uw("a thin file (refused)", [{ user: addr(), linkedWallet: null, facts: facts(now, { walletAgeDays: 3, txCount: 2, defiTenureDays: 0 }) }]));

  const [pool, t, ack, latest] = await Promise.all([
    read(C.PolarisLoanEngine, "poolState", block),
    read(C.GuardianReceiver, "thresholds", block),
    read(C.GuardianReceiver, "badDebtAcknowledged", block),
    read(C.GuardianReceiver, "latestAttestation", block),
  ]);
  const thresholds = { ...t, maxBadDebtBps: Number(t.maxBadDebtBps), maxPriceAge: Number(t.maxPriceAge) };
  const g = (label, price) => {
    const a = buildAttestation({ round: { roundId: (1n << 64n) + 7_000n, answer: price, updatedAt: now - 60n }, pool, observedAt: now }, thresholds, ack);
    return measure(`guardian: ${label}`, C.GuardianReceiver, deliveryData(C.GuardianReceiver, encodeGuardianReport(a), "polaris-guardian", ts), block);
  };
  out.push(await g("a healthy attestation (a new round)", 100_000_000n));
  out.push(await g("a depeg pause (a new round)", 98_000_000n));
  const stale = buildAttestation({ round: { roundId: 1n, answer: 100_000_000n, updatedAt: latest.observedAt - 60n }, pool, observedAt: latest.observedAt }, thresholds, ack);
  out.push(await measure("guardian: out of order (refused)", C.GuardianReceiver, deliveryData(C.GuardianReceiver, encodeGuardianReport(stale), "polaris-guardian", ts), block));
  return { block: BigInt(block), out };
}

/** `eth_estimateGas` of `onReport` from the forwarder's address: what `estimateOnReport` would ask. */
async function onReportFromForwarder(block) {
  const data = encodeFunctionData({
    abi: parseAbi(["function onReport(bytes metadata, bytes report)"]),
    functionName: "onReport",
    args: [`0x${"11".repeat(64)}`, encodeCollectionsReport([{ action: 1, id: 2n }])],
  });
  try {
    return `estimated ${BigInt(await rpc("eth_estimateGas", [{ from: FORWARDER, to: C.CollectionsReceiver, data }, block]))}`;
  } catch (e) {
    return `${e.message} ${e.data ?? ""}`.trim();
  }
}

async function main() {
  const rows = [];
  rows.push(...(await replays()));
  const cur = await current();
  rows.push(...cur.out);
  const fromForwarder = await onReportFromForwarder(numberToHex(cur.block));
  const fmt = (v) => (v === null || v === undefined ? "" : Number(v).toLocaleString("en-US"));
  console.log(`Monad testnet, latest block ${cur.block} (replays at their parent blocks)`);
  console.log(["report", "estimate", "needed", "needed − estimate", "needed / estimate", "receiver used", "delivered at estimate", "receiver events"].join(" | "));
  for (const r of rows) {
    const gap = r.needed === null ? null : r.needed - r.estimate;
    const ratio = r.needed === null ? "" : (Number(r.needed) / Number(r.estimate)).toFixed(4);
    console.log([r.label, fmt(r.estimate), fmt(r.needed), fmt(gap), ratio, fmt(r.receiverGas), r.deliveredAtEstimate ?? r.note, r.events].join(" | "));
  }
  console.log(`CollectionsReceiver.onReport estimated from the forwarder's address: ${fromForwarder}`);
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], `${JSON.stringify({ rpc: RPC, forwarder: FORWARDER, transmitter: TRANSMITTER, block: cur.block, measuredAt: new Date().toISOString(), onReportFromForwarder: fromForwarder, rows }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
}

await main();
