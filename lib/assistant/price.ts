import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * What a "Needs you" card costs, shown on the card before you press it
 * (docs/slice-11-plan.md §4).
 *
 * Not a guess from a price list: the average of what the same kind of thing
 * has really cost you, from your own settled ai_usage rows. A draft's price
 * depends on how long the thread is, and your threads are the ones that
 * count. With no history yet there is no honest number, so it is null and the
 * card says "a little" instead.
 *
 * These presses are paid from the ordinary AI budget, not the Assistant's:
 * they are the same draft, summary and scan as on the contact and Promises
 * pages, through the same code.
 */

export type PricedPurpose = "draft" | "summary" | "promises" | "research";

/** How many recent requests the average is taken over. */
export const PRICE_SAMPLE = 10;

export async function typicalCostUsd(
  db: SupabaseClient,
  userId: string,
  purpose: PricedPurpose,
): Promise<number | null> {
  const { data, error } = await db
    .from("ai_usage")
    .select("cost_usd")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .eq("status", "settled")
    // A request that failed settles at nothing; it says nothing about price.
    .gt("cost_usd", 0)
    .order("created_at", { ascending: false })
    .limit(PRICE_SAMPLE);
  if (error) throw supabaseError(error, "Couldn't load what this has cost before");
  if (data.length === 0) return null;

  return data.reduce((sum, row) => sum + Number(row.cost_usd), 0) / data.length;
}

/**
 * What a press really cost, once it is over: every settled row of that kind
 * since it started. A promise scan is one request per contact, so it is a sum.
 */
export async function costSinceUsd(
  db: SupabaseClient,
  userId: string,
  purpose: PricedPurpose,
  since: Date,
): Promise<number | null> {
  const { data, error } = await db
    .from("ai_usage")
    .select("cost_usd")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .eq("status", "settled")
    .gte("created_at", since.toISOString());
  if (error) throw supabaseError(error, "Couldn't load what that cost");
  if (data.length === 0) return null;

  return data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
}

/** "$0.004", "under a cent", or "a little" when there is nothing to go on. */
export function priceInWords(usd: number | null): string {
  if (usd === null) return "a little";
  if (usd < 0.001) return "under a tenth of a cent";
  if (usd < 0.01) return `about $${usd.toFixed(3)}`;
  return `about $${usd.toFixed(2)}`;
}
