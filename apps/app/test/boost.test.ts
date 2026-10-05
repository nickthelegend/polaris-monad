import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress, hashTypedData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { BOOST_MIN, boostAmountProblem, boostRaise, buildBoostPermit, lockCollateralBody } from "../src/lib/boost.ts";
import { PERMIT_TYPE } from "../src/lib/sign/types.ts";

/**
 * Add to Boost: the permit the buyer signs and the body the app sends to
 * `POST /api/relay` (type `lockCollateral`). The relayer
 * (apps/business/src/server/relayer/relay.ts) rebuilds the permit with
 * spender = the deployment's CollateralVault and value = `amount`, recovers
 * the signer and refuses anything else; these pin the app's half of that.
 */

const USD = (n: number) => BigInt(Math.round(n * 1e6));
const VAULT = getAddress("0xc2f006ae9836a700ce8f1e457d11346cc42e23dc");
const AUSD = getAddress("0x00000000000000000000000000000000000a05d0");
const domain = { name: "AUSD", version: "1", chainId: 10143, verifyingContract: AUSD };
const buyer = privateKeyToAccount(generatePrivateKey());

describe("the Boost permit", () => {
  const typed = buildBoostPermit(domain, { owner: buyer.address, vault: VAULT, amount: USD(50), nonce: 3n, deadline: 2_000_000_000n });

  it("is an ERC-2612 Permit to the vault for exactly the amount, under the dollar's domain", () => {
    assert.equal(typed.primaryType, "Permit");
    assert.deepEqual(typed.domain, domain);
    assert.deepEqual(typed.message, { owner: buyer.address, spender: VAULT, value: USD(50), nonce: 3n, deadline: 2_000_000_000n });
    const fields = typed.types.Permit.map((f) => `${f.type} ${f.name}`).join(",");
    assert.equal(`Permit(${fields})`, PERMIT_TYPE);
  });

  it("recovers to the buyer, as the relayer checks before it carries it", async () => {
    const signature = await buyer.signTypedData(typed);
    const recovered = await recoverTypedDataAddress({ ...typed, signature });
    assert.equal(recovered, buyer.address);
    // Pointed at any other spender, the same signature is someone else's (the token rejects it).
    const elsewhere = { ...typed, message: { ...typed.message, spender: AUSD } };
    assert.notEqual(hashTypedData(elsewhere), hashTypedData(typed));
    assert.notEqual(await recoverTypedDataAddress({ ...elsewhere, signature }), buyer.address);
  });

  it("refuses nothing or less", () => {
    assert.throws(() => buildBoostPermit(domain, { owner: buyer.address, vault: VAULT, amount: 0n, nonce: 0n, deadline: 1n }), RangeError);
    assert.throws(() => buildBoostPermit(domain, { owner: buyer.address, vault: VAULT, amount: -1n, nonce: 0n, deadline: 1n }), RangeError);
  });
});

describe("the lockCollateral relay body", () => {
  it("names the borrower, the amount and the permit, every integer a decimal string", async () => {
    const typed = buildBoostPermit(domain, { owner: buyer.address, vault: VAULT, amount: USD(12.5), nonce: 0n, deadline: 1_900_000_000n });
    const signature = await buyer.signTypedData(typed);
    const body = lockCollateralBody({ message: typed.message, signature, domain });
    assert.deepEqual(body, {
      type: "lockCollateral",
      borrower: buyer.address,
      amount: "12500000",
      permit: { value: "12500000", deadline: "1900000000", signature },
    });
    // The relayer refuses a permit whose value isn't the amount: both come from the one message.
    assert.equal(body.amount, body.permit.value);
    // It survives JSON as is (no bigint), which is how api() sends it.
    assert.deepEqual(JSON.parse(JSON.stringify(body)), body);
    assert.match(body.permit.signature, /^0x[0-9a-f]{130}$/);
  });
});

describe("what the amount sheet accepts", () => {
  it("more than zero, at least the relayer's minimum, and no more than the balance", () => {
    assert.equal(boostAmountProblem(0n, USD(100)), "Enter an amount");
    assert.equal(boostAmountProblem(USD(100.01), USD(100)), "That's more than your balance");
    assert.equal(boostAmountProblem(USD(0.05), USD(100)), "The smallest amount is $0.10");
    assert.equal(boostAmountProblem(BOOST_MIN, USD(100)), null);
    assert.equal(boostAmountProblem(USD(100), USD(100)), null);
    // The balance still loading: only the amount itself is checked; the relayer checks the balance again.
    assert.equal(boostAmountProblem(USD(5), undefined), null);
  });

  it("says what a dollar adds at the vault's multiplier", () => {
    assert.equal(boostRaise(USD(100)), USD(150));
    assert.equal(boostRaise(USD(100), 10_000), USD(100));
    assert.equal(boostRaise(USD(1), 15_000), USD(1.5));
  });
});
