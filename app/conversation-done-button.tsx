"use client";

import { useFormStatus } from "react-dom";
import { settleThread } from "@/app/relationship-actions";

/**
 * "Conversation done" on a row of the home page or the brief: this
 * conversation is finished, so stop counting it as something owed (slice 6c).
 *
 * Slice 9b, Part 2: it was called "Not needed" here, "Nothing owed here" on
 * the contact page and "Nothing more is owed in this conversation" in its own
 * tooltip -- three names for one action, and the first outside test of the app
 * could not tell they were the same thing. One name now, matching the contact
 * menu's "Mark this conversation done". Not "Mark done", which the next touch
 * card already uses for a different thing: a day you planned, which happened.
 *
 * The ghost pill is design/Calendar.dc.html's, which has the same button beside
 * a person the app is suggesting you follow up — the one place a design says
 * what "this needs nothing from me" should look like.
 *
 * It is undoable from the contact page, and a message that arrives afterwards
 * re-opens the thread by itself, so there is no confirm step in the way.
 */
export function ConversationDoneButton({
  contactId,
  threadId,
  className = "",
}: {
  contactId: string;
  threadId: string;
  className?: string;
}) {
  return (
    <form action={settleThread.bind(null, contactId, threadId)} className={className}>
      <SubmitPill />
    </form>
  );
}

function SubmitPill() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title="Nothing more is owed here, so it stops asking you about it"
      className="rounded-full bg-line-soft px-3.5 py-[13px] text-[12px] font-semibold text-ink-body transition hover:bg-chip-track disabled:cursor-default disabled:opacity-50 sm:py-2"
    >
      {pending ? "Marking…" : "Conversation done"}
    </button>
  );
}
