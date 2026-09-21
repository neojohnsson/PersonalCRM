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
 * Since slice 8a a meeting counts too, and the four weights are untouched
 * (plan.md §6.4: "the strongest warmth signal that exists — far stronger than
 * email"). A meeting is a *touch*: it sets last contact like a message would,
 * and counts as two exchanges, because a meeting is both people turning up.
 * That puts the whole "stronger than email" claim in one number to argue about
 * rather than a fifth weight, which would have forced all four to move and
 * changed every score in the app.
 *
 * Reply rate and reply speed ignore meetings: they are about mail, and a
 * meeting has no reply time.
 *
 * A meeting still to come counts for nothing. It has not happened, and a score
 * that rose because of a booking would fall again the moment it was cancelled.
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

/**
 * What one meeting is worth in exchanges (slice 8a, decided 2026-09-20).
 * Two: a meeting is both people turning up, and an email is one person typing.
 */
export const EXCHANGES_PER_MEETING = 2;

/** Reply speed: points for a median reply within each limit, fastest first. */
export const REPLY_SPEED_STEPS = [
  { within: 1 * DAY, points: 20 },
  { within: 3 * DAY, points: 12 },
  { within: 7 * DAY, points: 6 },
] as const;

export const BANDS = { warm: 60, cooling: 35 } as const;

export type Band = "warm" | "cooling" | "cold";

/** A meeting with this contact. The date is all warmth needs to know. */
export type WarmthMeeting = { startedAt: Date };

export type WarmthSignals = {
  /** Of your last (up to) REPLY_RATE_WINDOW messages, how many they answered. */
  replyRate: { answered: number; sent: number };
  /** Median time from your message to their reply; null if they never replied. */
  replySpeed: { medianMs: number | null; replies: number };
  /** "meeting" when the most recent contact was one — neither of you wrote it. */
  lastContact: { days: number; from: "you" | "them" | "meeting"; at: Date };
  /** Times a thread changed direction, plus two per meeting, and since when. */
  exchanges: { count: number; since: Date };
  /** Meetings that have happened, and the most recent one. */
  meetings: { count: number; lastAt: Date | null };
};

export type Warmth = {
  score: number;
  band: Band;
  signals: WarmthSignals;
  /** Each signal's points, so the score can always be explained. */
  points: Record<keyof typeof WEIGHTS, number>;
};

/**
 * `touches` and `meetings` in any order. Null when there is no mail.
 *
 * A contact with meetings but no mail still gets no score. Three of the four
 * signals are about mail, so a number built from one meeting and nothing else
 * would be a score with almost no inputs — and "a score with no explanation is
 * an opinion" (plan.md §3.5). Worth revisiting the day this app has a reason to
 * rank people it has only ever met.
 */
export function warmth(
  touches: Touch[],
  now: Date = new Date(),
  meetings: WarmthMeeting[] = [],
): Warmth | null {
  if (touches.length === 0) return null;

  const ordered = [...touches].sort((a, b) => a.at.getTime() - b.at.getTime());
  // Only meetings that have happened. One next week is a booking, not contact.
  const past = meetings
    .filter((meeting) => meeting.startedAt.getTime() <= now.getTime())
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const signals = countSignals(ordered, now, past);

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

function countSignals(ordered: Touch[], now: Date, meetings: WarmthMeeting[]): WarmthSignals {
  const last = ordered[ordered.length - 1];
  const lastMeeting = meetings[meetings.length - 1] ?? null;

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

  // The most recent contact of any kind: a meeting counts like a message.
  const metLast = lastMeeting !== null && lastMeeting.startedAt.getTime() > last.at.getTime();
  const lastContactAt = metLast ? lastMeeting!.startedAt : last.at;

  return {
    replyRate: { answered, sent: yours.length },
    replySpeed: { medianMs: median(replyDelays), replies: replyDelays.length },
    lastContact: {
      days: wholeDaysBetween(lastContactAt, now),
      from: metLast ? "meeting" : last.direction === "outbound" ? "you" : "them",
      at: lastContactAt,
    },
    exchanges: {
      count: exchanges + meetings.length * EXCHANGES_PER_MEETING,
      // The first contact of any kind, which a meeting can predate the mail by.
      since:
        meetings.length > 0 && meetings[0].startedAt < ordered[0].at
          ? meetings[0].startedAt
          : ordered[0].at,
    },
    meetings: { count: meetings.length, lastAt: lastMeeting?.startedAt ?? null },
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
