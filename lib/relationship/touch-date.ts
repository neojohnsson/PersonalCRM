import { addDays, isIsoDate, laterDate } from "@/lib/relationship/dates";
import { MAX_DAYS_AHEAD } from "@/lib/relationship/next-touch";

/**
 * From a kind of timing to a next-touch date (docs/next-touch-dates-plan.md).
 *
 * The AI only names the kind — "a referral", "waiting on them" — and these
 * rules pick the day. Same kind, same situation, same date: the date can be
 * explained, tested and changed here, not argued with a model.
 *
 *   stated_date         the date the email gave
 *   reply_owed          next working day
 *   referral            3 working days from today
 *   waiting_on_them     7 days after your last email, or next working day if past
 *   they_will_get_back  14 days after their last email, or next working day if past
 *   later_event         first working day of the month named; else 1 month, rough
 *   nothing_open        no date, and no next touch
 *
 * Every date moves off a weekend to Monday, is never before today, and never
 * more than five years ahead. All dates are YYYY-MM-DD calendar days.
 */

export const TIMINGS = [
  "stated_date",
  "reply_owed",
  "referral",
  "waiting_on_them",
  "they_will_get_back",
  "later_event",
  "nothing_open",
] as const;
export type Timing = (typeof TIMINGS)[number];

export const REFERRAL_WORKING_DAYS = 3;
export const WAITING_ON_THEM_DAYS = 7;
export const THEY_WILL_GET_BACK_DAYS = 14;
export const ROUGH_GUESS_MONTHS = 1;

export type TimingInput = {
  timing: string;
  /** YYYY-MM-DD, for stated_date. */
  date: string | null;
  /** YYYY-MM, for later_event. */
  month: string | null;
};

export type TimingContext = {
  today: string;
  /** The day of your last email with the contact, YYYY-MM-DD; null if you never wrote. */
  lastFromYou: string | null;
  /** The day of their last email, YYYY-MM-DD; null if they never wrote. */
  lastFromThem: string | null;
  /**
   * The next meeting with this contact, YYYY-MM-DD, if the calendar is
   * connected and one is booked (slice 8a). A suggestion that falls on or
   * before it is dropped: you are seeing them, and the meeting is the
   * follow-up.
   */
  meetingWith?: string | null;
};

/** A suggested date, or null when there's no touch to suggest or no honest date for one. */
export type TouchDate = { dueOn: string; rough: boolean };

export function isTiming(value: string): value is Timing {
  return (TIMINGS as readonly string[]).includes(value);
}

export function touchDate(input: TimingInput, context: TimingContext): TouchDate | null {
  const { today } = context;
  if (!isTiming(input.timing)) return null;

  let dueOn: string | null = null;
  let rough = false;

  switch (input.timing) {
    case "nothing_open":
      return null;

    case "stated_date":
      dueOn = input.date && isIsoDate(input.date) && input.date >= today ? input.date : null;
      break;

    case "reply_owed":
      dueOn = nextWorkingDay(today);
      break;

    case "referral":
      dueOn = addWorkingDays(today, REFERRAL_WORKING_DAYS);
      break;

    case "waiting_on_them":
      dueOn = afterOrNextWorkingDay(context.lastFromYou, WAITING_ON_THEM_DAYS, today);
      break;

    case "they_will_get_back":
      dueOn = afterOrNextWorkingDay(context.lastFromThem, THEY_WILL_GET_BACK_DAYS, today);
      break;

    case "later_event": {
      const named = firstWorkingDayOfMonth(input.month);
      if (named && named >= today) {
        dueOn = named;
      } else {
        dueOn = addMonths(today, ROUGH_GUESS_MONTHS);
        rough = true;
      }
      break;
    }
  }

  if (dueOn === null) return null;
  dueOn = laterDate(onWorkingDay(dueOn), today);
  if (dueOn > addDays(today, MAX_DAYS_AHEAD)) return null;

  // You are seeing them before the day this would suggest, so there is nothing
  // to plan: the meeting is the follow-up. Telling somebody to "get back to
  // Karin on Tuesday" when they are seeing her on Monday is the kind of wrong
  // that makes a person stop trusting the whole feature (slice 8a).
  const meeting = context.meetingWith;
  if (meeting && meeting >= today && meeting <= dueOn) return null;

  return { dueOn, rough };
}

// ── Calendar arithmetic ─────────────────────────────────────────────────────

/** 0 = Sunday … 6 = Saturday. */
function weekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** The same day if it's a weekday; Monday if it falls on a weekend. */
export function onWorkingDay(isoDate: string): string {
  const day = weekday(isoDate);
  if (day === 6) return addDays(isoDate, 2);
  if (day === 0) return addDays(isoDate, 1);
  return isoDate;
}

/** The first weekday after `isoDate`. */
export function nextWorkingDay(isoDate: string): string {
  return onWorkingDay(addDays(isoDate, 1));
}

/** `count` weekdays after `isoDate`, not counting `isoDate` itself. */
export function addWorkingDays(isoDate: string, count: number): string {
  let date = isoDate;
  for (let i = 0; i < count; i++) date = nextWorkingDay(date);
  return date;
}

/** `days` after `from`; the next working day after today if that's already past or unknown. */
function afterOrNextWorkingDay(from: string | null, days: number, today: string): string {
  const due = from ? addDays(from, days) : null;
  return due && due > today ? due : nextWorkingDay(today);
}

/** "2027-02" → the first weekday of February 2027; null if it isn't a real month. */
export function firstWorkingDayOfMonth(month: string | null): string | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return onWorkingDay(`${month}-01`);
}

/** The same day `months` later, pulled back to the month's last day if needed (31 Jan → 28 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
