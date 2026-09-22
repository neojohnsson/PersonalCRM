"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useToast } from "@/app/toasts";
import { dayMonth } from "@/lib/format";
import { dateBadge, dueText } from "@/lib/relationship/describe";
import { MAX_REASON_LENGTH, type NextTouch } from "@/lib/relationship/next-touch";
import { snoozeChoices } from "@/lib/relationship/snooze";
import {
  finishTouch,
  moveTouchTo,
  reopenTouch,
  saveNextTouch,
  snoozeTouch,
  type SetNextTouchState,
} from "./actions";

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
 *   - "Fill in next touch" on the AI summary opens this form pre-filled
 *     (slice 4, docs/slice-4-plan.md Part 7). Nothing is saved until you press
 *     Save — that press is the approval.
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
  prefill = null,
}: {
  contactId: string;
  touch: NextTouch | null;
  /** YYYY-MM-DD in Swedish time, from the server, so both sides agree on "today". */
  today: string;
  /** A summary's suggestion to start the form from; the date is "" when the emails gave none. */
  /**
   * A suggestion to start the form from. `kind` is the timing the AI chose, so
   * accepting it keeps "waiting on them" — otherwise the kind is lost between
   * the AI answering and this button being pressed (slice 9a).
   */
  prefill?: { due_on: string; reason: string; rough?: boolean; kind?: string | null } | null;
}) {
  const [state, formAction, pending] = useActionState<SetNextTouchState, FormData>(
    saveNextTouch.bind(null, contactId),
    null,
  );

  // The form is open while `openedAt` equals the number of saves so far: a
  // successful save bumps `state.saved`, and that closes it — no effect needed.
  const saves = state?.saved ?? 0;
  const [openedAt, setOpenedAt] = useState<number | null>(prefill ? 0 : null);
  const editing = touch === null || openedAt === saves;
  // The suggestion fills the form it opened; "Change" later starts from the touch itself.
  const [fromSuggestion, setFromSuggestion] = useState(prefill !== null);
  const suggested = fromSuggestion && editing ? prefill : null;

  // A failed save leaves the form open with its errors and what was typed;
  // otherwise the form starts from the touch as it is.
  const errors = editing ? (state?.errors ?? {}) : {};
  const values =
    state && Object.keys(errors).length > 0
      ? state.values
      : suggested
        ? { due_on: suggested.due_on, reason: suggested.reason }
        : { due_on: touch?.due_on ?? "", reason: touch?.reason ?? "" };

  return (
    <section id="next-touch" className={`${CARD} flex scroll-mt-4 flex-col gap-3 px-5 py-[17px]`}>
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

          {/* Slice 9b, Part 3: all three say what they do, and all three can
              be undone from the toast. Snooze asks how long instead of
              silently adding a week; Skip and Mark done carry their meaning in
              a title and in what the toast says afterwards. The plan put those
              two in a menu -- three pills is the design's own row, and a menu
              to explain two buttons is a menu too many. */}
          <div className="flex flex-wrap gap-[7px]">
            <SnoozeMenu
              touchId={touch.id}
              today={today}
              dueOn={touch.due_on}
              onPickDate={() => {
                setFromSuggestion(false);
                setOpenedAt(saves);
              }}
            />
            <TouchAction
              touchId={touch.id}
              run={() => finishTouch(touch.id, "skipped")}
              idle="Skip"
              busy="Skipping…"
              title="It didn't happen, and you're not picking another day"
              done="Skipped, and nothing is planned now."
            />
            <TouchAction
              touchId={touch.id}
              run={() => finishTouch(touch.id, "done")}
              idle="Mark done"
              busy="Marking…"
              title="It happened. The touch is closed and kept as a record"
              done="Marked done."
            />
            <button
              type="button"
              onClick={() => {
                setFromSuggestion(false);
                setOpenedAt(saves);
              }}
              className="rounded-full px-[11px] py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              Change
            </button>
          </div>
        </>
      ) : (
        <form action={formAction} noValidate className="flex flex-col gap-3">
          {/* The timing the AI chose, carried through the form so accepting a
              suggestion keeps "waiting on them" (slice 9a). A date typed by
              hand sends nothing, and no kind means yours to act on. */}
          {suggested?.kind && <input type="hidden" name="kind" value={suggested.kind} />}
          <div className="flex flex-col gap-1">
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Next touch</h2>
            {suggested ? (
              <p className="text-[12.5px] leading-[1.45] text-info-ink">
                Filled in from the AI summary
                {!suggested.due_on
                  ? " — pick a date"
                  : suggested.rough
                    ? " — the date is a rough guess, so pick a better one"
                    : ""}
                . Check it, then save.
              </p>
            ) : (
              !touch && (
                <p className="text-[12.5px] leading-[1.45] text-ink-soft">
                  Nothing planned. Pick a day to get back in touch, and why.
                </p>
              )
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
              // Slice 9b, Part 6: without this Chrome takes the format from
              // the browser's locale and offers mm/dd/yyyy to somebody in
              // Sweden. The whole app's dates are Swedish time already.
              lang="sv"
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

const GHOST =
  "rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:cursor-default disabled:opacity-60";

/**
 * Snooze, which now asks how long (slice 9b, Part 3).
 *
 * The choices come from lib/relationship/snooze.ts and are sent by NAME, so
 * the server works out the date itself and a POST cannot name a day the menu
 * never offered. Each one shows its date beside it, because "Next month" on
 * its own is the same guess the silent seven days was.
 *
 * A touch due a long way off has no choices at all -- none of them would push
 * it later -- so the pill opens the date form instead of an empty menu.
 */
function SnoozeMenu({
  touchId,
  today,
  dueOn,
  onPickDate,
}: {
  touchId: string;
  today: string;
  dueOn: string;
  onPickDate: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const choices = snoozeChoices(today, dueOn);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = (key: string) => {
    setOpen(false);
    start(async () => {
      const moved = await snoozeTouch(touchId, key);
      if ("error" in moved) {
        toast({ message: moved.error });
        return;
      }
      toast({
        message: `Moved to ${dayMonth(moved.to)}.`,
        action: {
          label: "Undo",
          run: async () => {
            const back = await moveTouchTo(touchId, moved.from);
            if ("error" in back) throw new Error(back.error);
          },
        },
      });
    });
  };

  if (choices.length === 0) {
    return (
      <button type="button" onClick={onPickDate} className={GHOST} title="Pick a later day yourself">
        Snooze
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={GHOST}
      >
        {pending ? "Moving…" : "Snooze"}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          {/* Above the pill: the card sits at the bottom of the page on a
              phone, where a menu below it would be off the screen. */}
          <div
            role="dialog"
            aria-label="Snooze until"
            className="absolute bottom-full left-0 z-20 mb-2 flex w-[240px] flex-col overflow-hidden rounded-[14px] bg-white py-1 shadow-[0_1px_2px_rgba(20,20,25,.06),0_12px_32px_rgba(20,20,25,.14)]"
          >
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => choose(choice.key)}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper-tint"
              >
                <span className="text-[13px] font-semibold text-ink">{choice.label}</span>
                <span className="text-[11.5px] text-ink-soft">{dayMonth(choice.dueOn)}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onPickDate();
              }}
              className="border-t border-line-soft px-4 py-2.5 text-left text-[13px] font-semibold text-ink transition-colors hover:bg-paper-tint"
            >
              Pick a date…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Skip or Mark done, each with an Undo in the toast (slice 9b, Part 3).
 *
 * Closing a touch was the one thing on this card with no way back; everything
 * else was a column you could set again. reopenTouch puts it back on the day
 * it had, unless a newer touch has been set since -- a contact may have only
 * one open touch (migration 0009), and then the toast says so instead of
 * failing quietly.
 */
function TouchAction({
  touchId,
  run,
  idle,
  busy,
  title,
  done,
}: {
  touchId: string;
  run: () => Promise<void>;
  idle: string;
  busy: string;
  title: string;
  /** What the toast says once it has happened. */
  done: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await run();
          toast({
            message: done,
            action: {
              label: "Undo",
              run: async () => {
                const failed = await reopenTouch(touchId);
                if (failed) throw new Error(failed.error);
              },
            },
          });
        })
      }
      className={GHOST}
    >
      {pending ? busy : idle}
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
