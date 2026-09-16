/**
 * Calendar dates as "YYYY-MM-DD" strings — the shape Postgres `date` columns
 * take and give back.
 *
 * A next touch is a day in the user's calendar, not a moment in time, so these
 * never go through local time: "today" is asked of a named time zone, and
 * adding days is done in UTC where every day has 24 hours.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in `timeZone` — Swedish time by default, like lib/format.ts's dayMonth. */
export function todayIn(timeZone = "Europe/Stockholm", now: Date = new Date()): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A real calendar date in YYYY-MM-DD form — not "2026-02-30". */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The later of two dates. YYYY-MM-DD strings sort the same way the dates do. */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Whole days from `from` to `to`: negative when `to` is earlier. */
export function daysBetweenDates(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
