/**
 * One run of the `polaris-underwrite` workflow handler on the CRE SDK's test
 * runtime, against a local chain. `scripts/local-trigger.mjs` runs this file
 * with `bun test` for each trigger request (the SDK's capability mocks exist
 * only inside its `test()` scope), then posts the callback it captured.
 *
 * It is the workflow code `cre workflow build` compiles, run as
 * `cre workflow simulate --broadcast` would run it:
 *
 * - EVM: the local node (e2e/helpers/local-evm.ts), reports delivered through
 *   the deployment's MockKeystoneForwarder by its simulation transmitter;
 * - HTTP and Confidential HTTP (staging's `confidentialHttp`): the providers
 *   themselves, live (./live-http.ts), with the keys from this process's
 *   environment: NANSEN_API_KEY, ZERION_API_KEY, ETHERSCAN_API_KEY
 *   (local-trigger.mjs reads workflows/.env). A provider without its key is
 *   not configured: the workflow never calls it, the evidence only it reads
 *   is absent, and the result names it. Nothing answers in a provider's
 *   place, so an account the providers know nothing about is underwritten as
 *   exactly that;
 * - the signed callback: captured, and returned for the server to deliver.
 *
 * Input and output are files named in the environment (LOCAL_TRIGGER_IN,
 * LOCAL_TRIGGER_OUT), so nothing about a request, and no key, is on the
 * command line.
 */

import { expect } from "bun:test";
import type { HTTPPayload } from "@chainlink/cre-sdk";
import { cre } from "@chainlink/cre-sdk";
import { ConfidentialHttpMock, EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { join } from "node:path";
import type { Address } from "viem";
import { bridgeEvm } from "../e2e/helpers/local-evm.ts";
import { configSchema, onHttpTrigger } from "../src/underwriting/workflow.ts";
import { fs } from "../test/helpers/host.ts";
import { sendLive } from "./live-http.ts";
import { type ConfidentialRequestLike, type CreRequestLike, type SentRequest, toSent, toSentConfidential } from "./requests.ts";

type Job = {
  rpc: string;
  deploymentFile: string;
  callback: { url: string; secret: string } | null;
  input: { user: Address; linked?: { wallet: Address } | null };
};

type Deployment = {
  chainId: number;
  deployer: Address;
  contracts: Record<string, { address: Address }>;
};

const IN = process.env.LOCAL_TRIGGER_IN ?? "";
const OUT = process.env.LOCAL_TRIGGER_OUT ?? "";

/** A provider's key from the environment, or null: not configured. */
const keyOf = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

test("local underwriting trigger", async () => {
  expect(IN && OUT).toBeTruthy();
  const job = JSON.parse(fs.readFileSync(IN, "utf8")) as Job;
  const d = JSON.parse(fs.readFileSync(job.deploymentFile, "utf8")) as Deployment;
  const at = (name: string) => {
    const a = d.contracts[name]?.address;
    if (!a) throw new Error(`the deployment has no ${name}`);
    return a;
  };

  const keys = { nansen: keyOf("NANSEN_API_KEY"), zerion: keyOf("ZERION_API_KEY"), etherscan: keyOf("ETHERSCAN_API_KEY") };
  // What the Vault DON would hold. Zerion's is the ready-made Basic credential (see evidence.ts).
  const vault: Record<string, string> = {};
  if (keys.nansen) vault.NANSEN_API_KEY = keys.nansen;
  if (keys.zerion) vault.ZERION_BASIC_AUTH = Buffer.from(`${keys.zerion}:`, "utf8").toString("base64");
  if (keys.etherscan) vault.ETHERSCAN_API_KEY = keys.etherscan;

  const staging = JSON.parse(fs.readFileSync(join(import.meta.dir, "..", "underwriting", "config.staging.json"), "utf8"));
  const CALLBACK_SECRET_ID = "POLARIS_CALLBACK_SECRET";
  const config = configSchema.parse({
    ...staging,
    receiver: at("UnderwritingReceiver"),
    scoreManager: at("ScoreManager"),
    forwarder: at("MockKeystoneForwarder"),
    stablecoins: [at("Stablecoin")],
    authorizedKeys: [],
    // A provider without its key has no secret: the workflow treats it as not configured.
    secrets: {
      nansen: keys.nansen ? "NANSEN_API_KEY" : null,
      zerion: keys.zerion ? "ZERION_API_KEY" : null,
      zerionBasicAuth: keys.zerion ? "ZERION_BASIC_AUTH" : null,
      etherscan: keys.etherscan ? "ETHERSCAN_API_KEY" : null,
    },
    recipe: { ...staging.recipe, accountChainId: d.chainId },
    callback: job.callback ? { url: job.callback.url, secretId: CALLBACK_SECRET_ID } : null,
  });

  const selector = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName as keyof typeof cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS];
  const record = bridgeEvm(EvmMock.testInstance(selector), { url: job.rpc, forwarder: at("MockKeystoneForwarder"), transmitter: d.deployer });
  const callbacks: SentRequest[] = [];
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (input) => {
    const sent = toSent(input as unknown as CreRequestLike);
    if (job.callback && sent.url === job.callback.url) {
      callbacks.push(sent);
      return { statusCode: 204 };
    }
    return sendLive(sent);
  };
  // Staging turns on Confidential HTTP for the paid providers: resolve the placeholders as the enclave would, and send.
  const enclave = ConfidentialHttpMock.testInstance();
  enclave.sendRequest = (input) => sendLive(toSentConfidential(input as unknown as ConfidentialRequestLike, vault).resolved);

  const secrets = new Map([
    [
      "main",
      new Map([
        ...Object.entries({ NANSEN_API_KEY: keys.nansen, ZERION_API_KEY: keys.zerion, ETHERSCAN_API_KEY: keys.etherscan }).filter((e): e is [string, string] => e[1] !== null),
        [CALLBACK_SECRET_ID, job.callback?.secret ?? "unused"],
      ]),
    ],
  ]);
  const payload = { input: new TextEncoder().encode(JSON.stringify(job.input)) } as unknown as HTTPPayload;
  const result = JSON.parse(onHttpTrigger(newTestRuntime(secrets, { timeProvider: () => Date.now() }, config), payload));
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      result,
      writes: record.writes.map((w) => ({ receiver: w.receiver, txHash: w.txHash, gasUsed: w.gasUsed.toString() })),
      callbacks: callbacks.map((c) => ({ url: c.url, body: c.body ?? "", signature: c.headers["polaris-signature"] ?? "" })),
    }),
  );
});
