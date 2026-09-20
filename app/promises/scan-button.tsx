"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { runScan, type ScanState } from "@/app/promises/actions";

/**
 * "Look for promises", with its price on it (docs/slice-6d-plan.md, Part 3).
 *
 * The number is the most it could cost, not a guess at what it will: reading a
 * mailbox is the most expensive thing this app does, and a button that spends
 * money should say so before it is pressed, not afterwards.
 *
 * The solid pill is design/ReviewQueue.dc.html's, from the same toolbar strip.
 */
export function ScanButton({ contacts, estimateUsd }: { contacts: number; estimateUsd: number }) {
  const [state, scan] = useActionState<ScanState, FormData>(runScan, null);

  return (
    <form action={scan} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {state ? (
        <span
          role="status"
          className={`text-[11.5px] font-medium ${state.tone === "problem" ? "text-accent" : "text-ink-quiet"}`}
        >
          {state.message}
        </span>
      ) : (
        <span className="text-[11.5px] font-medium text-ink-quiet">
          {contacts === 0
            ? "Nothing new to read"
            : `${contacts === 1 ? "1 contact" : `${contacts} contacts`} to read, up to ${price(estimateUsd)}`}
        </span>
      )}
      <SubmitPill disabled={contacts === 0} />
    </form>
  );
}

/** Cents, because a scan of a personal mailbox costs cents. */
function price(usd: number): string {
  return usd < 0.01 ? "a cent" : `$${usd.toFixed(2)}`;
}

function SubmitPill({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-full bg-ink-deep px-[15px] py-2 text-[12px] font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-40"
    >
      {pending ? "Reading…" : "Look for promises"}
    </button>
  );
}
