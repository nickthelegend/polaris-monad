"use client";

import { AdaptiveSheet, AmountDisplay, applyKey, Button, DetailsList, Keypad, Sheet } from "@polaris/ui";
import { Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { addToBoost } from "@/lib/actions";
import { useAccountState } from "@/lib/account/hooks";
import { boostAmountProblem, boostRaise, boostTerms } from "@/lib/boost";
import { getBoost, getCreditLine } from "@/lib/data";
import { notifyDataChanged } from "@/lib/data/changes";
import { prefetchDomains } from "@/lib/domains";
import { type Micros, parseAmount, usd } from "@/lib/money";
import type { RelayReceipt } from "@/lib/relayer";
import { useAccounts } from "./accounts";
import { ConfirmSheet } from "./confirm-sheet";
import { SuccessSheet } from "./success-sheet";

type Added = {
  receipt: RelayReceipt;
  amount: Micros;
  /** Read from the chain after the relay: null when the vault didn't show it yet. */
  locked: Micros | null;
  limit: Micros | null;
  limitBefore: Micros | null;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After the relay: Boost and the limit as the chain has them now. The relayer
 * answers once the block is in, but a slow receipt comes back "submitted", so
 * this reads `lockedOf` a few times until it includes the amount, then reads
 * the limit (ScoreManager.creditLimitOf, through Polaris for Business) fresh.
 */
async function readAfter(owner: Address, expected: Micros): Promise<{ locked: Micros | null; limit: Micros | null }> {
  for (let i = 0; i < 8; i++) {
    const boost = await getBoost(owner).catch(() => null);
    if (boost && boost.locked >= expected) {
      notifyDataChanged(); // every screen, and the credit read below, start from this block
      const credit = await getCreditLine(owner).catch(() => null);
      return { locked: boost.locked, limit: credit?.limit ?? null };
    }
    await pause(1_000);
  }
  return { locked: null, limit: null };
}

/**
 * Add to Boost: how much (the app's keypad), then one Face ID that signs the
 * dollar's permit to CollateralVault, which Polaris carries. Then what Boost
 * and the Pay later limit are now, read back from the chain. Taking dollars
 * out isn't offered: the deployed vault pays out only to a call from the
 * account itself (lib/boost.ts).
 */
export function BoostSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const state = useAccountState();
  const { balance, credit, boost } = useAccounts();
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);

  // Each opening starts fresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue("");
      setAdded(null);
    }
  }

  useEffect(() => {
    if (open) prefetchDomains("ausd");
  }, [open]);

  const amount = parseAmount(value || "0") ?? 0n;
  const available = balance?.available;
  // The vault's multiplier and ScoreManager's face-value rule; null while either is unknown.
  const terms = boostTerms(boost, credit);
  const raise = terms && amount > 0n ? boostRaise(amount, terms) : null;
  // A device with no account yet has nothing to lock: Add money first.
  const empty = available === 0n || state.status === "none";
  const problem = value ? boostAmountProblem(amount, available) : null;
  const tooMuch = available !== undefined && amount > available;

  const hint = problem
    ? problem
    : raise !== null
      ? `Raises your limit by ${usd(raise)}`
      : available !== undefined
        ? `Available ${usd(available)}`
        : " ";

  const close = () => {
    setAdded(null);
    onOpenChange(false);
  };

  return (
    <>
      <AdaptiveSheet
        open={open && !added}
        onOpenChange={(next) => !confirming && onOpenChange(next)}
        snapPoints={["full"]}
        title="Add to Boost"
        description="Lock dollars to raise your Pay later limit."
        maxWidth={440}
      >
        <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-3 pt-1">
          <DetailsList
            size="sm"
            items={[
              { label: "In Boost", value: boost ? usd(boost.locked) : "…" },
              { label: "Pay later limit", value: credit ? usd(credit.limit) : "…" },
            ]}
          />
          {empty ? (
            <>
              <p className="text-[15px] leading-[1.45] text-ui-muted">
                Boost locks dollars from your account. Your balance is {usd(available ?? 0n)}: add money first, then come back to Boost.
              </p>
              <Button
                variant="lime"
                size="lg"
                block
                icon={<Plus />}
                onClick={() => {
                  onOpenChange(false);
                  router.push("/add", { scroll: false });
                }}
              >
                Add money
              </Button>
            </>
          ) : (
            <>
              <div className="flex min-h-[112px] flex-1 items-center justify-center">
                <AmountDisplay
                  value={value}
                  invalid={tooMuch}
                  hint={<span className={problem ? "text-ui-down" : undefined}>{hint}</span>}
                />
              </div>
              <Button variant="lime" size="xl" block icon={<Sparkles />} disabled={amount === 0n || problem !== null} onClick={() => setConfirming(true)}>
                Add to Boost
              </Button>
              <Keypad onKey={(k) => setValue((v) => applyKey(v, k))} onClear={() => setValue("")} captureKeyboard={open && !confirming && !added} />
              <p className="text-center text-[13px] leading-[1.45] text-ui-muted">
                Boost dollars stay yours. Taking them out isn&apos;t in the app yet.
              </p>
            </>
          )}
        </Sheet.Body>
      </AdaptiveSheet>

      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={`Add ${usd(amount, { trim: true })} to Boost`}
        summary={
          <>
            It moves from your dollar account into Boost, where it raises your Pay later limit
            {raise !== null ? ` by ${usd(raise, { trim: true })}` : ""}. Taking it out isn&apos;t in the app yet.
          </>
        }
        busyLabel="Adding…"
        onAccount={async (signer) => {
          const lockedBefore = boost?.locked ?? 0n;
          const limitBefore = credit?.limit ?? null;
          const receipt = await addToBoost(signer, amount, { balance: available });
          const after = await readAfter(signer.address, lockedBefore + amount);
          setAdded({ receipt, amount, locked: after.locked, limit: after.limit, limitBefore });
        }}
      />

      <SuccessSheet
        open={added !== null}
        onOpenChange={(o) => !o && close()}
        title="Boosted."
        subtitle={
          added
            ? added.limit !== null
              ? `${usd(added.amount, { trim: true })} is in Boost. Your Pay later limit is ${usd(added.limit, { trim: true })} now.`
              : `${usd(added.amount, { trim: true })} is on its way to Boost. Your limit updates here when it lands.`
            : undefined
        }
        receiptUrl={added?.receipt.explorerUrl}
        rows={
          added
            ? [
                { label: "Added", value: usd(added.amount) },
                { label: "In Boost", value: added.locked !== null ? usd(added.locked) : "Updating…" },
                {
                  label: "Pay later limit",
                  value:
                    added.limit === null
                      ? "Updating…"
                      : added.limitBefore !== null && added.limitBefore !== added.limit
                        ? `${usd(added.limitBefore)} → ${usd(added.limit)}`
                        : usd(added.limit),
                },
                { label: "Network fee", value: "None" },
              ]
            : []
        }
        primary={{ label: "Done", onClick: close }}
      />
    </>
  );
}
