import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import { planNamed, type Plan } from "./plans";

/**
 * The plan this user is on (migration 0027).
 *
 * Read from `entitlements`, which the user can read and nobody can write
 * through the API, so what comes back was set by the Stripe webhook or the
 * database owner, never by the user. No row means Free.
 *
 * Cached for one request: the shell, the page and its actions all ask.
 */
export type Entitlement = {
  plan: Plan;
  /** When the paid month runs out; null on Free or a plan set by hand. */
  currentPeriodEnd: string | null;
  /** Whether Stripe knows this person, so the customer portal can open. */
  hasStripeCustomer: boolean;
};

export const loadEntitlement = cache(async (db: SupabaseClient, userId: string): Promise<Entitlement> => {
  const { data, error } = await db
    .from("entitlements")
    .select("plan, current_period_end, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle<{ plan: string; current_period_end: string | null; stripe_customer_id: string | null }>();
  if (error) throw supabaseError(error, "Couldn't check what this account includes");
  return {
    plan: planNamed(data?.plan),
    currentPeriodEnd: data?.current_period_end ?? null,
    hasStripeCustomer: Boolean(data?.stripe_customer_id),
  };
});

export const currentPlan = cache(
  async (db: SupabaseClient, userId: string): Promise<Plan> => (await loadEntitlement(db, userId)).plan,
);
