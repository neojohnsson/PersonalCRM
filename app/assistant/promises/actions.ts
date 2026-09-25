"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { AiCapReached, limitMessage } from "@/lib/ai/spend";
import { scanForPromises } from "@/lib/ai/promise-scan";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { isIsoDate } from "@/lib/relationship/dates";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Deciding a promise, and looking for more (docs/slice-6d-plan.md).
 *
 * Accepting is the only thing here that creates anything, and what it creates
 * is an open next touch — the thing the rest of the app already understands.
 * Nothing the scan finds ever becomes one on its own (AGENTS.md).
 *
 * Each action checks the user itself and runs as them, so RLS and the composite
 * foreign keys of migration 0019 decide what they may touch.
 *
 * Since slice 11 promises are part of the Assistant (docs/slice-11-plan.md
 * §8): you ask it to look, its card runs the scan, and what it finds waits
 * on /assistant/promises. So each action also checks the Assistant is yours,
 * as the page does — a POST does not come through the page.
 */

const UNIQUE_VIOLATION = "23505";

/** Drop reasons in words, for the line the scan card shows when it found nothing. */
const REFUSED = {
  no_such_message: "about a message that wasn't there",
  not_quoted: "not quoted from the message",
  negated: "as negations",
  no_date: "with no date to act on",
  date_too_far: "dated too far off",
  empty_reason: "with nothing written",
  duplicate: "already offered",
  over_the_cap: "over the per-contact limit",
  later_than_plan: "dated after the next touch you already have",
} as const;

export type DecideState = { error: string } | null;

type PromiseRow = {
  id: string;
  contact_id: string;
  due_on: string;
  reason: string;
  owed_by: "you" | "them";
};

/**
 * Accept: the promise becomes a next touch, dated. `dueOn` lets the form send a
 * different day from the one suggested — the date is yours, not the model's.
 */
export async function acceptPromise(
  promiseId: string,
  previous: DecideState,
  formData: FormData,
): Promise<DecideState> {
  const user = await requireUser();
  if (!isUuid(promiseId)) notFound();

  const asked = String(formData.get("due_on") ?? "").trim();
  if (asked && !isIsoDate(asked)) return { error: "That isn't a date." };

  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();
  const { data: promise, error } = await supabase
    .from("promises")
    .select("id, contact_id, due_on, reason, owed_by")
    .eq("user_id", user.id)
    .eq("id", promiseId)
    .eq("status", "pending")
    .maybeSingle<PromiseRow>();
  if (error) throw supabaseError(error, "Couldn't load the promise");
  if (!promise) notFound();

  const dueOn = asked || promise.due_on;

  // One open touch per contact (migration 0009). A promise is only offered when
  // it falls before the touch the contact already has, so accepting moves that
  // day forward rather than making a second one. The row said so before you
  // pressed; this is where it happens.
  const { data: open, error: openError } = await supabase
    .from("next_touches")
    .select("id")
    .eq("user_id", user.id)
    .eq("contact_id", promise.contact_id)
    .eq("status", "open")
    .maybeSingle<{ id: string }>();
  if (openError) throw supabaseError(openError, "Couldn't check the next touch");

  // A promise already says whose move it is, which is exactly the kind a touch
  // needs: theirs means the app must not offer to draft anything (slice 9a).
  const kind = promise.owed_by === "them" ? "they_will_get_back" : "reply_owed";

  const saved = open
    ? await supabase
        .from("next_touches")
        .update({ due_on: dueOn, reason: promise.reason, kind, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", open.id)
        .eq("status", "open")
        .select("id")
        .single()
    : await supabase
        .from("next_touches")
        .insert({
          user_id: user.id,
          contact_id: promise.contact_id,
          due_on: dueOn,
          reason: promise.reason,
          kind,
        })
        .select("id")
        .single();

  const touch = saved.data;
  const touchError = saved.error;
  // Somebody set one in another tab between the check and now.
  if (touchError?.code === UNIQUE_VIOLATION) {
    return { error: "There's already a next touch for this contact. Open them to change it." };
  }
  if (touchError || !touch) throw supabaseError(touchError!, "Couldn't save the next touch");

  const { error: decideError } = await supabase
    .from("promises")
    .update({ status: "accepted", decided_at: new Date().toISOString(), next_touch_id: touch.id })
    .eq("user_id", user.id)
    .eq("id", promiseId)
    .eq("status", "pending");
  if (decideError) throw supabaseError(decideError, "Couldn't record the decision");

  refresh();
  return null;
}

/**
 * "Not a promise": the row is kept, marked dismissed. Kept rather than deleted
 * because the unique index on the message is what stops the next scan finding
 * it all over again.
 */
export async function dismissPromise(promiseId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(promiseId)) notFound();

  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();
  const { error } = await supabase
    .from("promises")
    .update({ status: "dismissed", decided_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", promiseId)
    .eq("status", "pending");
  if (error) throw supabaseError(error, "Couldn't dismiss the promise");

  refresh();
}

export type ScanState = { message: string; tone: "ok" | "problem" } | null;

/** The scan card's "Read my mail": read the contacts worth reading, and write what's found. */
export async function runScan(): Promise<ScanState> {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();

  try {
    const result = await scanForPromises(supabase, user.id);
    const read = `Read ${result.read === 1 ? "1 contact" : `${result.read} contacts`}`;
    const found =
      result.found === 0 ? "nothing to decide" : `${result.found} ${result.found === 1 ? "promise" : "promises"}`;
    const trouble = result.failed > 0 ? `, and couldn't read ${result.failed}` : "";
    const capped = result.stoppedAtCap ? ". Stopped at the monthly limit." : "";
    const left = result.remaining > 0 ? ` ${result.remaining} still to read.` : "";
    // When it found nothing, say what it turned down — otherwise "nothing to
    // decide" hides the difference between an empty mailbox and rules that are
    // too strict.
    const refused = Object.entries(result.dropped)
      .map(([reason, count]) => `${count} ${REFUSED[reason as keyof typeof REFUSED] ?? reason}`)
      .join(", ");
    const why = result.found === 0 && refused ? ` Turned down ${refused}.` : "";

    refresh();
    return {
      message: `${read}: ${found}${trouble}${capped}${why}${left}`,
      tone: result.stoppedAtCap ? "problem" : "ok",
    };
  } catch (failure) {
    if (failure instanceof AiCapReached) {
      return { message: `${limitMessage(failure)} Nothing was read.`, tone: "problem" };
    }
    throw failure;
  }
}
