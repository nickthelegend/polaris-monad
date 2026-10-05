import type { Address, Hex, TypedDataDomain } from "viem";
import { buildPermit, type Permit, type Typed } from "./sign/builders.ts";
import type { Eip712Domain } from "./sign/domain.ts";
import type { permitTypes } from "./sign/types.ts";
import { type Micros, usd } from "./money.ts";

/**
 * Boost: dollars the buyer locks in CollateralVault, which ScoreManager adds
 * to their Pay later limit (`creditLimitOf` = base + `creditBoostOf`, capped
 * at face value for an account with no unsecured line of its own, which the
 * API reports as `boostAtFaceValue`).
 *
 * Adding to Boost is one ERC-2612 permit on the dollar (spender: the vault,
 * value: exactly the amount), which Polaris for Business's relayer carries to
 * `CollateralVault.lockWithPermit` (`POST /api/relay`, type
 * `lockCollateral`). The vault moves the dollars only into the buyer's own
 * position, so the permit can't send them anywhere else.
 *
 * Taking dollars out is `CollateralVault.withdraw(amount)`, which pays
 * `msg.sender` only: the deployed vault has no signed variant a relayer could
 * carry, and a Polaris account holds no MON to call it itself. So the app
 * offers no "Take out of Boost" until the vault gains one.
 *
 * Pure functions only (no I/O), so test/boost.test.ts checks them as they are.
 */

/**
 * The smallest amount the relayer carries (its RELAYER_MIN_TRANSFER_UNITS
 * default, $0.10, which the Privy policy enforces on `lockWithPermit` too).
 */
export const BOOST_MIN: Micros = 100_000n;

/** How long the permit stays good. The relayer refuses one more than three hours ahead. */
export const BOOST_PERMIT_SECONDS = 30n * 60n;

/**
 * Why this amount can't be added, in the buyer's words, or null when it can.
 * `available` is the dollar balance (undefined while it loads).
 */
export function boostAmountProblem(amount: Micros, available: Micros | undefined): string | null {
  if (amount <= 0n) return "Enter an amount";
  if (available !== undefined && amount > available) return "That's more than your balance";
  if (amount < BOOST_MIN) return `The smallest amount is ${usd(BOOST_MIN)}`;
  return null;
}

/** How ScoreManager counts this account's Boost. */
export type BoostTerms = {
  /** `CollateralVault.creditMultiplierBps()`. */
  multiplierBps: number;
  /**
   * ScoreManager's secured-only rule (`CreditLine.boostAtFaceValue`): the
   * boost is capped at what was locked, `min(creditBoostOf, lockedOf)`.
   */
  atFaceValue: boolean;
  /** `CollateralVault.lockedOf(owner)` before this amount; 0 when not known. */
  locked?: Micros;
};

/** The boost `ScoreManager.creditLimitOf` adds for `locked`, exactly as the contracts compute it. */
function boostOf(locked: Micros, multiplierBps: number, atFaceValue: boolean): Micros {
  const boost = (locked * BigInt(multiplierBps)) / 10_000n; // CollateralVault.creditBoostOf
  return atFaceValue && boost > locked ? locked : boost;
}

/**
 * What locking `amount` more adds to the limit: the difference in the boost
 * `ScoreManager.creditLimitOf` adds, before and after (the base limit doesn't
 * move). Face value for an account with no unsecured line of its own (the
 * amount itself), else amount × the vault's multiplier. Both integer
 * divisions are the contracts' own, so the figure is exact, not "up to".
 */
export function boostRaise(amount: Micros, terms: BoostTerms): Micros {
  if (amount <= 0n) return 0n;
  const locked = terms.locked ?? 0n;
  return boostOf(locked + amount, terms.multiplierBps, terms.atFaceValue) - boostOf(locked, terms.multiplierBps, terms.atFaceValue);
}

/**
 * The terms for `boostRaise` from the two reads: the vault's (`getBoost`) and
 * ScoreManager's secured-only rule (`getCreditLine`). Null while either is
 * unknown, and then no screen names a raise.
 */
export function boostTerms(
  boost: { multiplierBps: number; locked: Micros } | null | undefined,
  credit: { boostAtFaceValue: boolean | null } | null | undefined,
): BoostTerms | null {
  if (!boost || !credit || credit.boostAtFaceValue === null) return null;
  return { multiplierBps: boost.multiplierBps, atFaceValue: credit.boostAtFaceValue, locked: boost.locked };
}

/** What each dollar locked adds, for the Boost rows: "$1.00" at face value, "$1.50" at the default multiplier. */
export function boostPerDollar(terms: BoostTerms): Micros {
  return boostRaise(1_000_000n, { ...terms, locked: 0n });
}

/** The permit the buyer signs: owner the account, spender the vault, value exactly the amount. */
export function buildBoostPermit(
  domain: Eip712Domain,
  input: { owner: Address; vault: Address; amount: Micros; nonce: bigint; deadline: bigint },
): Typed<typeof permitTypes, "Permit", Permit> {
  if (input.amount <= 0n) throw new RangeError("amount must be more than zero");
  return buildPermit(domain, { owner: input.owner, spender: input.vault, value: input.amount, nonce: input.nonce, deadline: input.deadline });
}

/**
 * The `POST /api/relay` body for `lockCollateral`
 * (apps/business/src/server/relayer/relay.ts): the borrower, the amount and
 * the permit, every integer as a decimal string. The relayer refuses a
 * permit whose value isn't the amount, so both come from the one message.
 */
export function lockCollateralBody(permit: { message: Permit; signature: Hex; domain?: TypedDataDomain }): {
  type: "lockCollateral";
  borrower: Address;
  amount: string;
  permit: { value: string; deadline: string; signature: Hex };
} {
  const { owner, value, deadline } = permit.message;
  return {
    type: "lockCollateral",
    borrower: owner,
    amount: value.toString(),
    permit: { value: value.toString(), deadline: deadline.toString(), signature: permit.signature },
  };
}
