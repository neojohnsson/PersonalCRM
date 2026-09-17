"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { todayIn } from "@/lib/relationship/dates";
import {
  NextTouchNotFound,
  finishNextTouch,
  parseNextTouchForm,
  setNextTouch,
  snoozeNextTouch,
  type NextTouchErrors,
  type NextTouchValues,
} from "@/lib/relationship/next-touch";
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

/** "Snooze": a week later. */
export async function snoozeTouch(touchId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(touchId)) notFound();

  const supabase = await createClient();
  await closedIsFine(() => snoozeNextTouch(supabase, user.id, touchId, todayIn()));
  refresh();
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
