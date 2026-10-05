import { parseAbi } from "viem";

/**
 * The view functions the app reads from the chain directly (everything else
 * comes from Polaris for Business). Each matches the contract's exported ABI
 * in packages/contracts/abi (test/reads.test.ts checks).
 */

/** The dollar: the account's balance. */
export const ausdAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/** PolarisSend: a send link's state. */
export const sendAbi = parseAbi([
  "function linkOf(address linkKey) view returns ((address sender, uint128 amount, uint64 expiresAt))",
  "function keyUsed(address linkKey) view returns (bool)",
]);

/** CollateralVault: the dollars an account has locked in Boost, and what each dollar adds to the limit. */
export const vaultAbi = parseAbi([
  "function lockedOf(address user) view returns (uint256)",
  "function creditMultiplierBps() view returns (uint256)",
]);
