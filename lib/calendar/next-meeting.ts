import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn } from "@/lib/relationship/dates";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * The next meeting already booked with a contact (slice 8a).
 *
 * Used by the two places that suggest a day — the AI summary and the promise
 * scan — so neither suggests writing to somebody you are about to see. The rule
 * itself lives in lib/relationship/touch-date.ts; this only fetches the date.
 *
 * Returns null when the calendar isn't connected, which is the same answer as
 * "nothing booked" and needs no special case anywhere.
 */

/** YYYY-MM-DD in Swedish time, or null. */
export async function nextMeetingWith(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const { data, error } = await db
    .from("calendar_meetings")
    .select("started_at")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("accepted", true)
    // Anything that starts from now on. A meeting this morning is contact that
    // already happened, and warmth has counted it.
    .gte("started_at", now.toISOString())
    .order("started_at")
    .limit(1)
    .maybeSingle<{ started_at: string }>();
  if (error) throw supabaseError(error, "Couldn't check for a booked meeting");

  return data ? todayIn("Europe/Stockholm", new Date(data.started_at)) : null;
}

/** The same for several contacts at once, for the scan. */
export async function nextMeetingsWith(
  db: SupabaseClient,
  userId: string,
  contactIds: string[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();

  const { data, error } = await db
    .from("calendar_meetings")
    .select("contact_id, started_at")
    .eq("user_id", userId)
    .eq("accepted", true)
    .in("contact_id", contactIds)
    .gte("started_at", now.toISOString())
    .order("started_at")
    .returns<{ contact_id: string; started_at: string }[]>();
  if (error) throw supabaseError(error, "Couldn't check for booked meetings");

  // Ordered by date, so the first one seen per contact is the soonest.
  const soonest = new Map<string, string>();
  for (const row of data) {
    if (!soonest.has(row.contact_id)) {
      soonest.set(row.contact_id, todayIn("Europe/Stockholm", new Date(row.started_at)));
    }
  }
  return soonest;
}
