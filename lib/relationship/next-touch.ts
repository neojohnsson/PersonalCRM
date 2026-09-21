import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, daysBetweenDates, isIsoDate, laterDate } from "@/lib/relationship/dates";
import { isTiming } from "@/lib/relationship/touch-date";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Next touch: a date and a reason to get back in touch with a contact, set by
 * hand (plan.md §3.4; docs/slice-3-plan.md, Part 3).
 *
 *   set        the contact's open touch gets this date and reason — created if
 *              there isn't one
 *   snooze     a week after whichever is later: the due date or today
 *   mark done  it happened; the touch is closed and kept as a record
 *   skip       dropped without doing it; closed too
 *
 * At most one open touch per contact is enforced by the database
 * (migration 0009). Every function takes the client and user id and filters by
 * user_id itself; RLS decides the rest.
 */

export const MAX_REASON_LENGTH = 300;
export const SNOOZE_DAYS = 7;
export const MAX_DAYS_AHEAD = 5 * 366;

export type NextTouchStatus = "open" | "done" | "skipped";

export type NextTouch = {
  id: string;
  contact_id: string;
  due_on: string;
  reason: string | null;
  status: NextTouchStatus;
  /**
   * What sort of touch it is (migration 0023). Null for every touch made
   * before 2026-09-21 and for every one typed in by hand, and treated as
   * yours to act on — which is how all of them behaved before.
   */
  kind: string | null;
};

const COLUMNS = "id, contact_id, due_on, reason, status, kind";

/** The touch doesn't exist, isn't open any more, or isn't the caller's. */
export class NextTouchNotFound extends Error {
  constructor() {
    super("That next touch isn't open any more.");
    this.name = "NextTouchNotFound";
  }
}

// ── The form ────────────────────────────────────────────────────────────────

export type NextTouchInput = { dueOn: string; reason: string | null; kind?: string | null };
export type NextTouchErrors = Partial<Record<"due_on" | "reason", string>>;
export type NextTouchValues = { due_on: string; reason: string };

export type ParsedNextTouch =
  | { ok: true; touch: NextTouchInput }
  | { ok: false; errors: NextTouchErrors; values: NextTouchValues };

/** Reads and checks the set-next-touch form. `today` is YYYY-MM-DD. */
export function parseNextTouchForm(formData: FormData, today: string): ParsedNextTouch {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const values = { due_on: text("due_on").trim(), reason: text("reason") };
  const errors: NextTouchErrors = {};

  if (!values.due_on) {
    errors.due_on = "Pick a date.";
  } else if (!isIsoDate(values.due_on)) {
    errors.due_on = "Use a real date.";
  } else if (values.due_on < today) {
    errors.due_on = "Pick today or a later date.";
  } else if (daysBetweenDates(today, values.due_on) > MAX_DAYS_AHEAD) {
    errors.due_on = "Pick a date within five years.";
  }

  const reason = values.reason.trim();
  if (reason.length > MAX_REASON_LENGTH) {
    errors.reason = `Keep it under ${MAX_REASON_LENGTH} characters.`;
  }

  // The timing the AI chose, when the form is accepting a suggestion. Only a
  // kind the app understands is kept: a POST can carry anything, and a kind
  // nothing recognises would be shown to you as if it meant something.
  const offered = text("kind").trim();
  const kind = isTiming(offered) ? offered : null;

  return Object.keys(errors).length > 0
    ? { ok: false, errors, values }
    : { ok: true, touch: { dueOn: values.due_on, reason: reason || null, kind } };
}

// ── Reading and writing ─────────────────────────────────────────────────────

/** The contact's open touch, if it has one. */
export async function openNextTouch(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<NextTouch | null> {
  const { data, error } = await db
    .from("next_touches")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .maybeSingle<NextTouch>();
  if (error) throw supabaseError(error, "Couldn't load the next touch");
  return data;
}

/** The open touches of several contacts at once, by contact id. */
export async function openNextTouches(
  db: SupabaseClient,
  userId: string,
  contactIds: string[],
): Promise<Map<string, NextTouch>> {
  if (contactIds.length === 0) return new Map();

  const { data, error } = await db
    .from("next_touches")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("status", "open")
    .in("contact_id", contactIds)
    .returns<NextTouch[]>();
  if (error) throw supabaseError(error, "Couldn't load the next touches");

  return new Map(data.map((touch) => [touch.contact_id, touch]));
}

/**
 * Give the contact's open touch this date and reason, creating it if there
 * isn't one.
 *
 * Update first, then insert. If two saves race, both find nothing to update and
 * both insert — the "one open touch per contact" index lets only one through
 * (23505), and the loser updates the winner's row instead.
 */
export async function setNextTouch(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  input: NextTouchInput,
): Promise<NextTouch> {
  const update = () =>
    db
      .from("next_touches")
      .update({
        due_on: input.dueOn,
        reason: input.reason,
        // A hand-typed date has no kind, and saying so is the point: it clears
        // a stale "waiting on them" from a suggestion you have since changed.
        kind: input.kind ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .select(COLUMNS)
      .returns<NextTouch[]>();

  const updated = await update();
  if (updated.error) throw supabaseError(updated.error, "Couldn't save the next touch");
  if (updated.data.length > 0) return updated.data[0];

  const inserted = await db
    .from("next_touches")
    .insert({
      user_id: userId,
      contact_id: contactId,
      due_on: input.dueOn,
      reason: input.reason,
      kind: input.kind ?? null,
    })
    .select(COLUMNS)
    .single<NextTouch>();

  if (inserted.error?.code === "23505") {
    const retried = await update();
    if (retried.error) throw supabaseError(retried.error, "Couldn't save the next touch");
    if (retried.data.length > 0) return retried.data[0];
  }
  if (inserted.error) throw supabaseError(inserted.error, "Couldn't save the next touch");

  return inserted.data;
}

/**
 * Move an open touch a week later — counted from the due date, or from today if
 * it's already overdue, so a snoozed touch is never still in the past.
 */
export async function snoozeNextTouch(
  db: SupabaseClient,
  userId: string,
  touchId: string,
  today: string,
): Promise<NextTouch> {
  const { data: current, error } = await db
    .from("next_touches")
    .select(COLUMNS)
    .eq("id", touchId)
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle<NextTouch>();
  if (error) throw supabaseError(error, "Couldn't load the next touch");
  if (!current) throw new NextTouchNotFound();

  const dueOn = addDays(laterDate(current.due_on, today), SNOOZE_DAYS);

  // Only if it still has the date this step read: a second press of Snooze in
  // another tab can't push it two weeks.
  const { data, error: updateError } = await db
    .from("next_touches")
    .update({ due_on: dueOn, updated_at: new Date().toISOString() })
    .eq("id", touchId)
    .eq("user_id", userId)
    .eq("status", "open")
    .eq("due_on", current.due_on)
    .select(COLUMNS)
    .returns<NextTouch[]>();
  if (updateError) throw supabaseError(updateError, "Couldn't snooze the next touch");
  if (data.length === 0) throw new NextTouchNotFound();

  return data[0];
}

/** Close an open touch as done or skipped. */
export async function finishNextTouch(
  db: SupabaseClient,
  userId: string,
  touchId: string,
  outcome: "done" | "skipped",
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("next_touches")
    .update({ status: outcome, completed_at: now, updated_at: now })
    .eq("id", touchId)
    .eq("user_id", userId)
    .eq("status", "open")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't update the next touch");
  if (data.length === 0) throw new NextTouchNotFound();
}
