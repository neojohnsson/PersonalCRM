"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { reopenThread, setNeverChase, settleThread } from "@/app/relationship-actions";
import { useToast } from "@/app/toasts";
import { dismissContact } from "./actions";

/**
 * The "···" menu on a contact's page — design/ContactDetail.dc.html's own
 * 34px white tile, between the standing pill and Draft reply.
 *
 * Why it exists (docs/slice-9b-plan.md, Part 2). The header had grown to seven
 * controls in a row: the pill, Edit, Draft reply, Nothing owed here, Just a
 * contact, Export and Dismiss. Each arrived in a different slice and each was
 * defensible on its own; together they were a wall, and at 390px they pushed
 * the page to 872px wide. The design has three controls and this menu, and it
 * was right all along.
 *
 * Three things the first outside test of the app was right about:
 *
 *   1. "Dismiss" never said that it deletes. The confirm panel did, by which
 *      point you had already decided. The item says it, and the confirm button
 *      is red rather than the same black as every other primary action.
 *   2. "Nothing owed here", "Not needed" and "Nothing more is owed in this
 *      conversation" were three names for one action. One name now:
 *      "Mark this conversation done".
 *   3. "Just a contact" looked exactly like Draft reply when it was on,
 *      because "on" was a filled black pill and so is the primary button.
 *      Here it is a line of text with its state written underneath.
 *
 * Every action is a Server Action that checks the user itself; this component
 * only decides what is on screen.
 */
export function ContactMenu({
  contactId,
  name,
  threadId,
  settled,
  neverChase,
  canDelete,
}: {
  contactId: string;
  name: string;
  /** The latest conversation. Null for a contact with no mail: nothing to settle. */
  threadId: string | null;
  settled: boolean;
  neverChase: boolean;
  /** Only a contact with an address can be dismissed: it is about skipping their mail. */
  canDelete: boolean;
}) {
  const [view, setView] = useState<"closed" | "menu" | "delete">("closed");
  const open = view !== "closed";

  // Escape closes it, wherever the focus is. A menu you can't dismiss with the
  // keyboard is a trap for anyone not using a mouse.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setView(open ? "closed" : "menu")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More actions"
        className="flex size-[34px] items-center justify-center rounded-lg bg-white text-ink-soft shadow-[0_1px_2px_rgba(20,20,25,.05)] transition-colors hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-[17px]">
          <circle cx="5.5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="18.5" cy="12" r="1.5" />
        </svg>
      </button>

      {open && (
        <>
          {/* A click anywhere else closes it. */}
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setView("closed")}
            className="fixed inset-0 z-10 cursor-default"
          />

          {view === "menu" ? (
            <div
              role="dialog"
              aria-label={`More actions for ${name}`}
              className={`${PANEL} overflow-hidden py-1.5 sm:w-[310px]`}
            >
              <Link href={`/contacts/${contactId}/edit`} className={ITEM}>
                <span className={LINE_INK}>Edit their details</span>
                <span className={NOTE}>Name, company, role, email addresses and phone.</span>
              </Link>

              {threadId && (
                <MenuAction
                  run={() => (settled ? reopenThread : settleThread)(contactId, threadId)}
                  undo={() => (settled ? settleThread : reopenThread)(contactId, threadId)}
                  done={settled ? "The conversation counts again." : "Conversation marked done."}
                  idle={settled ? "Count this conversation again" : "Mark this conversation done"}
                  busy={settled ? "Reopening…" : "Marking…"}
                  note={
                    settled
                      ? "You marked it done, so nobody is waiting. Press to count it again."
                      : "Nothing more is owed here, so it stops asking you about it."
                  }
                  onRan={() => setView("closed")}
                />
              )}

              <MenuAction
                run={() => setNeverChase(contactId, !neverChase)}
                undo={() => setNeverChase(contactId, neverChase)}
                done={neverChase ? "Reminders are on again." : "Reminders off for this person."}
                idle={neverChase ? "Start reminding me again" : "Stop reminding me about this person"}
                busy="Saving…"
                note={
                  neverChase
                    ? "Reminders are off. The contact stays, and days you set yourself still show."
                    : "Keeps the contact, and never puts them on Home or in a brief."
                }
                onRan={() => setView("closed")}
              />

              {/* Slice 7: the copy you hand over when the person asks what you
                  hold on them (plan.md §5.2). A plain link, because the answer
                  is a file the browser saves. */}
              <a href={`/contacts/${contactId}/export`} className={ITEM}>
                <span className={LINE_INK}>Download everything about them</span>
                <span className={NOTE}>Their record and their mail&rsquo;s details, as a file.</span>
              </a>

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setView("delete")}
                  className={`${ITEM} mt-1.5 border-t border-line-soft pt-3`}
                >
                  <span className={LINE_DANGER}>Delete contact and their mail…</span>
                </button>
              )}
            </div>
          ) : (
            <DeleteConfirm
              contactId={contactId}
              name={name}
              onCancel={() => setView("menu")}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where the popover sits. From sm up it hangs under the "···" button, as a menu
 * should. Below sm it cannot: the button sits in the middle of a 390px row, so
 * a panel anchored to its right edge hung 88px off the left of the screen
 * (measured at 390px, slice 9b). There it is a sheet in the page's own
 * gutters, above the bottom bar.
 */
const PANEL =
  "z-20 flex flex-col rounded-xl bg-white shadow-[0_1px_2px_rgba(20,20,25,.06),0_12px_32px_rgba(20,20,25,.14)] max-sm:fixed max-sm:inset-x-4 max-sm:bottom-[84px] sm:absolute sm:top-full sm:right-0 sm:mt-2";

const ITEM =
  "flex w-full flex-col items-start gap-0.5 px-[18px] py-2.5 text-left transition-colors hover:bg-paper-tint";
const LINE = "text-sm font-semibold";
const LINE_INK = `${LINE} text-ink`;
const LINE_DANGER = `${LINE} text-danger`;
const NOTE = "text-xs text-ink-soft";

/**
 * One menu row that runs a Server Action and then offers Undo (slice 9b,
 * Part 3). Both rows that use it change one column of one row, and both have
 * had their opposite since slice 6c -- the toast just puts it within reach.
 *
 * Unlike a row on Home, this page refreshes straight away: it is about this
 * one contact, and the pill by their name would otherwise say the old thing
 * for eight seconds. Undo refreshes again.
 */
function MenuAction({
  run,
  undo,
  done,
  idle,
  busy,
  note,
  onRan,
}: {
  run: () => Promise<void>;
  undo: () => Promise<void>;
  /** What the toast says once it has happened. */
  done: string;
  idle: string;
  busy: string;
  note: string;
  onRan: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await run();
          onRan();
          toast({ message: done, action: { label: "Undo", run: undo } });
        })
      }
      className={`${ITEM} disabled:cursor-default disabled:opacity-60`}
    >
      <span className={LINE_INK}>{pending ? busy : idle}</span>
      <span className={NOTE}>{note}</span>
    </button>
  );
}

/**
 * The confirm step for deleting a contact, in the same popover the menu item
 * was in — so the words you pressed are still on screen behind it.
 *
 * It was its own button and panel until slice 9b (./dismiss-contact.tsx, now
 * gone). The copy is the same, minus the word "Dismiss", which nobody read as
 * "delete"; the confirm button is red, because everything else in this app
 * that is black is safe.
 */
function DeleteConfirm({
  contactId,
  name,
  onCancel,
}: {
  contactId: string;
  name: string;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Delete ${name}`}
      className={`${PANEL} gap-2.5 px-5 py-[17px] sm:w-[340px]`}
    >
      <h2 className="text-base font-bold tracking-[-0.015em] break-words">Delete {name}?</h2>
      <p className="text-sm text-ink-soft">
        The contact is deleted — notes, tags, next touch — and so is the mail they sent you. Only
        their address is kept, so new mail from them is skipped.
      </p>
      <p className="text-sm text-ink-soft">
        You can undo it from Seen once → Dismissed, and their mail is read back in from Gmail — but
        notes, tags and the next touch don&rsquo;t come back.
      </p>
      <form className="flex flex-wrap justify-end gap-[7px] pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-line-soft px-[14px] py-2 text-xs font-semibold text-ink-body transition-colors hover:bg-chip-track"
        >
          Cancel
        </button>
        <ConfirmButton action={dismissContact.bind(null, contactId)} />
      </form>
    </div>
  );
}

function ConfirmButton({ action }: { action: () => Promise<void> }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={action}
      disabled={pending}
      className="rounded-full bg-danger px-[14px] py-2 text-xs font-semibold text-white transition-colors hover:bg-danger-dark disabled:cursor-default disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete contact and their mail"}
    </button>
  );
}
