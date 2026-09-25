import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfMonthInStockholm } from "@/lib/ai/spend";
import { supabaseError } from "@/lib/supabase/errors";
import type { Uses } from "./allowance";
import type { AiPurpose } from "./plans";

/**
 * How much of Free's allowance is used this month, for the page to show
 * (slice 13, commit 4).
 *
 * The same rule as the database's own count (private.ai_uses_this_month,
 * migration 0028), so the number on the screen and the refusal agree: a row
 * is a use when it counts as one and either is still under way or cost
 * something. A request that failed for free is not a use.
 *
 * Read as the user, so RLS decides whose rows these are.
 */

export type { Uses } from "./allowance";


export async function usesThisMonth(db: SupabaseClient, userId: string, now = new Date()): Promise<Uses> {
  const { data, error } = await db
    .from("ai_usage")
    .select("purpose, status, cost_usd")
    .eq("user_id", userId)
    .eq("counts_as_use", true)
    .gte("created_at", startOfMonthInStockholm(now).toISOString());
  if (error) throw supabaseError(error, "Couldn't count this month's AI use");

  const uses: Uses = { summary: 0, draft: 0, promises: 0, assistant: 0, research: 0 };
  for (const row of data as { purpose: AiPurpose; status: string; cost_usd: number | string | null }[]) {
    if (row.status === "reserved" || Number(row.cost_usd ?? 0) > 0) uses[row.purpose] += 1;
  }
  return uses;
}

export { allowanceLine, allowanceOf, type Allowance } from "./allowance";
