import { addDays, daysBetweenDates, todayIn } from "@/lib/relationship/dates";
import type { Relationship } from "@/lib/relationship/load";
import { prompts, standingOf } from "@/lib/relationship/standing";
import type { OpenTouch, Person } from "@/lib/relationship/today";

/**
 * The weekly brief (plan.md §3.9): "5–8 people worth reconnecting with, each
 * with one line of why, and a one-click 'draft something'."
 *
 * Everything here is computed from what's already stored — no AI, no cost, and
 * no line that could misquote anyone. Each person appears once, under their
 * strongest reason, and the list is measured from Monday so it doesn't shuffle
 * as the week goes on (docs/slice-6b-plan.md).
 */

export const BRIEF_SIZE = 8;
export const YOUR_TURN_MAX = 3;
export const GOING_QUIET_MAX = 2;

/** Their turn for this long counts as going quiet (as on the home page). */
export const GOING_QUIET_DAYS = 14;

/** Warm but untouched this long is about to go cold (plan.md §6.11). */
export const COOLING_FROM_DAYS = 60;
export const COOLING_TO_DAYS = 80;

/** Someone you wrote to this recently doesn't need a nudge. */
export const JUST_WROTE_DAYS = 3;

export const BRIEF_REASONS = ["waiting", "overdue", "due_this_week", "going_quiet", "about_to_cool"] as const;
export type BriefReason = (typeof BRIEF_REASONS)[number];

export type BriefEntry<T> = {
  contact: T & { id: string };
  reason: BriefReason;
  /** The one line the brief shows, in plain words. */
  because: string;
  /** For sorting inside a reason: the bigger, the more it needs you. */
  weight: number;
  /** The conversation the row is about, so it can be settled from there. */
  threadId: string | null;
};

/** Monday of the week `date` falls in, in Swedish time. YYYY-MM-DD. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/** Sunday of that week. */
export function weekEnd(date: string): string {
  return addDays(weekStart(date), 6);
}

export function thisWeek(now: Date = new Date()): { start: string; end: string; today: string } {
  const today = todayIn("Europe/Stockholm", now);
  return { start: weekStart(today), end: weekEnd(today), today };
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The brief: at most BRIEF_SIZE people, in the order of BRIEF_REASONS, each
 * under one reason only.
 *
 * Left out of the reasons the app works out for itself: contacts with no mail,
 * anyone you wrote to in the last few days, and anyone whose standing says not
 * to ask — a finished conversation, a day you already chose, a person you never
 * chase (lib/relationship/standing.ts).
 *
 * A next touch is different. It is a date *you* set, so it is listed whatever
 * the standing says — silencing a plan you made yourself would only hide it.
 */
export function pickBrief<T>(
  people: Person<T>[],
  touches: OpenTouch[],
  week: { start: string; end: string; today: string },
): BriefEntry<T>[] {
  const touchByContact = new Map(touches.map((touch) => [touch.contact_id, touch]));
  const chosen = new Map<string, BriefEntry<T>>();

  const take = (person: Person<T>, reason: BriefReason, because: string, weight: number) => {
    if (chosen.has(person.contact.id)) return;
    const { turn } = person.relationship;
    chosen.set(person.contact.id, {
      contact: person.contact,
      reason,
      because,
      weight,
      threadId: turn.kind === "none" ? null : turn.threadId,
    });
  };

  const eligible = people.filter((person) => {
    const { turn, settledAt, neverChase } = person.relationship;
    if (turn.kind === "none") return false;
    // You wrote to them just now: leave it be.
    if (turn.kind === "theirs" && turn.days <= JUST_WROTE_DAYS) return false;
    // A finished conversation, a day already chosen, a person never chased:
    // lib/relationship/standing.ts holds all three (slice 6c). This covers the
    // old rule about a next touch set for later — that is now "planned".
    const planned = touchByContact.get(person.contact.id);
    return prompts(standingOf({ turn, settledAt, plannedOn: planned?.due_on ?? null, neverChase }, week.today));
  });

  const byWait = (a: Person<T>, b: Person<T>) => daysOf(b.relationship) - daysOf(a.relationship);
  const sorted = [...eligible].sort(byWait);
  // The touch passes read from everyone, not from `eligible`: a date you set is
  // yours, and one due this week is "planned" — which is exactly what keeps it
  // out of the list above.
  const planned = [...people].sort(byWait);

  // 1. Waiting on you longest.
  sorted
    .filter((person) => person.relationship.turn.kind === "yours")
    .slice(0, YOUR_TURN_MAX)
    .forEach((person) => {
      const waited = daysOf(person.relationship);
      take(person, "waiting", `They wrote ${days(waited)} ago and nothing has gone back.`, waited);
    });

  // 2 and 3. Next touches: overdue first, then the rest of this week.
  for (const person of planned) {
    const touch = touchByContact.get(person.contact.id);
    if (!touch) continue;
    const late = daysBetweenDates(touch.due_on, week.today);
    if (touch.due_on < week.today) {
      take(person, "overdue", `You planned this for ${days(late)} ago${reasonTail(touch)}.`, late);
    } else if (touch.due_on <= week.end) {
      // `late` is negative for a day still to come, so the soonest (-1, tomorrow)
      // sorts above the furthest (-3, Sunday).
      take(person, "due_this_week", `You planned to get back to them ${dayWord(touch.due_on)}${reasonTail(touch)}.`, late);
    }
  }

  // 4. Going quiet.
  sorted
    .filter((person) => person.relationship.turn.kind === "theirs" && daysOf(person.relationship) >= GOING_QUIET_DAYS)
    .slice(0, GOING_QUIET_MAX)
    .forEach((person) => {
      const silent = daysOf(person.relationship);
      take(person, "going_quiet", `You wrote ${days(silent)} ago and nothing came back.`, silent);
    });

  // 5. About to go cold: still warm, but the months are adding up.
  sorted
    .filter((person) => {
      const { warmth } = person.relationship;
      const since = daysOf(person.relationship);
      return warmth !== null && warmth.band !== "cold" && since >= COOLING_FROM_DAYS && since <= COOLING_TO_DAYS;
    })
    .forEach((person) => {
      const since = daysOf(person.relationship);
      take(person, "about_to_cool", `You've talked for months, and it's been ${days(since)}.`, since);
    });

  return [...chosen.values()]
    .sort(
      (a, b) =>
        BRIEF_REASONS.indexOf(a.reason) - BRIEF_REASONS.indexOf(b.reason) || b.weight - a.weight,
    )
    .slice(0, BRIEF_SIZE);
}

/** Days since the last message either way; 0 when there is none. */
function daysOf(relationship: Relationship): number {
  return relationship.turn.kind === "none" ? 0 : relationship.turn.days;
}

function reasonTail(touch: OpenTouch): string {
  return touch.reason?.trim() ? `: ${touch.reason.trim()}` : "";
}

/** "on Thursday". Inside one week the weekday is enough to place a day. */
function dayWord(isoDate: string): string {
  return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  )}`;
}
