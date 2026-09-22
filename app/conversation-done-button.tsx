"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reopenThread, settleThread } from "@/app/relationship-actions";
import { useToast } from "@/app/toasts";

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
 * Slice 9b, Part 3: and it does not move the list out from under you.
 *
 * It used to be a plain form whose Server Action refreshed the page, so the
 * row left the list the instant you pressed — and the next row slid up under
 * the cursor, one click away from being dismissed too. The report found that
 * by doing it. Now the action is told not to refresh: the row stays exactly
 * where it was, the button becomes "Marked done", and the page only catches up
 * when the toast's Undo is out of reach. Pressing Undo puts the thread back
 * and the row with it.
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
  const router = useRouter();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const press = () => {
    start(async () => {
      await settleThread(contactId, threadId, { revalidate: false });
      setDone(true);
      toast({
        message: "Conversation marked done.",
        action: {
          label: "Undo",
          run: async () => {
            await reopenThread(contactId, threadId);
            setDone(false);
          },
        },
        // The list catches up once, when undoing is no longer on offer.
        onExpire: () => router.refresh(),
      });
    });
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={press}
        disabled={pending || done}
        title={
          done
            ? "Marked done. Undo it from the line at the foot of the screen."
            : "Nothing more is owed here, so it stops asking you about it"
        }
        className={`rounded-full px-3.5 py-[13px] text-[12px] font-semibold transition disabled:cursor-default sm:py-2 ${
          done
            ? "bg-line-soft text-ink-faint"
            : "bg-line-soft text-ink-body hover:bg-chip-track disabled:opacity-50"
        }`}
      >
        {done ? "Marked done" : pending ? "Marking…" : "Conversation done"}
      </button>
    </div>
  );
}
