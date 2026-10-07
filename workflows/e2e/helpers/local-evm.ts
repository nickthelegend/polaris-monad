/**
 * The EVM capability, answered by a real chain: a local Hardhat node.
 *
 * CRE capability calls are synchronous (`.result()`), so this bridge speaks
 * JSON-RPC synchronously, one `curl` per call. It plays what
 * `cre workflow simulate --broadcast` plays (the CLI's FakeEVMChain):
 *
 *   callContract / estimateGas   eth_call / eth_estimateGas, at the block asked for ("finalized"
 *                                reads the head: a local node has no lag; a number reads that block).
 *                                An estimate of a delivery (`forwarder.report(...)`) is the gas a
 *                                traced delivery uses with room to spare (`tracedDeliveryGas`), not
 *                                eth_estimateGas: Chainlink's MockKeystoneForwarder catches the
 *                                receiver's revert cheaply, so on a fork of Monad testnet an
 *                                estimate settles where the receiver runs out of gas inside the
 *                                catch and the delivery still lands (packages/contracts README,
 *                                "Rehearse real AUSD on a fork"). Like Monad testnet's own
 *                                eth_estimateGas (measured: workflows/evidence/gas/), the traced
 *                                gas covers the delivered path but not the EIP-150 hold-back of
 *                                the frames above the receiver, which the workflow adds
 *                                (src/shared/evm.ts `deliveryGas`).
 *   headerByNumber               eth_getBlockByNumber: number and timestamp
 *   writeReport                  MockKeystoneForwarder.report(receiver, rawReport, context, sigs),
 *                                sent by the broadcasting key with the workflow's gas limit, and
 *                                reported as SUCCESS whenever the transaction landed, even if the
 *                                receiver reverted inside it: exactly the simulator's masking,
 *                                which the workflows must see through.
 *   getTransactionReceipt        eth_getTransactionReceipt
 *
 * `logTriggerPayload` builds what an EVM log trigger hands its handler from a
 * real receipt, as `cre workflow simulate --evm-tx-hash <tx> --evm-event-index <i>`
 * does from Monad testnet.
 */

import { blockNumber, type EVMLog, hexToBase64, protoBigIntToBigint } from "@chainlink/cre-sdk";
import type { EvmMock } from "@chainlink/cre-sdk/test";
import { type Address, encodeFunctionData, type Hex, hexToBytes, numberToBytes, parseAbi, toFunctionSelector } from "viem";
import { childProcess } from "../../test/helpers/host.ts";

const hex = (bytes: Uint8Array | undefined): Hex => `0x${Buffer.from(bytes ?? new Uint8Array()).toString("hex")}`;

export function rpcSync<T = unknown>(url: string, method: string, params: unknown[] = []): T {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
  const out = childProcess.execFileSync("curl", ["-s", "-S", "-X", "POST", "-H", "content-type: application/json", "--data-binary", "@-", url], {
    input: body,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const res = JSON.parse(out) as { result?: T; error?: { message: string; data?: unknown } };
  if (res.error) {
    const e = new Error(`${method}: ${res.error.message}`) as Error & { data?: unknown };
    e.data = res.error.data;
    throw e;
  }
  return res.result as T;
}

const FORWARDER_ABI = parseAbi(["function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)"]);
const REPORT_SELECTOR = toFunctionSelector(FORWARDER_ABI[0]);

/**
 * A sent transaction's receipt. A Hardhat node has it when eth_sendTransaction
 * returns; an anvil fork may still be mining it (it fetches the forked state
 * the block touches), so wait for it, synchronously, up to `timeoutMs`.
 */
export function receiptOf(url: string, hash: Hex, timeoutMs = 120_000): RpcReceipt {
  const started = Date.now();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const receipt = rpcSync<RpcReceipt | null>(url, "eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    if (Date.now() - started > timeoutMs) throw new Error(`no receipt for ${hash} after ${timeoutMs / 1000} s`);
    Atomics.wait(pause, 0, 0, 200);
  }
}

/** Gas a traced call may spend: room for any report the receivers take. */
const TRACE_GAS = 5_000_000n;

/**
 * The gas a delivery through the forwarder uses on the path where the
 * receiver has all the gas it wants: `debug_traceCall` with TRACE_GAS, its
 * `gasUsed`. The workflow's own headroom then applies, as it would to an
 * estimate. Null when the node can't trace (the caller falls back to
 * eth_estimateGas).
 */
export function tracedDeliveryGas(url: string, msg: { from: Hex; to: Hex; data: Hex }): bigint | null {
  try {
    const trace = rpcSync<{ gasUsed?: Hex }>(url, "debug_traceCall", [{ ...msg, gas: `0x${TRACE_GAS.toString(16)}` }, "latest", { tracer: "callTracer" }]);
    return trace?.gasUsed ? BigInt(trace.gasUsed) : null;
  } catch {
    return null;
  }
}

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: Hex;
  transactionIndex: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  blockHash: Hex;
}
export interface RpcReceipt {
  status: Hex;
  blockNumber: Hex;
  gasUsed: Hex;
  transactionIndex: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  logs: RpcLog[];
}

export interface BridgeRecord {
  writes: Array<{ receiver: Address; txHash: Hex; gasLimit: bigint; gasUsed: bigint; body: Hex }>;
  reads: number;
  /** The block tag or number of every eth_call, in order. */
  blocks: string[];
}

/**
 * The JSON-RPC block for a capability request's block number: the negative
 * sentinels (LATEST -2, LAST_FINALIZED -3) are the head on a local node, a
 * positive number is that block.
 */
function blockTag(b: { absVal: Uint8Array; sign: bigint } | undefined): string {
  if (!b || b.sign < 0n) return "latest";
  return `0x${protoBigIntToBigint(b).toString(16)}`;
}

/** Route the SDK's EVM mock to the node at `url`. */
export function bridgeEvm(evm: EvmMock, p: { url: string; forwarder: Address; transmitter: Address }): BridgeRecord {
  const record: BridgeRecord = { writes: [], reads: 0, blocks: [] };
  evm.callContract = (req) => {
    record.reads++;
    const tag = blockTag(req.blockNumber);
    record.blocks.push(tag);
    const result = rpcSync<Hex>(p.url, "eth_call", [{ from: hex(req.call?.from), to: hex(req.call?.to), data: hex(req.call?.data) }, tag]);
    return { data: hexToBase64(result) };
  };
  evm.headerByNumber = (req) => {
    record.reads++;
    const b = rpcSync<{ number: Hex; timestamp: Hex; hash: Hex; parentHash: Hex }>(p.url, "eth_getBlockByNumber", [blockTag(req.blockNumber), false]);
    return {
      header: { timestamp: BigInt(b.timestamp).toString(), blockNumber: blockNumber(BigInt(b.number)), hash: hexToBase64(b.hash), parentHash: hexToBase64(b.parentHash) },
    };
  };
  evm.estimateGas = (req) => {
    record.reads++;
    const msg = { from: hex(req.msg?.from), to: hex(req.msg?.to), data: hex(req.msg?.data) };
    if (msg.to.toLowerCase() === p.forwarder.toLowerCase() && msg.data.startsWith(REPORT_SELECTOR)) {
      const traced = tracedDeliveryGas(p.url, msg);
      if (traced !== null) return { gas: traced.toString() };
    }
    const gas = rpcSync<Hex>(p.url, "eth_estimateGas", [msg]);
    return { gas: BigInt(gas).toString() };
  };
  evm.writeReport = (req) => {
    const receiver = hex(req.receiver) as Address;
    const raw = hex(req.report?.rawReport);
    const sigs = (req.report?.sigs ?? []).map((s) => hex(s.signature));
    const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: "report", args: [receiver, raw, hex(req.report?.reportContext), sigs] });
    const gasLimit = req.gasConfig?.gasLimit ?? 0n;
    const txHash = rpcSync<Hex>(p.url, "eth_sendTransaction", [{ from: p.transmitter, to: p.forwarder, data, gas: gasLimit }]);
    const receipt = receiptOf(p.url, txHash);
    record.writes.push({ receiver, txHash, gasLimit, gasUsed: BigInt(receipt.gasUsed), body: `0x${raw.slice(2 + 218)}` });
    return {
      txStatus: receipt.status === "0x1" ? "TX_STATUS_SUCCESS" : "TX_STATUS_REVERTED",
      receiverContractExecutionStatus: "RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS",
      txHash: hexToBase64(txHash),
    };
  };
  evm.getTransactionReceipt = (req) => {
    record.reads++;
    const r = receiptOf(p.url, hex(req.hash));
    return {
      receipt: {
        status: BigInt(r.status).toString(),
        gasUsed: BigInt(r.gasUsed).toString(),
        txIndex: BigInt(r.transactionIndex).toString(),
        blockHash: hexToBase64(r.blockHash),
        txHash: hexToBase64(r.transactionHash),
        logs: r.logs.map((l) => ({
          address: hexToBase64(l.address),
          topics: l.topics.map((t) => hexToBase64(t)),
          data: hexToBase64(l.data),
          txHash: hexToBase64(l.transactionHash),
          blockHash: hexToBase64(l.blockHash),
          txIndex: Number(BigInt(l.transactionIndex)),
          index: Number(BigInt(l.logIndex)),
          removed: false,
        })),
      },
    };
  };
  return record;
}

/**
 * A public chain's EVM capability for reads only: the guardian's second EVM
 * client, which reads Chainlink's AUSD/USD on Monad mainnet. `callContract`
 * and `headerByNumber` go to `url` (the "last finalized" sentinel reads the
 * chain's `finalized` block, as the DON would); anything that writes or
 * estimates a write throws, so a local run can never send a transaction to a
 * public chain. The node must answer `eth_chainId` with `chainId`.
 */
export function bridgeReadOnlyEvm(evm: EvmMock, p: { url: string; chainId: number }): { reads: number } {
  const chain = Number(BigInt(rpcSync<Hex>(p.url, "eth_chainId")));
  if (chain !== p.chainId) throw new Error(`${p.url} is chain ${chain}, not ${p.chainId}`);
  const record = { reads: 0 };
  const tag = (b: { absVal: Uint8Array; sign: bigint } | undefined): string => {
    if (!b) return "finalized";
    if (b.sign < 0n) return protoBigIntToBigint(b) === -2n ? "latest" : "finalized";
    return `0x${protoBigIntToBigint(b).toString(16)}`;
  };
  evm.callContract = (req) => {
    record.reads++;
    const result = rpcSync<Hex>(p.url, "eth_call", [{ to: hex(req.call?.to), data: hex(req.call?.data) }, tag(req.blockNumber)]);
    return { data: hexToBase64(result) };
  };
  evm.headerByNumber = (req) => {
    record.reads++;
    const b = rpcSync<{ number: Hex; timestamp: Hex; hash: Hex; parentHash: Hex }>(p.url, "eth_getBlockByNumber", [tag(req.blockNumber), false]);
    return {
      header: { timestamp: BigInt(b.timestamp).toString(), blockNumber: blockNumber(BigInt(b.number)), hash: hexToBase64(b.hash), parentHash: hexToBase64(b.parentHash) },
    };
  };
  const refuse = (what: string) => () => {
    throw new Error(`${what} on chain ${p.chainId}: this bridge only reads (a local run never writes to a public chain)`);
  };
  evm.writeReport = refuse("writeReport");
  evm.estimateGas = refuse("estimateGas");
  return record;
}

/**
 * What an EVM log trigger hands its handler, from a landed transaction's
 * receipt: the log at `index` among the receipt's logs (the simulator's
 * `--evm-event-index` counts the same way), with its transaction, block and
 * position.
 */
export function logTriggerPayload(receipt: RpcReceipt, index: number): EVMLog {
  const l = receipt.logs[index];
  if (!l) throw new Error(`event index ${index} out of range, transaction has ${receipt.logs.length} log events`);
  return {
    address: hexToBytes(l.address),
    topics: l.topics.map((t) => hexToBytes(t)),
    txHash: hexToBytes(l.transactionHash),
    blockHash: hexToBytes(l.blockHash),
    data: hexToBytes(l.data),
    eventSig: hexToBytes(l.topics[0] ?? "0x"),
    blockNumber: { absVal: numberToBytes(BigInt(l.blockNumber)), sign: 1n },
    txIndex: Number(BigInt(l.transactionIndex)),
    index: Number(BigInt(l.logIndex)),
    removed: false,
  } as unknown as EVMLog;
}

/** A block's timestamp in unix seconds. */
export function blockTime(url: string, block: Hex | "latest"): number {
  return Number(BigInt(rpcSync<{ timestamp: Hex }>(url, "eth_getBlockByNumber", [block, false]).timestamp));
}

/** The latest block's timestamp, in milliseconds: the DON clock the runtime should show. */
export function chainNowMs(url: string): number {
  const block = rpcSync<{ timestamp: Hex }>(url, "eth_getBlockByNumber", ["latest", false]);
  return Number(BigInt(block.timestamp)) * 1000;
}

export function travel(url: string, seconds: number): void {
  rpcSync(url, "evm_increaseTime", [seconds]);
  rpcSync(url, "evm_mine", []);
}

/** Send a transaction from an unlocked node account and require it to succeed. */
export function sendTx(url: string, tx: { from: Address; to: Address; data: Hex }): RpcReceipt {
  const hash = rpcSync<Hex>(url, "eth_sendTransaction", [tx]);
  const receipt = receiptOf(url, hash);
  if (receipt.status !== "0x1") throw new Error(`transaction to ${tx.to} reverted`);
  return receipt;
}

export function call(url: string, to: Address, data: Hex): Hex {
  return rpcSync<Hex>(url, "eth_call", [{ to, data }, "latest"]);
}
