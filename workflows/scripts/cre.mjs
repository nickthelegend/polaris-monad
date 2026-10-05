#!/usr/bin/env node
/**
 * Run the Chainlink CRE CLI from this project root, with Bun on PATH.
 *
 *   pnpm --filter @polaris/cre-workflows cre workflow build ./collections
 *   pnpm --filter @polaris/cre-workflows cre workflow simulate ./underwriting -T local-settings \
 *     --non-interactive --trigger-index 0 --http-payload ./underwriting/payload.json --broadcast
 *
 * `cre workflow build` shells out to `bun x cre-compile`, and CRE's
 * TypeScript toolchain runs on Bun, so this puts the pinned Bun from
 * node_modules (the `bun` devDependency's platform binary) first on PATH.
 *
 * The CLI is found at $CRE_BIN, else workflows/.tools (scripts/install-cre.mjs
 * puts it there), else on PATH, else where Chainlink's installers put it.
 *
 * Every run also gets ZERION_BASIC_AUTH = base64("<ZERION_API_KEY>:") when
 * ZERION_API_KEY is set (in the shell or workflows/.env) and it is not: the
 * credential Confidential HTTP templates into Zerion's Basic header, which the
 * enclave cannot encode itself (secrets.yaml).
 *
 * `workflow simulate ./underwriting` without `--config` runs on the target's
 * config with every provider whose key is empty here left out
 * (`secrets.<provider>: null`, written to workflows/.local/), so the run
 * reports it as not configured rather than template an empty key into a paid
 * request; with every key set, nothing changes.
 *
 * Before `workflow build|simulate|deploy|hash` it builds @polarispay/underwriting
 * when its dist is missing or stale: the underwriting workflow bundles that
 * package's pure core, and CRE's bundler (Bun.build, target browser) resolves
 * the package's default export, which is dist, not the TypeScript source.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { binaryName, officialInstallDir, TOOLS_DIR } from "./install-cre.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

export function findCre() {
  const name = binaryName();
  const candidates = [process.env.CRE_BIN, join(TOOLS_DIR, name), onPath(name), join(officialInstallDir(), name)];
  const hit = candidates.find((p) => p && existsSync(p));
  if (!hit) {
    throw new Error("CRE CLI not found. Install it with `pnpm --filter @polaris/cre-workflows cre:install`, or set CRE_BIN.");
  }
  return hit;
}

/** The directory holding the pinned Bun binary, from the `bun` package's platform dependency. */
export function findBunDir() {
  const require = createRequire(join(ROOT, "package.json"));
  let bunPkg;
  try {
    bunPkg = dirname(require.resolve("bun/package.json"));
  } catch {
    return null;
  }
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  // The npm `bun` package ships the binary in an optional @oven/bun-<platform> dependency.
  const scopes = [join(bunPkg, "node_modules", "@oven"), join(bunPkg, "..", "@oven")];
  for (const scope of scopes) {
    if (!existsSync(scope)) continue;
    for (const pkg of readdirSync(scope)) {
      const bin = join(scope, pkg, "bin", exe);
      if (existsSync(bin)) return dirname(bin);
    }
  }
  const own = join(bunPkg, "bin", exe);
  return existsSync(own) ? dirname(own) : null;
}

/** PATH with the pinned Bun first. */
export function envWithBun(env = process.env) {
  const bunDir = findBunDir();
  if (!bunDir) return env;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${bunDir}${delimiter}${env[key] ?? ""}` };
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** Build @polarispay/underwriting's dist if it is missing or older than its source. */
export function ensureUnderwritingBuilt() {
  const pkg = join(ROOT, "..", "packages", "underwriting");
  const out = join(pkg, "dist", "core", "index.js");
  if (existsSync(out) && statSync(out).mtimeMs >= newestMtime(join(pkg, "src"))) return;
  console.log("Building @polarispay/underwriting (the underwriting workflow bundles its core) ...");
  const tsc = createRequire(join(pkg, "package.json")).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.json")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("@polarispay/underwriting failed to build");
}

/** workflows/.env as a plain object (never loaded into this process), or {} without one. */
export function dotEnv(file = join(ROOT, ".env")) {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ secrets

/** The workflow folders of this CRE project, and the targets of project.yaml. */
export const WORKFLOW_DIRS = ["collections", "underwriting", "guardian"];
export const CRE_TARGETS = ["local-settings", "staging-settings", "production-settings"];

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
const withoutComment = (line) => line.replace(/\s+#.*$/, "").replace(/^#.*$/, "");

/**
 * The `secrets-path` a workflow.yaml gives one target, as written (relative
 * to the workflow's folder), or null when it is empty: the CLI then reads no
 * secrets at all for that target. A line-based reader for the flat layout
 * this project's workflow.yaml files use; it throws on a missing target
 * rather than guess.
 */
export function secretsPathOf(workflowYaml, target) {
  return artifactOf(workflowYaml, target, "secrets-path");
}

/** The `config-path` a workflow.yaml gives one target, as written (relative to the workflow's folder), or null. */
export function configPathOf(workflowYaml, target) {
  return artifactOf(workflowYaml, target, "config-path");
}

function artifactOf(workflowYaml, target, key) {
  let inTarget = false;
  let found = false;
  for (const raw of workflowYaml.split(/\r?\n/)) {
    const line = withoutComment(raw);
    if (line.trim() === "") continue;
    const top = /^([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (top) {
      inTarget = top[1] === target;
      found ||= inTarget;
      continue;
    }
    const m = inTarget && new RegExp(`^\\s+${key}:\\s*(.*)$`).exec(line);
    if (m) {
      const path = unquote(m[1]);
      return path === "" ? null : path;
    }
  }
  if (!found) throw new Error(`no ${target} block in this workflow.yaml`);
  return null;
}

/**
 * A CRE secrets file's `secretsNames`: `{ secretId: [envVar, ...] }`. In
 * simulation the CLI reads each secret from those environment variables, and
 * aborts the whole run ("environment variable X for secret value not found")
 * when one is not set at all.
 */
export function parseSecretsNames(text) {
  const out = {};
  let inNames = false;
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = withoutComment(raw);
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) {
      inNames = /^secretsNames:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inNames) continue;
    const id = /^\s{1,4}([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (id) {
      current = id[1];
      out[current] = [];
      continue;
    }
    const item = /^\s+-\s*(\S+)\s*$/.exec(line);
    if (item && current) out[current].push(unquote(item[1]));
  }
  return out;
}

/**
 * Every environment variable `cre workflow simulate` resolves for these
 * workflows and target, from each workflow.yaml's secrets-path and the
 * secrets file it names: `[{ workflow, file, secretId, envVar }]`.
 */
export function secretEnvFor({ root = ROOT, target, workflows = WORKFLOW_DIRS }) {
  const out = [];
  for (const workflow of workflows) {
    const dir = join(root, workflow);
    const rel = secretsPathOf(readFileSync(join(dir, "workflow.yaml"), "utf8"), target);
    if (!rel) continue;
    const file = join(dir, rel);
    for (const [secretId, vars] of Object.entries(parseSecretsNames(readFileSync(file, "utf8")))) {
      for (const envVar of vars) out.push({ workflow, file, secretId, envVar });
    }
  }
  return out;
}

/** The names of every variable any workflow resolves for any target. */
export function allSecretEnvNames(root = ROOT) {
  return [...new Set(CRE_TARGETS.flatMap((target) => secretEnvFor({ root, target }).map((s) => s.envVar)))].sort();
}

/**
 * The environment the CLI runs with: `env` (Bun first on PATH), plus
 *   - the Zerion Basic credential derived from ZERION_API_KEY when it is not
 *     set already (nothing is printed; the value exists only in the child's
 *     environment);
 *   - every secret variable a workflow resolves (secretEnvFor) that neither
 *     `env` nor `file` defines, set to "": the CLI aborts a simulate on an
 *     unset one, even for a workflow that never reads it, and "" is a secret
 *     that is not configured, which every workflow reads as missing
 *     (`optionalSecret`). A value in `file` is left for the CLI to load.
 */
export function creEnv(env = envWithBun(), file = join(ROOT, ".env"), root = ROOT) {
  const fromFile = dotEnv(file);
  const out = { ...env };
  const key = env.ZERION_API_KEY || fromFile.ZERION_API_KEY;
  if (key && !env.ZERION_BASIC_AUTH && !fromFile.ZERION_BASIC_AUTH) {
    out.ZERION_BASIC_AUTH = Buffer.from(`${key}:`, "utf8").toString("base64");
  }
  for (const name of allSecretEnvNames(root)) {
    if (out[name] === undefined && fromFile[name] === undefined) out[name] = "";
  }
  return out;
}

/**
 * Underwriting's config for one run with every provider whose key is empty
 * left out (`secrets.<provider>: null`). Under Confidential HTTP the workflow
 * never reads a key, so it cannot tell an empty one from a real one: without
 * this, the enclave would template "" into each paid request and spend the
 * run's calls on 401s, where the provider is simply not configured.
 * `secretsNames` maps each secret id to its variables (parseSecretsNames).
 * Returns the config and the providers left out.
 */
export function withoutMissingKeys(config, secretsNames, env) {
  const secrets = { ...config.secrets };
  const leftOut = [];
  for (const [provider, id] of Object.entries(secrets)) {
    if (!id) continue;
    const vars = secretsNames[id] ?? [id];
    if (!vars.some((v) => typeof env[v] === "string" && env[v].trim() !== "")) {
      secrets[provider] = null;
      leftOut.push(provider);
    }
  }
  return { config: { ...config, secrets }, leftOut };
}

/**
 * For `workflow simulate ./underwriting -T <target>` without `--config`: the
 * args with `--config` pointing at the target's config minus the providers
 * whose key is empty in `env` (written to workflows/.local/), and those
 * providers; null when every key is set or the run is something else.
 */
export function underwritingSimulateConfig(args, env, root = ROOT) {
  if (args[0] !== "workflow" || args[1] !== "simulate") return null;
  if ((args[2] ?? "").replace(/^\.\//, "").replace(/\/$/, "") !== "underwriting") return null;
  if (args.includes("--config") || args.includes("--no-config") || args.includes("--default-config")) return null;
  const at = args.findIndex((a) => a === "-T" || a === "--target");
  const target = at > 0 ? args[at + 1] : undefined;
  if (!target) return null;
  const dir = join(root, "underwriting");
  const rel = configPathOf(readFileSync(join(dir, "workflow.yaml"), "utf8"), target);
  if (!rel || !existsSync(join(dir, rel))) return null;
  const config = JSON.parse(readFileSync(join(dir, rel), "utf8"));
  const secretsNames = parseSecretsNames(readFileSync(join(root, "secrets.yaml"), "utf8"));
  const { config: out, leftOut } = withoutMissingKeys(config, secretsNames, env);
  if (leftOut.length === 0) return null;
  mkdirSync(join(root, ".local"), { recursive: true });
  const file = join(root, ".local", `underwriting.${target}.simulate.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  // The CLI resolves --config against the workflow's folder and refuses long paths: pass it relative.
  const arg = relative(dir, file).split(sep).join("/");
  return { args: [...args, "--config", arg], leftOut };
}

const BUNDLING = new Set(["build", "simulate", "deploy", "hash"]);

export function runCre(args, opts = {}) {
  const cre = findCre();
  if (args[0] === "workflow" && BUNDLING.has(args[1])) ensureUnderwritingBuilt();
  const env = creEnv();
  // What the CLI will see: the shell's value, else workflows/.env's.
  const seen = { ...env };
  for (const [k, v] of Object.entries(dotEnv())) if (!seen[k]) seen[k] = v;
  const partial = underwritingSimulateConfig(args, seen);
  if (partial) {
    const names = [...new Set(partial.leftOut.map((p) => (p === "zerionBasicAuth" ? "zerion" : p)))];
    console.log(`underwriting: ${names.join(", ")} not configured here (empty key): this run leaves them out and reports them as not configured.`);
  }
  return spawnSync(cre, partial ? partial.args : args, { cwd: ROOT, stdio: "inherit", env, ...opts });
}

if (process.argv[1] && /cre\.mjs$/.test(process.argv[1])) {
  try {
    if (process.argv[2] === "--deps") {
      // Only prepare what the workflows bundle (used by `pnpm typecheck`).
      ensureUnderwritingBuilt();
      process.exit(0);
    }
    const r = runCre(process.argv.slice(2));
    process.exitCode = r.status ?? 1;
  } catch (e) {
    console.error(e.message ?? e);
    process.exitCode = 1;
  }
}
