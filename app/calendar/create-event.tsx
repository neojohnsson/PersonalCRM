"use client";

import { useActionState, useState } from "react";
import { createCalendarEvent, type CreateEventState } from "@/app/connect/calendar-actions";
import { useToast } from "@/app/toasts";
import { DURATIONS } from "@/lib/calendar/new-event";

/**
 * "Create event" — the form this app puts things in your calendar with
 * (slice 10; docs/slice-10-plan.md, decision 4).
 *
 * No design covers it: slice 8b's calendar screen was drawn read-only. It is
 * the Next touch card's form, field for field, because it asks the same kind
 * of thing and this app should not have two shapes of small form.
 *
 * What it will not do, on purpose and visibly:
 *
 *   - no guests. It says so under the button, because somebody will look for
 *     the field, and the honest answer is that inviting people is Google's job
 *     (an invitation is mail this app would be causing).
 *   - no undo afterwards. Slice 9b gave five actions one; this one instead
 *     links to the event in Google Calendar, where you can move or delete it
 *     with the tool that owns it. Keeping a delete path for the sake of eight
 *     seconds is the trade this slice refused (see the plan).
 *
 * Nothing is created until the button is pressed, which is the whole point:
 * "a suggestion, never a silent calendar entry" (plan.md §3.4).
 */
export function CreateEvent({
  /** YYYY-MM-DD the form opens on: the day you were looking at. */
  today,
  /** Prefilled title — a contact page passes "Time with Karin Lindqvist". */
  suggestedTitle = "",
  /** False when the calendar is connected without the write permission. */
  canCreate,
  label = "Create event",
}: {
  today: string;
  suggestedTitle?: string;
  canCreate: boolean;
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CreateEventState, FormData>(
    async (previous, formData) => {
      const answer = await createCalendarEvent(previous, formData);
      if (answer?.ok) {
        setOpen(false);
        toast({
          message: "Event created.",
          action: answer.htmlLink
            ? {
                label: "Open in Google",
                run: async () => {
                  window.open(answer.htmlLink!, "_blank", "noopener");
                },
              }
            : undefined,
        });
      }
      return answer;
    },
    null,
  );

  // A calendar connected before slice 10 has only the read permission. Saying
  // nothing would leave a button that fails; a disabled button would leave you
  // guessing why.
  if (!canCreate) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={PILL}>
        <PlusIcon />
        {label}
      </button>
    );
  }

  const errors = state?.ok === false ? state.errors : {};
  const message = state?.ok === false ? state.message : null;

  return (
    <form
      action={action}
      noValidate
      className="flex w-full max-w-[420px] flex-col gap-3 rounded-xl bg-white px-5 py-[17px] shadow-[0_1px_2px_rgba(20,20,25,.06),0_12px_32px_rgba(20,20,25,.14)]"
    >
      <h2 className="text-base font-bold tracking-[-0.015em]">New event</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-title" className={LABEL}>
          What
        </label>
        <input
          id="event-title"
          name="title"
          type="text"
          defaultValue={suggestedTitle}
          placeholder="Coffee with Karin"
          aria-invalid={errors.title ? true : undefined}
          className={INPUT}
        />
        <FieldError message={errors.title} />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
          <label htmlFor="event-date" className={LABEL}>
            Day
          </label>
          {/* lang="sv" for the same reason as the next touch's date (slice 9b). */}
          <input
            id="event-date"
            name="date"
            type="date"
            lang="sv"
            min={today}
            defaultValue={today}
            aria-invalid={errors.date ? true : undefined}
            className={INPUT}
          />
          <FieldError message={errors.date} />
        </div>

        <div className="flex w-[104px] flex-col gap-1.5">
          <label htmlFor="event-time" className={LABEL}>
            From
          </label>
          <input
            id="event-time"
            name="time"
            type="time"
            step={300}
            defaultValue="09:00"
            aria-invalid={errors.time ? true : undefined}
            className={INPUT}
          />
          <FieldError message={errors.time} />
        </div>

        <div className="flex w-[104px] flex-col gap-1.5">
          <label htmlFor="event-minutes" className={LABEL}>
            For
          </label>
          <select id="event-minutes" name="minutes" defaultValue={30} className={INPUT}>
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`}
              </option>
            ))}
          </select>
          <FieldError message={errors.minutes} />
        </div>
      </div>

      {message && (
        <p role="alert" className="text-xs font-normal text-accent">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-[7px] pt-0.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink-deep px-[15px] py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create event"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full bg-line-soft px-[14px] py-2 text-sm font-semibold text-ink-body transition-colors hover:bg-chip-track"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs font-normal text-ink-soft">
        It goes on your own calendar, with <strong className="font-semibold">no guests</strong> — a
        guest list would make Google email an invitation, and this app never causes mail to reach
        anybody. Add people in Google Calendar yourself.
      </p>
    </form>
  );
}

const PILL =
  "flex items-center gap-[7px] rounded-full bg-ink-deep px-4 py-[9px] text-sm font-semibold text-white transition hover:bg-ink/85";
const LABEL = "text-2xs font-bold tracking-[0.07em] text-ink-meta uppercase";
const INPUT =
  "w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink transition placeholder:text-ink-soft focus:border-ink-soft aria-invalid:border-accent";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-normal text-accent">
      {message}
    </p>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      className="size-3.5"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
