/**
 * What each plan includes (docs/slice-13-plan.md §2).
 *
 * The database says WHICH plan you are on (`entitlements.plan`, migration
 * 0027); this file says what that plan means, for everyone at once. It is
 * the one place to read or change it, and a change here is a reviewed commit,
 * never a row somebody edited.
 *
 *   assistant / research   what the plan switches on
 *   aiUsd / assistantUsd   the monthly dollar limit on each budget line: a
 *                          safety limit, never shown. What the AI really costs
 *                          is far below it (docs/slice-13-plan.md §1)
 *   allowance              Free only: how many of each a month, the limit a
 *                          person sees ("3 of 5 summaries left"). null: none
 *
 * The environment's LLM_MONTHLY_CAP_USD and ASSISTANT_MONTHLY_CAP_USD sit above
 * all of this as an emergency brake (lib/ai/config.ts): no plan gets more.
 */

export const PLAN_NAMES = ["free", "pro", "premium"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

/** The five things the AI does, as ai_usage records them. */
export type AiPurpose = "summary" | "draft" | "promises" | "assistant" | "research";

export type Plan = {
  name: PlanName;
  label: string;
  assistant: boolean;
  research: boolean;
  aiUsd: number;
  assistantUsd: number;
  allowance: Record<AiPurpose, number> | null;
};

export const PLANS: Record<PlanName, Plan> = {
  // The Assistant is on for Free, held to 20 questions a month. Web research
  // is not: it costs the most per press and needs the most care.
  free: {
    name: "free",
    label: "Free",
    assistant: true,
    research: false,
    aiUsd: 0.25,
    assistantUsd: 0.25,
    allowance: { summary: 5, draft: 5, promises: 2, assistant: 20, research: 0 },
  },
  pro: { name: "pro", label: "Pro", assistant: true, research: false, aiUsd: 2, assistantUsd: 3, allowance: null },
  premium: { name: "premium", label: "Premium", assistant: true, research: true, aiUsd: 5, assistantUsd: 10, allowance: null },
};

/** The price a month in kronor, VAT included (docs/slice-13-plan.md §2). */
export const PRICE_SEK: Record<PlanName, number> = { free: 0, pro: 49, premium: 99 };

/**
 * What each plan includes, in the words the pricing page uses. Built from
 * PLANS, so the page cannot promise what the limits above do not give.
 */
export function includes(plan: Plan): { text: string; yes: boolean }[] {
  const a = plan.allowance;
  return [
    { text: "Sync, whose turn, warmth, next touch and the calendar", yes: true },
    { text: a ? `${a.summary} summaries and ${a.draft} drafts a month` : "Summaries and drafts, no monthly count", yes: true },
    { text: a ? `${a.promises} promise scans a month` : "Promise scans, no monthly count", yes: true },
    { text: a ? `The Assistant, ${a.assistant} questions a month` : "The Assistant, no monthly count", yes: plan.assistant },
    { text: "Research a contact on the public web", yes: plan.research },
  ];
}

/** The two limits one AI request is held to. */
export type SpendLimits = { capUsd: number; maxUses: number | null };

/**
 * A plan's limits for one purpose, under the environment's ceiling. The
 * Assistant has its own budget line (migration 0025); the other four share one.
 */
export function limitsOf(plan: Plan, purpose: AiPurpose, ceilingUsd: number): SpendLimits {
  const line = purpose === "assistant" ? plan.assistantUsd : plan.aiUsd;
  return { capUsd: Math.min(line, ceilingUsd), maxUses: plan.allowance?.[purpose] ?? null };
}

/**
 * A plan name from the database. Anything unknown is Free: never more than was
 * paid for. `includes`, not `name in PLANS`: every object inherits names like
 * "constructor", and `in` would say yes to them.
 */
export function planNamed(name: unknown): Plan {
  return (PLAN_NAMES as readonly unknown[]).includes(name) ? PLANS[name as PlanName] : PLANS.free;
}
