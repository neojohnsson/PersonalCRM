import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { meetingRows, meetingsFrom, type Meetings } from "@/lib/calendar/meetings";
import { getCalendarAccessToken } from "@/lib/google/calendar-tokens";
import { listEvents } from "@/lib/google/calendar";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";

/**
 * Reading the calendar and keeping the meetings that count
 * (slice 8a; docs/slice-8-plan.md, Part 2).
 *
 * The whole window is re-read every time rather than carrying on from a
 * position. Two reasons: a calendar is not a log — a meeting can move, be
 * cancelled or gain a guest after it was first read, and an incremental read
 * would keep the stale version for ever. And it is cheap: 150 days of one
 * person's calendar is one or two requests, against a quota measured in
 * millions.
 *
 * So the read is: ask for the window, work out the meetings, write them, and
 * delete anything still stored inside the window that Google no longer reports.
 * That last step is what makes a cancelled meeting disappear instead of warming
 * a relationship for ever.
 */

/** How far back a read looks. Warmth stops counting a contact after 90 days. */
export const DAYS_BACK = 90;

/** And forward, for "you are seeing them on Monday" and "that day is full". */
export const DAYS_FORWARD = 60;

export type CalendarReadResult = {
  /** Events Google returned in the window. */
  events: number;
  /** Meetings with at least one contact. */
  meetings: number;
  /** Rows written: one per contact per meeting. */
  rows: number;
  /** Stored meetings removed because Google no longer reports them. */
  removed: number;
  skipped: Meetings["skipped"];
};

export type ReadOptions = {
  now?: Date;
  /** Tests pass a fake; the default refreshes the stored calendar token. */
  accessToken?: (db: SupabaseClient, userId: string) => Promise<string>;
};

export async function readCalendar(
  db: SupabaseClient,
  userId: string,
  options: ReadOptions = {},
): Promise<CalendarReadResult> {
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - DAYS_BACK * 86_400_000);
  const to = new Date(now.getTime() + DAYS_FORWARD * 86_400_000);

  const token = await (options.accessToken ?? getCalendarAccessToken)(db, userId);
  const events = await listEvents(token, { from, to });

  // The same address-to-person matching the mail sync uses, so somebody is the
  // same somebody whether they emailed or turned up.
  const addresses = await readAll<{ contact_id: string; email: string }>(
    (start, end) =>
      db.from("contact_emails").select("contact_id, email").eq("user_id", userId).order("id").range(start, end),
    "Couldn't load contact addresses",
  );
  const addressToContact = new Map(addresses.map((row) => [row.email.toLowerCase(), row.contact_id]));

  const { meetings, skipped } = meetingsFrom(events, addressToContact);
  const rows = meetingRows(userId, meetings);

  if (rows.length > 0) {
    const { error } = await db
      .from("calendar_meetings")
      .upsert(rows, { onConflict: "user_id,contact_id,event_id" });
    if (error) throw supabaseError(error, "Couldn't save the meetings");
  }

  const removed = await removeVanished(db, userId, from, to, new Set(meetings.map((m) => m.eventId)));

  // Everything up to this moment has been read, which is what the column says.
  const { error: markError } = await db
    .from("google_calendar")
    .update({ synced_through: to.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", userId);
  if (markError) throw supabaseError(markError, "Couldn't record the calendar read");

  return { events: events.length, meetings: meetings.length, rows: rows.length, removed, skipped };
}

/**
 * Meetings stored inside the window that Google no longer reports: cancelled,
 * moved out of the window, or a guest list that no longer includes anyone known.
 *
 * Only inside the window. A meeting from two years ago is not evidence that
 * Google forgot it — it is evidence that nobody asked.
 */
async function removeVanished(
  db: SupabaseClient,
  userId: string,
  from: Date,
  to: Date,
  stillThere: Set<string>,
): Promise<number> {
  const { data, error } = await db
    .from("calendar_meetings")
    .select("event_id, contact_id")
    .eq("user_id", userId)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .returns<{ event_id: string; contact_id: string }[]>();
  if (error) throw supabaseError(error, "Couldn't check the stored meetings");

  const gone = [...new Set(data.filter((row) => !stillThere.has(row.event_id)).map((row) => row.event_id))];
  if (gone.length === 0) return 0;

  const { error: deleteError, count } = await db
    .from("calendar_meetings")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("event_id", gone);
  if (deleteError) throw supabaseError(deleteError, "Couldn't remove the cancelled meetings");

  return count ?? 0;
}
