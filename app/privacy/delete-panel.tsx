"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteAccount, deleteAllContacts, type DeleteState } from "@/app/privacy/actions";

/**
 * The two deletions, each behind a typed confirmation
 * (docs/slice-7-plan.md, Part 3).
 *
 * No design covers this. It is the confirm panel from the contact page's
 * Dismiss — a card that says plainly what goes and what does not, rather than
 * the browser's confirm() box, which can say neither.
 *
 * The phrase has to be typed rather than a second button pressed, because the
 * whole point of this screen is that nothing here happens by accident.
 */
export function DeletePanel({ email, contactCount }: { email: string; contactCount: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Danger
        title="Delete all contacts"
        what={
          <>
            All {contactCount === 1 ? "1 contact" : `${contactCount} contacts`}, their addresses,
            summaries, next touches, promises, drafts, what the Assistant did with them and what was found about them on the web, and every stored message detail. Your
            account and your Gmail connection stay, so a new sync would start from scratch.
          </>
        }
        phrase="delete my contacts"
        action={deleteAllContacts}
        button="Delete all contacts"
        busy="Deleting…"
      />

      <Danger
        title="Delete everything, and this account"
        what={
          <>
            Everything above, your profile, your AI spending records and the login itself. The
            Gmail connection is removed at Google first &mdash; if Google doesn&rsquo;t confirm
            it, nothing is deleted at all. Signing in again would start an empty account. This
            cannot be undone.
          </>
        }
        phrase={email}
        action={deleteAccount}
        button="Delete everything"
        busy="Deleting…"
      />
    </div>
  );
}

function Danger({
  title,
  what,
  phrase,
  action,
  button,
  busy,
}: {
  title: string;
  what: React.ReactNode;
  phrase: string;
  action: (previous: DeleteState, formData: FormData) => Promise<DeleteState>;
  button: string;
  busy: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, run] = useActionState<DeleteState, FormData>(action, null);

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-paper-tint px-[18px] py-[15px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{title}</span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-white px-3.5 py-2 text-[12px] font-semibold text-accent shadow-[0_1px_2px_rgba(20,20,25,.05)] transition-colors hover:bg-accent-tint"
          >
            {button}
          </button>
        )}
      </div>

      {open && (
        <>
          <p className="text-[12.5px] leading-[1.55] text-ink-body">{what}</p>
          <form action={run} className="flex flex-wrap items-center gap-[7px]">
            <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold text-ink-muted">
                Type <span className="text-ink">{phrase}</span> to confirm
              </span>
              <input
                name="confirm"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-[11px] border border-line bg-white px-3 py-[9px] text-[13.5px] text-ink outline-none transition focus:border-ink-faint focus:ring-2 focus:ring-ink/10"
              />
            </label>
            <div className="flex gap-[7px] pt-5">
              <ConfirmButton label={button} busy={busy} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-line-soft px-3.5 py-2 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track"
              >
                Cancel
              </button>
            </div>
          </form>
        </>
      )}

      {state?.error && (
        <p role="status" className="text-[12px] leading-[1.5] font-medium text-accent">
          {state.error}
        </p>
      )}
    </div>
  );
}

function ConfirmButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-accent px-[15px] py-2 text-[12px] font-semibold text-white transition hover:bg-accent-dark disabled:cursor-default disabled:opacity-50"
    >
      {pending ? busy : label}
    </button>
  );
}
