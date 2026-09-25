"use client";

import { useActionState } from "react";
import { generateDraftAction, type DraftState } from "./draft-actions";

/**
 * design/ContactDetail.dc.html's primary action: the black "Draft reply" in
 * the header.
 *
 * It used to be `href="#draft"` — on a page where the draft panel is already
 * visible, pressing it did nothing you could see (docs/slice-9b-plan.md,
 * Part 2). Now:
 *
 *   a draft is waiting   it scrolls to the panel and says so
 *   one can be written   it writes one, and scrolls down to watch it appear
 *   it cannot            the button is not there at all
 *
 * The last case is the point. It was black and inviting next to a disabled
 * twin in the panel below, with the reason only given down there — no AI on
 * this server, Gmail connected without the draft permission, no mail with
 * this contact, or the month's budget gone.
 *
 * Generating is the same Server Action the panel uses, so pressing either is
 * the same thing happening. The action calls refresh(), the page re-renders
 * with the pending draft, and the panel below shows it with Save, Discard and
 * Regenerate.
 */
export function HeaderDraftButton({ contactId, hasDraft }: { contactId: string; hasDraft: boolean }) {
  const [state, generate, generating] = useActionState<DraftState>(
    generateDraftAction.bind(null, contactId, null),
    null,
  );

  const toPanel = () => document.getElementById("draft")?.scrollIntoView({ behavior: "smooth", block: "center" });

  if (hasDraft) {
    return (
      <a href="#draft" onClick={toPanel} className={PILL}>
        <PencilIcon />
        Read the draft
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={generate}>
        <button type="submit" disabled={generating} onClick={toPanel} className={`${PILL} disabled:opacity-60`}>
          <PencilIcon />
          {generating ? "Writing…" : "Draft reply"}
        </button>
      </form>
      {/* The panel below is where a draft's errors belong, but an error from
          this button would otherwise vanish with no explanation at all. */}
      {state?.error && (
        <p role="status" className="max-w-[260px] text-right text-xs font-normal text-accent">
          {state.error}
        </p>
      )}
    </div>
  );
}

const PILL =
  "flex items-center gap-2 rounded-full bg-ink-deep px-[18px] py-2.5 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default";

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[15px]"
    >
      <path d="M4 20h4L18.6 9.4a2.1 2.1 0 0 0-3-3L5 17v3z" />
    </svg>
  );
}
