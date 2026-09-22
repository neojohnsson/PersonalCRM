"use server";

import { refresh } from "next/cache";
import { readCalendar } from "@/lib/calendar/read";
import { parseNewEvent, type NewEventErrors, type NewEventForm } from "@/lib/calendar/new-event";
import { requireUser } from "@/lib/auth";
import {
  CalendarNotConnected,
  CalendarReconnectRequired,
  calendarConnection,
  disconnectCalendar,
  getCalendarAccessToken,
} from "@/lib/google/calendar-tokens";
import { CalendarReadFailed } from "@/lib/google/calendar";
import { CalendarWriteFailed, createEvent } from "@/lib/google/calendar-create";
import { canWriteCalendar } from "@/lib/google/scopes";
import { todayIn } from "@/lib/relationship/dates";
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
      // Google's own words. "Calendar API has not been used in project … or it
      // is disabled" is an instruction; "it failed" is not.
      return { message: failure.message, tone: "problem" };
    }
    throw failure;
  }
}

/**
 * "Create event" (slice 10; docs/slice-10-plan.md).
 *
 * The only thing in this app that puts something in your calendar, and it runs
 * because you pressed a button on a form you filled in — "a suggestion, never
 * a silent calendar entry" (plan.md §3.4) survives that way.
 *
 * Three checks before Google is asked anything, in this order:
 *
 *   1. who you are, as every Server Action must
 *   2. that Google actually granted the write scope — a calendar connected
 *      before slice 10 has only the read one, and the answer says so in words
 *      rather than failing at Google with a 403
 *   3. the form itself, again, because the browser's copy of these rules is a
 *      convenience and a POST can carry anything
 *
 * No guests can reach Google from here: lib/google/calendar-create.ts has no
 * field for one, and lib/calendar/new-event.ts has nothing that could fill it.
 */
export type CreateEventState =
  | { ok: true; htmlLink: string | null }
  | { ok: false; errors: NewEventErrors; message: string | null }
  | null;

export async function createCalendarEvent(
  previous: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  void previous;
  const user = await requireUser();
  const supabase = await createClient();

  const connection = await calendarConnection(supabase, user.id);
  if (!connection) {
    return { ok: false, errors: {}, message: "The calendar isn't connected." };
  }
  if (!canWriteCalendar(connection.scopes)) {
    return {
      ok: false,
      errors: {},
      message: "Connect your calendar again to let this app create events. Reading still works.",
    };
  }

  const form: NewEventForm = {
    title: String(formData.get("title") ?? ""),
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    minutes: Number(formData.get("minutes") ?? 0),
  };
  const parsed = parseNewEvent(form, todayIn());
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: null };

  try {
    const token = await getCalendarAccessToken(supabase, user.id);
    const created = await createEvent(token, parsed.event);
    // The meetings this app knows about come from a read, so the new event is
    // not on the calendar page until one runs. Say so rather than showing a
    // week that is quietly out of date.
    refresh();
    return { ok: true, htmlLink: created.htmlLink };
  } catch (failure) {
    if (failure instanceof CalendarNotConnected) {
      return { ok: false, errors: {}, message: "The calendar isn't connected." };
    }
    if (failure instanceof CalendarReconnectRequired) {
      return { ok: false, errors: {}, message: "Google no longer accepts the calendar permission. Connect it again." };
    }
    if (failure instanceof CalendarWriteFailed) {
      // Google's own words, as with the read: "insufficient authentication
      // scopes" tells you what to do, "it failed" does not.
      return { ok: false, errors: {}, message: failure.message };
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
