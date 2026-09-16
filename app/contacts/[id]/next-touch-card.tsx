"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { dateBadge, dueText } from "@/lib/relationship/describe";
import { MAX_REASON_LENGTH, type NextTouch } from "@/lib/relationship/next-touch";
import { finishTouch, saveNextTouch, snoozeTouch, type SetNextTouchState } from "./actions";

/**
 * The Next touch card of design/ContactDetail.dc.html: the reason in quotes,
 * the date as a small calendar badge, and Snooze · Skip · Mark done.
 *
 * Differences from the design, on purpose:
 *   - A line under the reason says how far off the date is, in orange once it's
 *     overdue — the badge alone can't tell you "20 Sep" is already past.
 *   - A fourth button, "Change", opens the form: the design has no way to set
 *     or move the date by hand, and a touch is set by hand in this slice.
 *   - No touch yet: the card holds the form. The design only shows a card with
 *     a touch in it; the form uses the add-contact form's inputs and labels.
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const LABEL = "text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

const INPUT =
  "w-full rounded-[11px] border border-line-strong bg-white px-3 py-2 text-[13.5px] text-ink outline-none transition placeholder:text-ink-hush focus:border-ink-faint focus:ring-2 focus:ring-ink/10 aria-invalid:border-accent";

export function NextTouchCard({
  contactId,
  touch,
  today,
}: {
  contactId: string;
  touch: NextTouch | null;
  /** YYYY-MM-DD in Swedish time, from the server, so both sides agree on "today". */
  today: string;
}) {
  const [state, formAction, pending] = useActionState<SetNextTouchState, FormData>(
    saveNextTouch.bind(null, contactId),
    null,
  );

  // The form is open while `openedAt` equals the number of saves so far: a
  // successful save bumps `state.saved`, and that closes it — no effect needed.
  const saves = state?.saved ?? 0;
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const editing = touch === null || openedAt === saves;

  // A failed save leaves the form open with its errors and what was typed;
  // otherwise the form starts from the touch as it is.
  const errors = editing ? (state?.errors ?? {}) : {};
  const values =
    state && Object.keys(errors).length > 0
      ? state.values
      : { due_on: touch?.due_on ?? "", reason: touch?.reason ?? "" };

  return (
    <section className={`${CARD} flex flex-col gap-3 px-5 py-[17px]`}>
      {touch && !editing ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Next touch</h2>
              {touch.reason ? (
                <span className="text-[12.5px] leading-[1.45] break-words text-ink-soft">
                  &ldquo;{touch.reason}&rdquo;
                </span>
              ) : (
                <span className="text-[12.5px] leading-[1.45] text-ink-hush">No reason written down</span>
              )}
              <Due dueOn={touch.due_on} today={today} />
            </div>
            <Badge isoDate={touch.due_on} />
          </div>

          <form className="flex flex-wrap gap-[7px]">
            <GhostSubmit formAction={snoozeTouch.bind(null, touch.id)}>Snooze</GhostSubmit>
            <GhostSubmit formAction={finishTouch.bind(null, touch.id, "skipped")}>Skip</GhostSubmit>
            <GhostSubmit formAction={finishTouch.bind(null, touch.id, "done")}>Mark done</GhostSubmit>
            <button
              type="button"
              onClick={() => setOpenedAt(saves)}
              className="rounded-full px-[11px] py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              Change
            </button>
          </form>
        </>
      ) : (
        <form action={formAction} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Next touch</h2>
            {!touch && (
              <p className="text-[12.5px] leading-[1.45] text-ink-soft">
                Nothing planned. Pick a day to get back in touch, and why.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="due_on" className={LABEL}>
              Date
            </label>
            <input
              id="due_on"
              name="due_on"
              type="date"
              min={today}
              defaultValue={values.due_on}
              aria-invalid={errors.due_on ? true : undefined}
              aria-describedby={errors.due_on ? "due_on-error" : undefined}
              className={INPUT}
            />
            <FieldError id="due_on-error" message={errors.due_on} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reason" className={LABEL}>
              Why
            </label>
            <input
              id="reason"
              name="reason"
              type="text"
              maxLength={MAX_REASON_LENGTH}
              defaultValue={values.reason}
              placeholder="said the budget lands in October"
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? "reason-error" : undefined}
              className={INPUT}
            />
            <FieldError id="reason-error" message={errors.reason} />
          </div>

          <div className="flex flex-wrap items-center gap-[7px]">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-ink-deep px-[15px] py-1.5 text-[12px] font-semibold text-white transition hover:bg-ink/85 disabled:opacity-60"
            >
              {pending ? "Saving…" : touch ? "Save" : "Set next touch"}
            </button>
            {touch && (
              <button
                type="button"
                onClick={() => setOpenedAt(null)}
                disabled={pending}
                className="rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function Badge({ isoDate }: { isoDate: string }) {
  const { day, month } = dateBadge(isoDate);
  return (
    <div className="flex shrink-0 flex-col items-center rounded-[11px] bg-chip px-[11px] py-1.5">
      <span className="text-[15px] leading-[1.1] font-bold">{day}</span>
      <span className="text-[9.5px] font-semibold tracking-[0.05em] text-ink-quiet uppercase">{month}</span>
    </div>
  );
}

function Due({ dueOn, today }: { dueOn: string; today: string }) {
  const { text, overdue } = dueText(dueOn, today);
  return (
    <span className={`text-[11.5px] font-medium ${overdue ? "text-accent" : "text-ink-faint"}`}>
      {overdue ? text : `Due ${text}`}
    </span>
  );
}

/**
 * A grey pill that submits the card's form to one bound Server Action. No
 * `name`: React reserves it for buttons whose formAction is a function. While
 * one is on its way, all three are disabled, so nothing is sent twice.
 */
function GhostSubmit({
  formAction,
  children,
}: {
  formAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      className="rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[12px] font-medium text-accent">
      {message}
    </p>
  );
}
