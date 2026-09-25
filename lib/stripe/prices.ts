import type { PlanName } from "@/lib/plans/plans";

/**
 * Which Stripe price is which plan (slice 13, commit 5).
 *
 * Prices are found by their lookup key, a name we give them in Stripe, not by
 * their id. Test mode and live mode have different ids for the "same" price;
 * with names, going live is creating the same two prices there, and nothing
 * to copy into the app. scripts/stripe-prices.mjs creates them.
 *
 * The webhook reads the plan from THIS table and nothing else: a price that
 * is not in it is refused, never guessed at.
 */

export const LOOKUP_KEYS = { pro: "pro_monthly", premium: "premium_monthly" } as const satisfies Partial<
  Record<PlanName, string>
>;

export type PaidPlan = keyof typeof LOOKUP_KEYS;

export function isPaidPlan(name: unknown): name is PaidPlan {
  return name === "pro" || name === "premium";
}

export function planForLookupKey(key: string | null | undefined): PaidPlan | null {
  for (const [plan, lookup] of Object.entries(LOOKUP_KEYS) as [PaidPlan, string][]) {
    if (key === lookup) return plan;
  }
  return null;
}
