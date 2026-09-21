"use server";

import { refresh } from "next/cache";
import { readCalendar } from "@/lib/calendar/read";
import { requireUser } from "@/lib/auth";
import { CalendarNotConnected, CalendarReconnectRequired, disconnectCalendar } from "@/lib/google/calendar-tokens";
import { CalendarReadFailed } from "@/lib/google/calendar";
import { createClient } from "@/lib/supabase/server";

/**
 * Reading the calendar, and giving it back (slice 8a).
 *
 * A file of its own rather than more functions in app/connect/actions.ts: that
 * one is hand-written and holds the Gmail connection, and the two connections
 * are kept apart everywhere else for the same reason.
 */

export type CalendarState = { message: string; tone: "ok" | "problem" } | null;

/** "Read my calendar": the window around today, and what it found. */
export async function readMyCalendar(): Promise<CalendarState> {
  const user = await requireUser();
  const supabase = await createClient();

  try {
    const result = await readCalendar(supabase, user.id);
    refresh();

    if (result.meetings === 0) {
      return {
        message: `Read ${result.events} ${result.events === 1 ? "event" : "events"}: none of them were meetings with a contact.`,
        tone: "ok",
      };
    }
    return {
      message:
        `${result.meetings} ${result.meetings === 1 ? "meeting" : "meetings"} with your contacts` +
        (result.removed > 0 ? `, and ${result.removed} that had been cancelled` : "") +
        ".",
      tone: "ok",
    };
  } catch (failure) {
    if (failure instanceof CalendarNotConnected) {
      return { message: "The calendar isn't connected.", tone: "problem" };
    }
    if (failure instanceof CalendarReconnectRequired) {
      return {
        message: "Google no longer accepts the calendar permission. Connect it again below.",
        tone: "problem",
      };
    }
    if (failure instanceof CalendarReadFailed) {
      return { message: "Google refused the calendar read. Try again in a minute.", tone: "problem" };
    }
    throw failure;
  }
}

/** Give the permission back, and forget the meetings it was used to read. */
export async function disconnectMyCalendar(): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  await disconnectCalendar(supabase, user.id);
  refresh();
}
