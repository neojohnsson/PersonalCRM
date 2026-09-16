import type { Touch } from "@/lib/relationship/touches";
import { wholeDaysBetween } from "@/lib/relationship/whose-turn";

/**
 * Warmth, 0–100 (plan.md §3.5; docs/slice-3-plan.md, Part 2 and decision B).
 *
 * Four signals, each counted from message headers, and the score is nothing but
 * their points added up:
 *
 *   Last contact   35 × (1 − days ÷ 90), never below 0
 *   Reply rate     30 × answered ÷ sent, over your last 10 messages
 *   Reply speed    20 within a day · 12 within 3 days · 6 within a week · 0
 *   Exchanges      15 × changes of direction ÷ 10, at most 15
 *
 * The signals are returned with the score, and the screens always show them
 * next to it: "a score with its inputs shown is a summary; a score with no
 * explanation is an opinion" (plan.md §3.5). No mail at all → no score.
 *
 * What it can't know: that someone is on parental leave, in a hiring freeze, or
 * just busy. That's why a human reads the signals, not only the number.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const WEIGHTS = {
  lastContact: 35,
  replyRate: 30,
  replySpeed: 20,
  exchanges: 15,
} as const;

/** Last contact is worth nothing after this many days. */
export const RECENCY_DAYS = 90;

/** Reply rate looks at this many of your most recent messages. */
export const REPLY_RATE_WINDOW = 10;

/** Exchanges stop adding points after this many. */
export const EXCHANGES_FOR_FULL_POINTS = 10;

/** Reply speed: points for a median reply within each limit, fastest first. */
export const REPLY_SPEED_STEPS = [
  { within: 1 * DAY, points: 20 },
  { within: 3 * DAY, points: 12 },
  { within: 7 * DAY, points: 6 },
] as const;

export const BANDS = { warm: 60, cooling: 35 } as const;

export type Band = "warm" | "cooling" | "cold";

export type WarmthSignals = {
  /** Of your last (up to) REPLY_RATE_WINDOW messages, how many they answered. */
  replyRate: { answered: number; sent: number };
  /** Median time from your message to their reply; null if they never replied. */
  replySpeed: { medianMs: number | null; replies: number };
  lastContact: { days: number; from: "you" | "them"; at: Date };
  /** Times a thread changed direction, and the date of the first touch. */
  exchanges: { count: number; since: Date };
};

export type Warmth = {
  score: number;
  band: Band;
  signals: WarmthSignals;
  /** Each signal's points, so the score can always be explained. */
  points: Record<keyof typeof WEIGHTS, number>;
};

/** `touches` in any order. Null when there are none. */
export function warmth(touches: Touch[], now: Date = new Date()): Warmth | null {
  if (touches.length === 0) return null;

  const ordered = [...touches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const signals = countSignals(ordered, now);

  const points = {
    lastContact:
      WEIGHTS.lastContact * Math.max(0, 1 - signals.lastContact.days / RECENCY_DAYS),
    replyRate:
      signals.replyRate.sent === 0
        ? 0
        : WEIGHTS.replyRate * (signals.replyRate.answered / signals.replyRate.sent),
    replySpeed: replySpeedPoints(signals.replySpeed.medianMs),
    exchanges:
      WEIGHTS.exchanges * Math.min(1, signals.exchanges.count / EXCHANGES_FOR_FULL_POINTS),
  };

  const score = Math.round(
    points.lastContact + points.replyRate + points.replySpeed + points.exchanges,
  );

  return { score, band: bandOf(score), signals, points };
}

export function bandOf(score: number): Band {
  if (score >= BANDS.warm) return "warm";
  if (score >= BANDS.cooling) return "cooling";
  return "cold";
}

function replySpeedPoints(medianMs: number | null): number {
  if (medianMs === null) return 0;
  return REPLY_SPEED_STEPS.find((step) => medianMs <= step.within)?.points ?? 0;
}

function countSignals(ordered: Touch[], now: Date): WarmthSignals {
  const last = ordered[ordered.length - 1];

  // Group by thread, keeping time order inside each.
  const threads = new Map<string, Touch[]>();
  for (const touch of ordered) {
    const thread = threads.get(touch.threadId) ?? [];
    thread.push(touch);
    threads.set(touch.threadId, thread);
  }

  // Exchanges: every time a thread goes you → them or them → you.
  let exchanges = 0;
  // Reply speed: from the last of your messages to their next message.
  const replyDelays: number[] = [];

  for (const thread of threads.values()) {
    for (let i = 1; i < thread.length; i++) {
      if (thread[i].direction !== thread[i - 1].direction) {
        exchanges++;
        if (thread[i - 1].direction === "outbound") {
          replyDelays.push(thread[i].at.getTime() - thread[i - 1].at.getTime());
        }
      }
    }
  }

  // Reply rate: your last few messages, each answered if they wrote later in
  // the same thread.
  const yours = ordered.filter((touch) => touch.direction === "outbound").slice(-REPLY_RATE_WINDOW);
  const answered = yours.filter((sent) =>
    threads
      .get(sent.threadId)!
      .some((touch) => touch.direction === "inbound" && touch.at > sent.at),
  ).length;

  return {
    replyRate: { answered, sent: yours.length },
    replySpeed: { medianMs: median(replyDelays), replies: replyDelays.length },
    lastContact: {
      days: wholeDaysBetween(last.at, now),
      from: last.direction === "outbound" ? "you" : "them",
      at: last.at,
    },
    exchanges: { count: exchanges, since: ordered[0].at },
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
