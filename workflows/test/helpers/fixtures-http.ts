/**
 * CRE's HTTP capability, answered from @polarispay/underwriting's fixtures
 * (synthesized in each provider's documented shape; see
 * packages/underwriting/fixtures/README.md). No network, no keys. A test
 * double: tests and the e2e suite only, never a runner in local/.
 *
 * It also records what the workflow sent, so tests can check that keys ride
 * in headers (Etherscan: its query parameter), never elsewhere, and that
 * every call asked CRE to cache the response.
 */

import { join } from "node:path";
import { DEFAULT_FIXTURES_DIR, fixtureResponse } from "@polarispay/underwriting/testing";
import type { ConfidentialSent, SentRequest } from "../../local/requests.ts";
import { fs, os } from "./host.ts";

export {
  type ConfidentialRequestLike,
  type ConfidentialSent,
  type CreRequestLike,
  type SentRequest,
  toSent,
  toSentConfidential,
} from "../../local/requests.ts";


/** Answer one provider request from the fixtures, the way the provider would. */
export function answerFromFixtures(sent: SentRequest, dir: string = DEFAULT_FIXTURES_DIR) {
  // The fixture transport never sees keys: strip Etherscan's before routing.
  const url = sent.url.replace(/&apikey=[^&]*/, "");
  try {
    const res = fixtureResponse({ method: sent.method as "GET" | "POST", url, headers: sent.headers, body: sent.body }, dir);
    return {
      statusCode: res.status,
      body: Buffer.from(res.body, "utf8").toString("base64"),
      multiHeaders: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, { values: [v] }])),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { statusCode: 404, body: Buffer.from(JSON.stringify({ error: message })).toString("base64") };
  }
}

/**
 * A copy of the fixtures where `to` has `from`'s history, so a test can sign
 * with a key it holds (the fixture personas' addresses are synthetic and have
 * none). Only files named for `from` are cloned, with the address replaced.
 */
export function cloneFixtures(pairs: Array<{ from: string; to: string }>): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "polaris-cre-fixtures-"));
  fs.cpSync(DEFAULT_FIXTURES_DIR, dir, { recursive: true });
  const walk = (d: string): string[] =>
    fs.readdirSync(d).flatMap((n: string) => {
      const p = join(d, n);
      return fs.statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(dir)) {
    for (const { from, to } of pairs) {
      const f = from.toLowerCase();
      const name = file.split(/[\\/]/).pop()!;
      if (!name.toLowerCase().startsWith(f)) continue;
      const target = file.slice(0, file.length - name.length) + to.toLowerCase() + name.slice(f.length);
      const text = fs.readFileSync(file, "utf8").replace(new RegExp(f, "gi"), to.toLowerCase());
      if (!fs.existsSync(target)) fs.writeFileSync(target, text);
    }
  }
  return dir;
}


/**
 * Answer one Confidential HTTP request from the fixtures. Etherscan's key
 * arrives as a POST form body (its GET API takes it only in the query
 * string); Etherscan reads request parameters from either, so the fixture
 * transport answers it as the GET it stands for.
 */
export function answerConfidentialFromFixtures(sent: ConfidentialSent, dir: string = DEFAULT_FIXTURES_DIR) {
  const r = sent.resolved;
  if (r.url.startsWith("https://api.etherscan.io") && r.method === "POST" && /^apikey=[^&]*$/.test(r.body ?? "")) {
    return answerFromFixtures({ ...r, method: "GET", body: undefined }, dir);
  }
  return answerFromFixtures(r, dir);
}
