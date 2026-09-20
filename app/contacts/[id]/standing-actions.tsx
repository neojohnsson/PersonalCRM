"use client";

import { useFormStatus } from "react-dom";
import { reopenThread, setNeverChase, settleThread } from "@/app/relationship-actions";

/**
 * The two things you can say about a contact, beside Edit and Draft reply on
 * their own page (docs/slice-6c-plan.md, Part 4):
 *
 *   Nothing owed here   this conversation is finished — undoable, and undone
 *                       by itself if they write again
 *   Just a contact      never prompted about this person at all
 *
 * No design has either. They are ContactDetail's own ghost pill, the one Edit
 * and Dismiss use, because they belong to the same row of actions. The state
 * they put the contact in is shown by the pill beside the name, so a pill that
 * is "on" says what it does rather than what it did.
 */
export function StandingActions({
  contactId,
  threadId,
  settled,
  neverChase,
}: {
  contactId: string;
  /** The latest conversation. Null for a contact with no mail: nothing to settle. */
  threadId: string | null;
  settled: boolean;
  neverChase: boolean;
}) {
  return (
    <>
      {threadId && (
        <form action={(settled ? reopenThread : settleThread).bind(null, contactId, threadId)}>
          <ActionPill
            idle={settled ? "Reopen the thread" : "Nothing owed here"}
            busy={settled ? "Reopening…" : "Settling…"}
            title={
              settled
                ? "Count this conversation again, as it stands"
                : "Nothing more is owed in this conversation"
            }
          />
        </form>
      )}

      <form action={setNeverChase.bind(null, contactId, !neverChase)}>
        <ActionPill
          idle="Just a contact"
          busy="Saving…"
          pressed={neverChase}
          title={
            neverChase
              ? "You are never prompted about this person. Press to start again."
              : "Keep the record, and never prompt me about this person"
          }
        />
      </form>
    </>
  );
}

function ActionPill({
  idle,
  busy,
  title,
  pressed,
}: {
  idle: string;
  busy: string;
  title: string;
  pressed?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      aria-pressed={pressed}
      className={`rounded-full px-[18px] py-2.5 text-[13px] font-semibold transition-colors disabled:cursor-default disabled:opacity-50 ${
        pressed
          ? "bg-ink-deep text-white hover:bg-ink/85"
          : "bg-line-soft text-ink-body hover:bg-chip-track"
      }`}
    >
      {pending ? busy : idle}
    </button>
  );
}
