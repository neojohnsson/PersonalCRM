"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { dismissContact } from "./actions";

/**
 * "Dismiss" beside Edit on the contact page, with a confirm step.
 *
 * No design has this. The button is the ghost pill of Seen once's Dismiss
 * (design/ReviewQueue.dc.html); the confirm panel is a small card in the
 * contact page's card style. It's a card on the page rather than the browser's
 * confirm() box, so it can say plainly what is deleted and what can be undone.
 */
export function DismissContact({ contactId, name }: { contactId: string; name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full bg-line-soft px-[18px] py-2.5 text-[13px] font-semibold text-ink-body transition-colors hover:bg-chip-track"
      >
        Dismiss
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Dismiss ${name}`}
          className="absolute top-full right-0 z-10 mt-2 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-[18px] bg-white px-5 py-[17px] shadow-[0_1px_2px_rgba(20,20,25,.06),0_12px_32px_rgba(20,20,25,.14)]"
        >
          <h2 className="text-[14.5px] font-bold tracking-[-0.015em] break-words">Dismiss {name}?</h2>
          <p className="text-[12.5px] leading-[1.5] text-ink-soft">
            The contact is deleted — notes, tags, next touch — and so is the mail they sent you.
            Only their address is kept, so new mail from them is skipped.
          </p>
          <p className="text-[12.5px] leading-[1.5] text-ink-soft">
            You can undo it from Seen once → Dismissed, and their mail is read back in from
            Gmail — but notes, tags and the next touch don&rsquo;t come back.
          </p>
          <form className="flex flex-wrap justify-end gap-[7px] pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-line-soft px-[14px] py-2 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track"
            >
              Cancel
            </button>
            <ConfirmButton action={dismissContact.bind(null, contactId)} />
          </form>
        </div>
      )}
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
      className="rounded-full bg-ink-deep px-[14px] py-2 text-[12px] font-semibold text-white transition-colors hover:bg-ink/85 disabled:cursor-default disabled:opacity-50"
    >
      {pending ? "Dismissing…" : "Dismiss and delete"}
    </button>
  );
}
