"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { daysBetweenDates, isIsoDate, todayIn } from "@/lib/relationship/dates";
import {
  MAX_DAYS_AHEAD,
  NewerTouchExists,
  NextTouchNotFound,
  finishNextTouch,
  moveNextTouch,
  openNextTouchById,
  parseNextTouchForm,
  reopenNextTouch,
  setNextTouch,
  type NextTouchErrors,
  type NextTouchValues,
} from "@/lib/relationship/next-touch";
import { snoozeDate } from "@/lib/relationship/snooze";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The Next touch card's buttons (docs/slice-3-plan.md, Part 3).
 *
 * A Server Action can be called by anyone who sends it a POST, so each one
 * checks the user itself and runs as them: RLS and the composite foreign key
 * of migration 0009 decide which contacts and touches they may change. The ids
 * are bound by the page (`.bind(null, …)`), and checked here because a POST can
 * carry anything.
 */

export type SetNextTouchState = {
  errors: NextTouchErrors;
  values: NextTouchValues;
  /** Bumped on every successful save, so the card knows to close its form. */
  saved: number;
} | null;

const FOREIGN_KEY_VIOLATION = "23503";
const NOT_FOUND = "P0002";

/** "Set" / "Save": give the contact a next touch, or change the one they have. */
export async function saveNextTouch(
  contactId: string,
  previous: SetNextTouchState,
  formData: FormData,
): Promise<SetNextTouchState> {
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();

  const parsed = parseNextTouchForm(formData, todayIn());
  if (!parsed.ok) {
    return { errors: parsed.errors, values: parsed.values, saved: previous?.saved ?? 0 };
  }

  const supabase = await createClient();
  try {
    await setNextTouch(supabase, user.id, contactId, parsed.touch);
  } catch (error) {
    // The contact isn't theirs, or is gone: the same answer either way.
    if (causeCode(error) === FOREIGN_KEY_VIOLATION) notFound();
    throw error;
  }

  refresh();
  return {
    errors: {},
    values: { due_on: parsed.touch.dueOn, reason: parsed.touch.reason ?? "" },
    saved: (previous?.saved ?? 0) + 1,
  };
}

/**
 * "Snooze", and the Undo of one: the touch moves to a day you chose.
 *
 * Slice 9b, Part 3. It used to add seven days and say nothing. The card now
 * offers Tomorrow, Next week, Next month or a date of your own, and sends the
 * choice by name -- lib/relationship/snooze.ts turns that name back into a
 * date here, so a POST cannot name a day the buttons never offered.
 *
 * `to` is a date instead, which is the "Pick a date" path and the Undo path:
 * putting a snooze back means moving the touch to the day it had, and that day
 * is in the past for an overdue touch, which no choice would ever produce.
 *
 * It answers with the day the touch had, so the toast can offer to put it
 * back. Unlike a row on a list, this page does refresh at once: it is about
 * this one contact, and the date on the card is the thing you just changed.
 */
export type MovedTouch = { from: string; to: string } | { error: string };

export async function snoozeTouch(touchId: string, choice: string): Promise<MovedTouch> {
  const user = await requireUser();
  if (!isUuid(touchId)) notFound();

  const supabase = await createClient();
  const touch = await openNextTouchById(supabase, user.id, touchId);
  if (!touch) return { error: "That next touch isn't open any more." };

  const dueOn = snoozeDate(todayIn(), touch.due_on, choice);
  if (!dueOn) notFound();

  return move(supabase, user.id, touchId, dueOn);
}

/** "Pick a date" on the Snooze menu, and Undo, which moves it back. */
export async function moveTouchTo(touchId: string, dueOn: string): Promise<MovedTouch> {
  const user = await requireUser();
  if (!isUuid(touchId)) notFound();
  if (!isIsoDate(dueOn)) notFound();
  if (daysBetweenDates(todayIn(), dueOn) > MAX_DAYS_AHEAD) notFound();

  return move(await createClient(), user.id, touchId, dueOn);
}

async function move(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  touchId: string,
  dueOn: string,
): Promise<MovedTouch> {
  try {
    const { from } = await moveNextTouch(supabase, userId, touchId, dueOn);
    refresh();
    return { from, to: dueOn };
  } catch (error) {
    if (error instanceof NextTouchNotFound) return { error: error.message };
    throw error;
  }
}

/** Undo of Skip and Mark done: open again, on the day it had. */
export async function reopenTouch(touchId: string): Promise<{ error: string } | null> {
  const user = await requireUser();
  if (!isUuid(touchId)) notFound();

  try {
    await reopenNextTouch(await createClient(), user.id, touchId);
  } catch (error) {
    if (error instanceof NewerTouchExists || error instanceof NextTouchNotFound) {
      return { error: error.message };
    }
    throw error;
  }
  refresh();
  return null;
}

/** "Skip" and "Mark done". */
export async function finishTouch(touchId: string, outcome: "done" | "skipped"): Promise<void> {
  const user = await requireUser();
  if (!isUuid(touchId)) notFound();
  if (outcome !== "done" && outcome !== "skipped") notFound();

  const supabase = await createClient();
  await closedIsFine(() => finishNextTouch(supabase, user.id, touchId, outcome));
  refresh();
}

/**
 * "Dismiss" on the contact page: every address is remembered as dismissed, the
 * mail they sent is deleted, and so is the contact (migration 0012). Then back
 * to the contact list — this page no longer exists.
 */
export async function dismissContact(contactId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();

  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_contact", {
    p_user_id: user.id,
    p_contact_id: contactId,
  });
  // Already gone (another tab), or never theirs: the same answer either way.
  if (error?.code === NOT_FOUND) notFound();
  if (error) throw supabaseError(error, "Couldn't dismiss the contact");

  redirect("/contacts");
}

/**
 * A touch that's no longer open — closed in another tab, or never theirs —
 * isn't an error worth a crash: the refreshed page shows how things stand.
 */
async function closedIsFine(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof NextTouchNotFound)) throw error;
  }
}

function causeCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  return cause?.code;
}
