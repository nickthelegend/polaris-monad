/**
 * Report gas sizing, held to what Monad testnet measured.
 *
 * evidence/gas/2026-10-07.json is `pnpm report-gas --json` (read-only:
 * eth_estimateGas and debug_traceCall against the deployed receivers behind
 * Chainlink's simulation forwarder, from the recorded transmitter): for each
 * report, the forwarder-level estimate the workflows get and the smallest
 * gas limit at which the receiver ran to its end. The sizing must cover every
 * one of them, without padding far past it (Monad bills the limit).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GasConfig } from "../src/shared/config.ts";
import { deliveryGas, FORWARDER_CALL_DEPTH, gasLimitFor } from "../src/shared/evm.ts";
import { fs } from "./helpers/host.ts";

const ROOT = join(import.meta.dir, "..");
const json = (p: string) => JSON.parse(fs.readFileSync(join(ROOT, p), "utf8"));

interface Row {
  label: string;
  estimate: string;
  needed: string;
  deliveredAtEstimate: boolean;
  events: string;
}
const measured = json("evidence/gas/2026-10-07.json") as { forwarder: string; rows: Row[] };
const deployment = json("../packages/contracts/deployments/monad-testnet.json");

/** The workflow a measured report belongs to: "collections: …", "replay: collections-retry (…)". */
const workflowOf = (label: string) => {
  const name = label.replace(/^replay: /, "").split(/[:\s-]/)[0];
  if (name !== "collections" && name !== "underwriting" && name !== "guardian") throw new Error(`no workflow for "${label}"`);
  return name;
};
const staging = (workflow: string) => json(`${workflow}/config.staging.json`).gas as GasConfig;

describe("deliveryGas: an estimate of the whole delivery, lifted past the forwarder's catch", () => {
  test("× (64/63)² for the forwarder's two frames, rounded up", () => {
    expect(FORWARDER_CALL_DEPTH).toBe(2);
    expect(deliveryGas(3_969n)).toBe(4_096n);
    expect(deliveryGas(3_970n)).toBe(4_098n); // 4,097.03… rounds up
    expect(deliveryGas(1n)).toBe(2n);
    expect(deliveryGas(0n)).toBe(0n);
    // About +3.2% (4,096 / 3,969), whatever the size.
    for (const e of [125_000n, 300_000n, 860_110n, 9_000_000n]) {
      const lift = Number(deliveryGas(e) - e) / Number(e);
      expect(lift).toBeGreaterThanOrEqual(0.03199);
      expect(lift).toBeLessThanOrEqual(0.03201);
    }
  });

  test("the gas limit behind a transmitter: deliveryGas(estimate) + headroom, clamped", () => {
    const gas = { overhead: "80000", headroomBps: 1500, min: "200000", max: "1000000" };
    expect(gasLimitFor(400_000n, gas, "delivery")).toBe((412_800n * 11_500n) / 10_000n);
    expect(gasLimitFor(1n, gas, "delivery")).toBe(200_000n);
    expect(gasLimitFor(5_000_000n, gas, "delivery")).toBe(1_000_000n);
    // Behind the production forwarder the estimate is of onReport alone: + overhead, no lift.
    expect(gasLimitFor(400_000n, gas)).toBe(552_000n);
  });
});

describe("the sizing against Monad testnet's own numbers", () => {
  test("the measurement is of the deployed receivers behind the simulation forwarder", () => {
    expect(measured.forwarder).toBe(deployment.cre.forwarder);
    expect(measured.rows.length).toBeGreaterThanOrEqual(15);
    for (const r of measured.rows) expect(BigInt(r.needed)).toBeGreaterThan(0n);
  });

  test("the estimate alone is short whenever the receiver collects or liquidates (the finding)", () => {
    const executing = measured.rows.filter((r) => workflowOf(r.label) === "collections" && /TaskExecuted/.test(r.events));
    expect(executing.length).toBeGreaterThanOrEqual(8);
    for (const r of executing) {
      expect(r.deliveredAtEstimate).toBe(false);
      expect(BigInt(r.needed)).toBeGreaterThan(BigInt(r.estimate));
    }
  });

  test("the lift alone, with no headroom, delivers every measured report", () => {
    for (const r of measured.rows) {
      expect({ label: r.label, delivers: deliveryGas(BigInt(r.estimate)) >= BigInt(r.needed) }).toEqual({ label: r.label, delivers: true });
    }
  });

  test("each workflow's staging config delivers every report it measured, at most 21% over the need", () => {
    for (const r of measured.rows) {
      const limit = gasLimitFor(BigInt(r.estimate), staging(workflowOf(r.label)), "delivery");
      const needed = BigInt(r.needed);
      expect({ label: r.label, delivers: limit >= needed }).toEqual({ label: r.label, delivers: true });
      // Lift (3.2%) and headroom (15%) make 18.7%; on the smallest reports the floor (150,000) decides, up to 20.03%.
      expect({ label: r.label, ratio: Number(limit) / Number(needed) <= 1.21 }).toEqual({ label: r.label, ratio: true });
    }
  });
});
