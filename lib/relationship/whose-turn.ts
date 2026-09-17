import type { Touch } from "@/lib/relationship/touches";

/**
 * Whose turn it is with a contact (plan.md §3.3; docs/slice-3-plan.md, Part 1).
 *
 * Look at the most recent touch:
 *
 *   they sent it                  → your turn
 *   you sent it                   → their turn  ("going quiet" after 14 days)
 *   more than 30 whole days old   → no open thread  (decision A)
 *   no touches at all             → no mail yet
 *
 * Plain computation over stored message headers — no AI, no reading of what
 * anyone wrote. That's why it can't be wrong about who wrote last.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Decision A: a latest message older than this many whole days closes the thread. */
export const OPEN_THREAD_DAYS = 30;

/** Their turn for longer than this many whole days is "going quiet". */
export const GOING_QUIET_DAYS = 14;

type Latest = {
  /** Whole days since the latest touch. */
  days: number;
  at: Date;
  threadId: string;
  subject: string | null;
};

export type Turn =
  | { kind: "none" }
  | ({ kind: "closed" } & Latest)
  | ({ kind: "yours" } & Latest)
  | ({ kind: "theirs"; goingQuiet: boolean } & Latest);

export function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY));
}

/** `touches` in any order; the latest one decides. */
export function whoseTurn(touches: Touch[], now: Date = new Date()): Turn {
  if (touches.length === 0) return { kind: "none" };

  const last = touches.reduce((latest, touch) => (touch.at > latest.at ? touch : latest));
  const latest: Latest = {
    days: wholeDaysBetween(last.at, now),
    at: last.at,
    threadId: last.threadId,
    subject: last.subject,
  };

  if (latest.days > OPEN_THREAD_DAYS) return { kind: "closed", ...latest };
  if (last.direction === "inbound") return { kind: "yours", ...latest };
  return { kind: "theirs", goingQuiet: latest.days > GOING_QUIET_DAYS, ...latest };
}

/**
 * The contact list's default order — "that default is the product"
 * (design/canvas.json): your turn first, longest wait first; then their turn,
 * longest silence first; then no open thread, most recent first; then contacts
 * with no mail.
 */
export function compareTurns(a: Turn, b: Turn): number {
  const rank = { yours: 0, theirs: 1, closed: 2, none: 3 } as const;
  if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
  if (a.kind === "none" || b.kind === "none") return 0;
  if (a.kind === "closed" && b.kind === "closed") return a.days - b.days;
  return b.days - a.days;
}
