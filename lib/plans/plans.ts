/**
 * What each plan includes (docs/slice-13-plan.md §2).
 *
 * The database says WHICH plan you are on (`entitlements.plan`, migration
 * 0027); this file says what that plan means, for everyone at once. It is
 * the one place to read or change it, and a change here is a reviewed commit,
 * never a row somebody edited.
 *
 * Budgets and the free allowance join this in slice 13, commit 3.
 */

export const PLAN_NAMES = ["free", "pro", "premium"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export type Plan = {
  name: PlanName;
  label: string;
  assistant: boolean;
  research: boolean;
};

export const PLANS: Record<PlanName, Plan> = {
  free: { name: "free", label: "Free", assistant: false, research: false },
  pro: { name: "pro", label: "Pro", assistant: true, research: false },
  premium: { name: "premium", label: "Premium", assistant: true, research: true },
};

/**
 * A plan name from the database. Anything unknown is Free: never more than was
 * paid for. `includes`, not `name in PLANS`: every object inherits names like
 * "constructor", and `in` would say yes to them.
 */
export function planNamed(name: unknown): Plan {
  return (PLAN_NAMES as readonly unknown[]).includes(name) ? PLANS[name as PlanName] : PLANS.free;
}
