"use client";

import { useState, useTransition } from "react";
import { syncStep } from "@/app/sync/actions";

/** A guard against looping forever if a step ever stopped reporting done. */
const MAX_STEPS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Sync now": calls one sync step after another until the sync says it's done,
 * waiting between steps as long as each step asks — that's what keeps the
 * sync inside Gmail's per-user quota (lib/sync/pace.ts).
 *
 * Temporary, per slice-1-plan.md decision 5 — the goal is a scheduled sync
 * with no button. It's here so the sync can be built and watched.
 *
 * While syncing the label stays a plain "Syncing…" and nothing appears under
 * the button, so the top row keeps its size. Progress and "keep this tab
 * open" are in the status line below (lib/sync/describe.ts).
 *
 * Styled as design/ContactList.dc.html's dark pill button ("Add contact").
 */
export function SyncButton({ onDone, onCard = false }: { onDone?: () => void; onCard?: boolean } = {}) {
  const [isSyncing, startSync] = useTransition();
  const [failed, setFailed] = useState(false);

  function sync() {
    setFailed(false);
    startSync(async () => {
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const result = await syncStep();
          if (result.done) {
            // The Assistant's sync card (slice 11b) is told; the header's
            // button needs nothing, as each step already refreshed the page.
            onDone?.();
            break;
          }
          await sleep(result.waitMs);
        }
      } catch {
        // The step itself records Gmail failures in the status line. This is
        // for the request not getting through at all.
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={sync}
        disabled={isSyncing}
        aria-busy={isSyncing}
        // White, like the design's sort pill: the dark pill beside it is
        // "Add contact", the page's main action. On an Assistant card, which
        // is white itself, it is the card's dark main button instead.
        className={`flex items-center gap-[7px] rounded-full px-4 py-[9px] text-[12.5px] font-semibold tabular-nums transition disabled:opacity-70 ${
          onCard
            ? "bg-ink-deep text-white hover:bg-ink/85"
            : "bg-white text-ink shadow-[0_1px_2px_rgba(20,20,25,.04)] hover:bg-paper-tint"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`}
        >
          <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />
        </svg>
        {isSyncing ? "Syncing…" : "Sync now"}
      </button>
      {failed && (
        <p role="alert" className="text-[12px] font-medium text-accent">
          Couldn&rsquo;t reach the server. Try again.
        </p>
      )}
    </div>
  );
}
