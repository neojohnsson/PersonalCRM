"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { disconnectMyCalendar, readMyCalendar, type CalendarState } from "@/app/connect/calendar-actions";

/**
 * The calendar once it is connected (slice 8a): whose it is, what has been
 * found, and the two things you can do about it.
 *
 * No design covers this. It reuses the Connect screen's own callout box and
 * button shapes, because it belongs to that page and appears in place of the
 * "Connect your calendar" button once the calendar is connected.
 *
 * "Read again" exists because nothing reads the calendar on a schedule. The app
 * has no scheduler, and inventing one for this would be the same mistake as
 * promising a retention period nothing enforces (slice 7, Part 5).
 */
export function CalendarPanel({
  email,
  meetings,
  readThrough,
}: {
  email: string;
  meetings: number;
  /** How far ahead the last read looked, or null if it has never run. */
  readThrough: string | null;
}) {
  const [state, read] = useActionState<CalendarState, FormData>(readMyCalendar, null);

  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-white px-[18px] py-4 shadow-[0_1px_2px_rgba(20,20,25,.05)]">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Calendar connected</span>
        <span className="text-[12.5px] text-ink-faint">{email}</span>
      </div>

      <p className="text-[12.5px] leading-[1.5] text-ink-soft">
        {meetings === 0
          ? readThrough
            ? "No meetings with your contacts yet. Only events with someone already in your contacts are stored."
            : "Nothing read yet. Press Read my calendar to look at the last three months and the next two."
          : `${meetings === 1 ? "1 meeting" : `${meetings} meetings`} with your contacts. Each one counts towards how warm that contact is.`}
      </p>

      {state && (
        <p
          role="status"
          className={`text-[12px] leading-[1.5] font-medium ${state.tone === "problem" ? "text-accent" : "text-ink-quiet"}`}
        >
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap gap-[7px]">
        <form action={read}>
          <Pill idle="Read my calendar" busy="Reading…" solid />
        </form>
        <form action={disconnectMyCalendar}>
          <Pill idle="Disconnect calendar" busy="Disconnecting…" />
        </form>
      </div>

      <p className="text-[11.5px] leading-[1.5] text-ink-faint">
        Disconnecting gives the permission back to Google and deletes the meetings it was used
        to read. Nothing in your calendar is ever changed either way.
      </p>
    </div>
  );
}

function Pill({ idle, busy, solid = false }: { idle: string; busy: string; solid?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-full px-[15px] py-2 text-[12px] font-semibold transition disabled:cursor-default disabled:opacity-50 ${
        solid
          ? "bg-ink-deep text-white hover:bg-ink/85"
          : "bg-line-soft text-ink-body hover:bg-chip-track"
      }`}
    >
      {pending ? busy : idle}
    </button>
  );
}
