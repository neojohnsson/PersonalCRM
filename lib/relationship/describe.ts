import { dayMonth } from "@/lib/format";
import { daysBetweenDates } from "@/lib/relationship/dates";
import type { Standing } from "@/lib/relationship/standing";
import type { Turn } from "@/lib/relationship/whose-turn";

/**
 * The words the contact page puts next to whose turn, warmth's signals and a
 * next touch (design/ContactDetail.dc.html). Pure, so they're tested directly
 * (tests/relationship-describe.test.ts).
 */

const DAY = 24 * 60 * 60 * 1000;

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export type TurnPill = { text: string; tone: "yours" | "quiet" | "theirs" | "closed" | "planned" | "said" };

/**
 * The pill beside the name: "They wrote last · 6 days". Nothing for a contact
 * with no mail.
 *
 * The design says "Your turn" and "Their turn". Changed 2026-09-19 at the
 * user's request: whose turn it is was being read as an instruction to write
 * now, and it isn't one — two people can simply both be busy, or the right
 * moment can be months away. The app states what happened and leaves the
 * decision where it belongs. "Going quiet" is untouched: it was always a fact.
 */
export function turnPill(turn: Turn): TurnPill | null {
  switch (turn.kind) {
    case "none":
      return null;
    case "closed":
      return { text: "No open thread", tone: "closed" };
    case "yours":
      return { text: `They wrote last · ${turn.days === 0 ? "today" : days(turn.days)}`, tone: "yours" };
    case "theirs":
      return turn.goingQuiet
        ? { text: `Going quiet · ${days(turn.days)}`, tone: "quiet" }
        : { text: `You wrote last · ${turn.days === 0 ? "today" : days(turn.days)}`, tone: "theirs" };
  }
}

/**
 * The same pill, once what you said is taken into account (slice 6c): a
 * conversation you finished, a day you chose, a person you never chase. Only
 * when you have said nothing does it fall back to the plain fact.
 */
export function standingPill(standing: Standing): TurnPill | null {
  switch (standing.kind) {
    case "never_chase":
      return { text: "Just a contact", tone: "said" };
    case "planned":
      return { text: `Planned for ${dayMonth(standing.dueOn)}`, tone: "planned" };
    case "settled":
      return { text: "Nothing owed", tone: "said" };
    case "open":
      return turnPill(standing.turn);
  }
}

/** "Usually replies": the median reply time, in the steps warmth scores it by. */
export function replySpeedText(medianMs: number): string {
  if (medianMs <= DAY) return "within a day";
  if (medianMs <= 3 * DAY) return "within 3 days";
  if (medianMs <= 7 * DAY) return "within a week";
  return `after ${days(Math.round(medianMs / DAY))}`;
}

/** "Last contact": "today", "yesterday", "6 days ago". */
export function lastContactText(daysAgo: number): string {
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo} days ago`;
}

/** Under "Last contact": who wrote it — and, when it's your turn, that you haven't answered. */
export function lastContactCaption(from: "you" | "them", turn: Turn): string {
  if (turn.kind === "yours") return "they wrote, nothing back yet";
  if (turn.kind === "theirs") return "you wrote, nothing back yet";
  return from === "you" ? "you wrote last" : "they wrote last";
}

/** Under "Reply rate": "they answered 3 of your last 4". */
export function replyRateCaption(answered: number, sent: number): string {
  if (sent === 0) return "you haven't written to them";
  return sent === 1
    ? `they ${answered === 1 ? "answered" : "haven't answered"} your one message`
    : `they answered ${answered} of your last ${sent}`;
}

/**
 * A next touch's date as the design's little calendar badge: "20" over "SEP".
 * Read straight from the YYYY-MM-DD string — it's a calendar day, not a moment.
 */
export function dateBadge(isoDate: string): { day: string; month: string } {
  const [, month, day] = isoDate.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { day: String(day), month: MONTHS[month - 1] };
}

/** How far off a next touch is: "today", "tomorrow", "in 4 days", "2 days overdue". */
export function dueText(dueOn: string, today: string): { text: string; overdue: boolean } {
  const n = daysBetweenDates(today, dueOn);
  if (n === 0) return { text: "today", overdue: false };
  if (n === 1) return { text: "tomorrow", overdue: false };
  if (n > 1) return { text: `in ${n} days`, overdue: false };
  return { text: `${days(-n)} overdue`, overdue: true };
}
