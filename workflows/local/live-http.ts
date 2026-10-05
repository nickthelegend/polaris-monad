/**
 * Send one request a workflow made, for real, synchronously: what the local
 * runners use to answer the CRE SDK's HTTP capability mocks, whose handlers
 * must return at once (the same constraint e2e/helpers/local-evm.ts meets with
 * one `curl` per JSON-RPC call).
 *
 * Each request runs `fetch` in a short-lived Node child. The request, keys
 * included, travels on the child's stdin, never on a command line or in a
 * log; the answer comes back on stdout in the shape the mocks return
 * (status, base64 body, headers). A network failure is an error the workflow
 * sees as one; nothing is ever answered in a provider's place.
 */

import { createRequire } from "node:module";
import type { SentRequest } from "./requests.ts";

const load = createRequire(import.meta.url);
const childProcess = load("node:child_process") as {
  execFileSync(file: string, args: string[], opts: { input: string; encoding: "utf8"; maxBuffer: number; timeout: number }): string;
};

/** What the CRE SDK's HTTP mocks take back: the body base64, headers as value lists. */
export interface MockResponse {
  statusCode: number;
  body: string;
  multiHeaders: Record<string, { values: string[] }>;
}

const FETCH = `
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  const r = JSON.parse(raw);
  try {
    const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, signal: AbortSignal.timeout(r.timeoutMs) });
    const headers = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const body = Buffer.from(await res.arrayBuffer()).toString("base64");
    process.stdout.write(JSON.stringify({ status: res.status, headers, body }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String((e && e.cause && e.cause.code) || (e && e.message) || e) }));
  }
});
`;

/** Only http(s) to a named host: the workflow's requests are provider APIs and public RPCs. */
function checkUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`refusing to send to ${u.protocol} URLs`);
}

export function sendLive(sent: Pick<SentRequest, "url" | "method" | "headers" | "body">, timeoutMs = 10_000): MockResponse {
  checkUrl(sent.url);
  const out = childProcess.execFileSync(process.env.POLARIS_NODE_BIN || "node", ["-e", FETCH], {
    input: JSON.stringify({ url: sent.url, method: sent.method, headers: sent.headers, body: sent.body, timeoutMs }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs + 5_000,
  });
  const r = JSON.parse(out) as { status?: number; headers?: Record<string, string>; body?: string; error?: string };
  // The host only: a provider's URL can carry its key (Etherscan's query string).
  if (r.error !== undefined || r.status === undefined) throw new Error(`${new URL(sent.url).host}: ${r.error ?? "no response"}`);
  return {
    statusCode: r.status,
    body: r.body ?? "",
    multiHeaders: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k, { values: [v] }])),
  };
}
