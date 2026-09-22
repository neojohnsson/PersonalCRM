"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useToast } from "@/app/toasts";
import type { NameSuggestion } from "@/lib/contacts/name-suggestion";
import { acceptSuggestedName, setContactName } from "./actions";

/**
 * "Their name might be Linda Jönsson" — one line under the name on a contact's
 * page (docs/slice-9b-plan.md, Part 5).
 *
 * No design covers it. It is the tinted row of the AI summary's "waiting for
 * you" state (app/contacts/[id]/summary-card.tsx), because it is the same
 * thing: something the app worked out, shown where the person it is about is,
 * waiting for a press.
 *
 * Nothing is renamed without that press — plan.md §5.2, and the reason this is
 * a row and not a migration that tidied everybody's names on the way past.
 * Two ways out of it: accept it, or edit the name yourself, which also settles
 * the question and makes the row go away.
 */
export function NameSuggestionRow({
  contactId,
  suggestion,
  shownAs,
}: {
  contactId: string;
  suggestion: NameSuggestion;
  /** What the page calls them now, so the row can say what it is replacing. */
  shownAs: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const suggested = `${suggestion.first} ${suggestion.last}`;

  const accept = () =>
    start(async () => {
      const answer = await acceptSuggestedName(contactId);
      if ("error" in answer) {
        toast({ message: answer.error });
        return;
      }
      toast({
        message: `Renamed to ${suggested}.`,
        action: {
          label: "Undo",
          run: async () => {
            const back = await setContactName(contactId, answer.from.first, answer.from.last);
            if (back?.error) throw new Error(back.error);
          },
        },
      });
    });

  return (
    <div className="flex max-w-[640px] flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-info-tint px-[15px] py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-info-ink">
          {suggestion.kind === "swap"
            ? `Shown as “${shownAs}” — did you mean “${suggested}”?`
            : `No name yet. Their address suggests “${suggested}”.`}
        </span>
        <span className="text-[11.5px] leading-[1.45] text-info-ink/80">{suggestion.why}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={pending}
          className="rounded-full bg-info-ink px-[13px] py-3 text-[12px] font-semibold text-white transition hover:bg-info-ink/85 disabled:cursor-default disabled:opacity-60 sm:py-1.5"
        >
          {pending ? "Saving…" : `Use ${suggested}`}
        </button>
        <Link
          href={`/contacts/${contactId}/edit`}
          className="rounded-full px-2 py-3 text-[12px] font-semibold text-info-ink underline decoration-info-ink/30 underline-offset-2 hover:decoration-info-ink sm:py-1.5"
        >
          Edit instead
        </Link>
      </div>
    </div>
  );
}
