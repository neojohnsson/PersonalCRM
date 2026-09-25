import type { AiPurpose, Plan } from "./plans";

/**
 * What is left of Free's allowance, as words and numbers (slice 13, commit 4).
 * Pure, with no database, so a client component can import it; the count
 * itself is read on the server by ./usage.ts.
 */

export type Uses = Record<AiPurpose, number>;

export type Allowance = { used: number; allowed: number; left: number };

/** What is left of one allowance, or null when the plan has none (a paid plan). */
export function allowanceOf(plan: Plan, uses: Uses, purpose: AiPurpose): Allowance | null {
  const allowed = plan.allowance?.[purpose];
  if (allowed === undefined) return null;
  const used = uses[purpose];
  return { used, allowed, left: Math.max(0, allowed - used) };
}

const WORDS: Record<AiPurpose, [one: string, many: string]> = {
  summary: ["free summary", "free summaries"],
  draft: ["free draft", "free drafts"],
  promises: ["free promise scan", "free promise scans"],
  assistant: ["free question", "free questions"],
  research: ["web search", "web searches"],
};

/**
 * Whether one more summary or draft can be asked for: dollars left on the
 * line, and on Free a use left. A cent is more than any one of them costs
 * (lib/ai/models.ts); below that, the database would refuse it anyway.
 */
export function roomFor(budget: { spentUsd: number; capUsd: number }, allowance: Allowance | null): boolean {
  return budget.capUsd - budget.spentUsd >= 0.01 && (allowance === null || allowance.left > 0);
}

/** "3 of 5 free summaries left this month". */
export function allowanceLine(allowance: Allowance, purpose: AiPurpose): string {
  const [one, many] = WORDS[purpose];
  return `${allowance.left} of ${allowance.allowed} ${allowance.allowed === 1 ? one : many} left this month`;
}
