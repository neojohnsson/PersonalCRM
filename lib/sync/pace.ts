/**
 * Keeping the sync inside Gmail's per-user quota.
 *
 * From Google's Gmail API quota reference, checked 2026-09-15:
 *   - 6,000 quota units per minute, per user
 *   - messages.list 5 · messages.get 20 · history.list 2 · getProfile 1
 *
 * Reading headers is the expensive part: 20 units a message. The first
 * version ran steps back to back at 100 messages (~2,000 units) each, and
 * Gmail refused the third one inside a minute.
 */

export const GMAIL_UNITS_PER_MINUTE = 6_000;

/** Aim for 80% of the budget, leaving room for retries and clock drift. */
export const BUDGET_SHARE = 0.8;

export const GMAIL_UNITS = {
  getProfile: 1,
  historyList: 2,
  messagesList: 5,
  messagesGet: 20,
} as const;

/** How long to back off after Gmail says "too many requests". */
export const RATE_LIMIT_WAIT_MS = 60_000;

/**
 * How long to wait after a step that spent `units`, so that steps repeated
 * at this pace stay within BUDGET_SHARE of the per-minute budget.
 */
export function waitAfter(units: number): number {
  if (units <= 0) return 0;
  return Math.ceil((units * 60_000) / (GMAIL_UNITS_PER_MINUTE * BUDGET_SHARE));
}
