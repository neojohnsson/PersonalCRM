"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { AiCapReached } from "@/lib/ai/spend";
import { scanForPromises } from "@/lib/ai/promise-scan";
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
 */

const UNIQUE_VIOLATION = "23505";

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

  const { data: touch, error: touchError } = await supabase
    .from("next_touches")
    .insert({
      user_id: user.id,
      contact_id: promise.contact_id,
      due_on: dueOn,
      reason: promise.reason,
    })
    .select("id")
    .single();
  // One open touch per contact (migration 0009). Somebody set one between the
  // scan and now: their date wins, and the promise stays for them to decide.
  if (touchError?.code === UNIQUE_VIOLATION) {
    return { error: "There's already a next touch for this contact. Open them to change it." };
  }
  if (touchError) throw supabaseError(touchError, "Couldn't create the next touch");

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

/** "Look for promises": read the contacts worth reading, and write what's found. */
export async function runScan(): Promise<ScanState> {
  const user = await requireUser();
  const supabase = await createClient();

  try {
    const result = await scanForPromises(supabase, user.id);
    const read = `Read ${result.read === 1 ? "1 contact" : `${result.read} contacts`}`;
    const found =
      result.found === 0 ? "nothing to decide" : `${result.found} ${result.found === 1 ? "promise" : "promises"}`;
    const trouble = result.failed > 0 ? `, and couldn't read ${result.failed}` : "";
    const capped = result.stoppedAtCap ? ". Stopped at the monthly limit." : "";
    const left = result.remaining > 0 ? ` ${result.remaining} still to read.` : "";

    refresh();
    return {
      message: `${read}: ${found}${trouble}${capped}${left}`,
      tone: result.stoppedAtCap ? "problem" : "ok",
    };
  } catch (failure) {
    if (failure instanceof AiCapReached) {
      return { message: "The monthly AI limit is reached, so nothing was read.", tone: "problem" };
    }
    throw failure;
  }
}
