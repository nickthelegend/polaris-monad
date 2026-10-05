#!/usr/bin/env node
/**
 * The local fallback for CRE's HTTP trigger, for when the CRE CLI isn't
 * logged in (`cre whoami` says so) or a run should stay on this machine:
 *
 *   pnpm --filter @polaris/cre-workflows trigger:local
 *
 * It listens where `cre workflow simulate ./underwriting --listen` would
 * (POST http://127.0.0.1:2000/trigger, body `{ "input": <payload> }`), so
 * Polaris for Business fires it exactly as it fires the CLI:
 * CRE_UNDERWRITING_TRIGGER_URL=http://127.0.0.1:2000/trigger. Each request
 * runs the real `polaris-underwrite` handler (local/underwrite.run.ts) on the
 * CRE SDK's test runtime with Bun:
 *
 * - the account's consent and the history wallet's proof are verified;
 * - the facts are derived by @polarispay/underwriting from the providers
 *   themselves, live: Nansen, Zerion and Etherscan with the keys below, and
 *   the public RPCs. A provider without its key is not configured: it is never
 *   called, what only it reads is absent (no points), and when that leaves
 *   nothing to attest the workflow says "unavailable" and its callback names
 *   the missing key. Nothing answers in a provider's place, so a fresh local
 *   account is underwritten as what it is: new;
 * - a report goes through the local chain's MockKeystoneForwarder, and
 *   ScoreManager scores it and opens the line on chain;
 * - the workflow's signed callback is posted to the API.
 *
 * Environment:
 *   POLARIS_LOCAL_RPC             the local node (default http://127.0.0.1:8545)
 *   POLARIS_LOCAL_DEPLOYMENT      its deployment record (default packages/contracts/deployments/monad-local.json)
 *   POLARIS_LOCAL_TRIGGER_PORT    default 2000
 *   POLARIS_CALLBACK_URL          where the callback goes (e.g. http://localhost:3100/api/cre/callback)
 *   POLARIS_CALLBACK_SECRET       its HMAC secret (= the API's POLARIS_CRE_CALLBACK_SECRET)
 *   NANSEN_API_KEY, ZERION_API_KEY, ETHERSCAN_API_KEY
 *                                 the providers' keys, from the environment or workflows/.env;
 *                                 each one unset is reported as not configured (never printed)
 *
 * Local chains only: it refuses an RPC that isn't on loopback, and it holds
 * no chain key (the node's unlocked deployer account delivers the report, as
 * the CRE simulator's transmitter key would). The provider calls are reads.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { runBun } from "./bun.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(ROOT, "..");
const RPC = process.env.POLARIS_LOCAL_RPC || "http://127.0.0.1:8545";
const DEPLOYMENT = process.env.POLARIS_LOCAL_DEPLOYMENT || join(REPO, "packages", "contracts", "deployments", "monad-local.json");
const PORT = Number(process.env.POLARIS_LOCAL_TRIGGER_PORT || 2000);
const CALLBACK_URL = process.env.POLARIS_CALLBACK_URL || "";
const CALLBACK_SECRET = process.env.POLARIS_CALLBACK_SECRET || "";

/** The providers' keys: the environment first, then workflows/.env. Values stay in memory and the child's environment. */
const PROVIDER_KEY_NAMES = ["NANSEN_API_KEY", "ZERION_API_KEY", "ETHERSCAN_API_KEY"];
function providerKeys(env = process.env, file = join(ROOT, ".env")) {
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const out = {};
  for (const name of PROVIDER_KEY_NAMES) {
    const v = (env[name] || fromFile[name] || "").trim();
    if (v) out[name] = v;
  }
  return out;
}
/** "nansen: not configured (NANSEN_API_KEY), zerion: live, …": names only, never values. */
function describeProviders(keys) {
  return PROVIDER_KEY_NAMES.map((n) => `${n.split("_")[0].toLowerCase()}: ${keys[n] ? "live" : `not configured (${n})`}`).join(", ");
}
const KEYS = providerKeys();

const host = new URL(RPC).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`POLARIS_LOCAL_RPC must be a local node (got ${RPC}); the local trigger never writes to a public chain.`);
  process.exit(1);
}

const log = (msg) => console.log(`[cre local] ${msg}`);

/** Run the workflow handler once, in Bun, and read what it did. */
function runOnce(input) {
  const dir = mkdtempSync(join(tmpdir(), "polaris-cre-trigger-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  writeFileSync(
    inFile,
    JSON.stringify({
      rpc: RPC,
      deploymentFile: DEPLOYMENT,
      callback: CALLBACK_URL ? { url: CALLBACK_URL, secret: CALLBACK_SECRET } : null,
      input,
    }),
  );
  try {
    // Only the keys found are passed; one left out is not configured in the run.
    const env = { ...process.env, LOCAL_TRIGGER_IN: inFile, LOCAL_TRIGGER_OUT: outFile };
    for (const name of PROVIDER_KEY_NAMES) delete env[name];
    const r = runBun(["--conditions=source", "test", "--timeout", "120000", "./local/underwrite.run.ts"], {
      env: { ...env, ...KEYS },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    let out = null;
    try {
      out = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      // no result: the run failed before writing one
    }
    if (!out) {
      const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-25).join("\n");
      throw new Error(`the workflow run failed (bun exit ${r.status}):\n${tail}`);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deliver(callbacks) {
  for (const c of callbacks) {
    try {
      const res = await fetch(c.url, {
        method: "POST",
        headers: { "content-type": "application/json", "polaris-signature": c.signature },
        body: c.body,
        signal: AbortSignal.timeout(10_000),
      });
      log(`callback ${JSON.parse(c.body).type} -> ${res.status}`);
    } catch (error) {
      log(`callback to ${c.url} failed: ${error.message}`);
    }
  }
}

/** One run at a time, in arrival order (CRE fires an HTTP trigger once per 30 s; the API spaces them too). */
let queue = Promise.resolve();

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/trigger")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "POST /trigger" }));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) req.destroy();
  });
  req.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw).input;
      if (!input || typeof input !== "object" || typeof input.user !== "string") throw new Error("no input.user");
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `body must be {"input": payload}: ${error.message}` }));
      return;
    }
    // Accepted now and run in order: the API's call to the trigger has a short timeout.
    res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
    queue = queue.then(async () => {
      log(`underwriting ${input.user}${input.linked?.wallet ? ` with history ${input.linked.wallet}` : ""} (${describeProviders(KEYS)})`);
      try {
        const out = runOnce(input);
        const r = out.result;
        const score = r.onChainScore !== null && r.onChainScore !== undefined ? ` (score ${r.onChainScore})` : "";
        log(`-> ${r.status}${score}${r.reason ? `: ${r.reason}` : ""}${r.txHash ? ` tx ${r.txHash}` : ""}`);
        if (r.notConfigured?.length) log(`   not configured: ${r.notConfigured.join(", ")}; absent: ${r.absent?.join(", ") || "nothing"}`);
        await deliver(out.callbacks);
      } catch (error) {
        log(`run failed: ${error.message}`);
      }
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${PORT}/trigger (chain ${RPC}; providers live with their keys: ${describeProviders(KEYS)})`);
  if (!CALLBACK_URL) log("POLARIS_CALLBACK_URL is not set: decisions reach the chain, but the API won't hear about them");
});
