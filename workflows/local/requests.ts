/**
 * What a workflow sent through the CRE SDK's HTTP and Confidential HTTP
 * capability mocks, decoded: the runners in local/ answer it live (or post
 * it, for a callback), and the tests answer it from fixtures
 * (test/helpers/fixtures-http.ts). Nothing here answers anything.
 */

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  cached: boolean;
}

/** The Request message the HTTP mock receives, reduced to what we read. */
export interface CreRequestLike {
  url: string;
  method: string;
  body: Uint8Array;
  multiHeaders: Record<string, { values: string[] }>;
  cacheSettings?: { store?: boolean };
}

export function toSent(input: CreRequestLike): SentRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.multiHeaders ?? {})) headers[k.toLowerCase()] = v.values[0] ?? "";
  const body = input.body && input.body.length > 0 ? new TextDecoder().decode(input.body) : undefined;
  return { url: input.url, method: input.method, headers, body, cached: input.cacheSettings?.store === true };
}

/** The ConfidentialHTTPRequest message the Confidential HTTP mock receives, reduced to what we read. */
export interface ConfidentialRequestLike {
  vaultDonSecrets: Array<{ key: string }>;
  request?: {
    url: string;
    method: string;
    body?: { case?: string; value?: unknown };
    multiHeaders: Record<string, { values: string[] }>;
    encryptOutput?: boolean;
  };
}

export interface ConfidentialSent {
  /** The request as the workflow built it: placeholders, never a key. */
  built: SentRequest;
  /** The secret ids it asked the enclave for. */
  secretKeys: string[];
  /** The request as the enclave sends it, placeholders resolved. */
  resolved: SentRequest;
}

/**
 * Resolve `{{.KEY}}` placeholders the way the enclave does (in headers and a
 * body; chainlink's simulator uses Go's text/template the same way), with the
 * stricter rule a real enclave has: only the secrets the request lists.
 */
export function toSentConfidential(input: ConfidentialRequestLike, values: Record<string, string>): ConfidentialSent {
  const r = input.request;
  if (!r) throw new Error("confidential request without a request");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.multiHeaders ?? {})) headers[k.toLowerCase()] = v.values[0] ?? "";
  const body = r.body?.case === "bodyString" ? String(r.body.value) : undefined;
  const built: SentRequest = { url: r.url, method: r.method, headers, body, cached: false };
  const secretKeys = input.vaultDonSecrets.map((s) => s.key);
  const resolve = (text: string) =>
    text.replace(/\{\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
      if (!secretKeys.includes(key)) throw new Error(`placeholder {{.${key}}} names a secret the request did not list`);
      const v = values[key];
      if (v === undefined) throw new Error(`no value for secret ${key}`);
      return v;
    });
  const resolved: SentRequest = {
    url: r.url,
    method: r.method,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, resolve(v)])),
    body: body === undefined ? undefined : resolve(body),
    cached: false,
  };
  return { built, secretKeys, resolved };
}
