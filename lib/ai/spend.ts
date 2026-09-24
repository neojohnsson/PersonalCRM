import type { SupabaseClient } from "@supabase/supabase-js";
import { costOf, type TokenUsage } from "@/lib/ai/models";
import { OpenAiNoAnswer } from "@/lib/ai/openai";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * The monthly cap around one AI request (docs/slice-4-plan.md, Part 2):
 *
 *   1. reserve the most the request could cost — or stop here, with nothing
 *      sent, if that would pass the cap (reserve_ai_spend, migration 0010)
 *   2. run the request
 *   3. record what it really cost (settle_ai_spend), whether it worked or not
 *
 * Every AI request in the app goes through `withSpendCap`. There's no other
 * way to call the model with a cap attached, so there's no way to forget it.
 */

/** The cap is reached: the request was never sent. */
export class AiCapReached extends Error {
  spentUsd: number;
  capUsd: number;
  constructor(spentUsd: number, capUsd: number) {
    super(`This month's AI budget is used up ($${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}).`);
    this.name = "AiCapReached";
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

export type SpendRequest = {
  contactId: string | null;
  purpose: "summary" | "draft" | "promises" | "assistant" | "research";
  model: string;
  /** From maxCostOf: the most this request could cost. */
  estimateUsd: number;
  capUsd: number;
  /**
   * Cost beyond tokens if the work fails before saying what it spent -- a
   * web search is paid per search, and a request cut off after searching has
   * still searched. Charged in full then: too much, never too little.
   */
  extraUsdIfFailed?: number;
};

export async function withSpendCap<T>(
  db: SupabaseClient,
  userId: string,
  request: SpendRequest,
  work: () => Promise<{ result: T; usage: TokenUsage; extraUsd?: number }>,
): Promise<T> {
  const { data: usageId, error } = await db.rpc("reserve_ai_spend", {
    p_user_id: userId,
    p_contact_id: request.contactId,
    p_purpose: request.purpose,
    p_model: request.model,
    p_estimate: request.estimateUsd,
    p_cap: request.capUsd,
  });
  if (error) {
    if (error.message === "ai_cap_reached") throw new AiCapReached(Number(error.details), request.capUsd);
    throw supabaseError(error, "Couldn't reserve AI spending");
  }

  let usage: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  // What it cost beyond tokens: web searches (slice 12).
  let extraUsd = 0;
  try {
    const done = await work();
    usage = done.usage;
    extraUsd = done.extraUsd ?? 0;
    return done.result;
  } catch (failure) {
    // A refusal or a cut-off answer still used tokens, and still costs.
    if (failure instanceof OpenAiNoAnswer) usage = failure.usage;
    extraUsd = request.extraUsdIfFailed ?? 0;
    throw failure;
  } finally {
    const { error: settleError } = await db.rpc("settle_ai_spend", {
      p_user_id: userId,
      p_usage_id: usageId,
      p_cost: costOf(request.model, usage) + extraUsd,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
    });
    // If this fails the row stays "reserved" and keeps counting at the most it
    // could have cost — too strict, never too loose. Worth saying, not crashing.
    if (settleError) console.error(supabaseError(settleError, "Couldn't record AI spending").message);
  }
}

/**
 * This month's spend on summaries, drafts and promise scans, as their cap
 * counts it — for showing on the page.
 *
 * Since migration 0025 the Assistant has its own budget line and the database
 * counts the two apart. This counts them apart too: showing "$1.40 of $2" on
 * a contact page when $1.20 of it was the Assistant's would be a number the
 * cap does not agree with.
 */
export async function spentThisMonth(db: SupabaseClient, userId: string, now = new Date()): Promise<number> {
  return spentOnLine(db, userId, now, false);
}

/** The same for the Assistant's own line. */
export async function assistantSpentThisMonth(
  db: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<number> {
  return spentOnLine(db, userId, now, true);
}

async function spentOnLine(db: SupabaseClient, userId: string, now: Date, assistant: boolean): Promise<number> {
  let query = db
    .from("ai_usage")
    .select("status, reserved_usd, cost_usd")
    .eq("user_id", userId)
    .gte("created_at", startOfMonthInStockholm(now).toISOString());
  query = assistant ? query.eq("purpose", "assistant") : query.neq("purpose", "assistant");

  const { data, error } = await query;
  if (error) throw supabaseError(error, "Couldn't load AI spending");

  return data.reduce(
    (sum, row) => sum + Number(row.status === "settled" ? row.cost_usd : row.reserved_usd),
    0,
  );
}

/** Midnight on the 1st of this month in Swedish time, as the database's cap uses. */
export function startOfMonthInStockholm(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);

  // Stockholm is UTC+1 or UTC+2; try both and keep the one that is midnight there.
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(Date.UTC(year, month - 1, 1, -offsetHours));
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(candidate);
    if (hour === "00") return candidate;
  }
  return new Date(Date.UTC(year, month - 1, 1));
}
