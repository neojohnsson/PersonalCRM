import { addDays, isIsoDate } from "@/lib/relationship/dates";

/**
 * How long "Snooze" snoozes for (docs/slice-9b-plan.md, Part 3).
 *
 * It used to add seven days without asking. That is a fine guess for a touch
 * due tomorrow and meaningless for one you set 133 days out, and the first
 * outside test of the app had no idea what pressing it would do:
 *
 *   "Snooze silently added seven days."
 *
 * So it asks: Tomorrow, Next week, Next month, or pick a date. All three are
 * worked out from today, never from the date the touch has, because a label
 * has to be true — "Tomorrow" on a touch due next Friday cannot mean eight
 * days' time.
 *
 * Which also means a choice can point at a day the touch has already passed.
 * Snoozing is for pushing something later, so a choice that is not after the
 * current date is left out: a touch due next Friday offers Next month and a
 * date of your own, and nothing that would pull it forward.
 *
 *   Tomorrow     the day after today
 *   Next week    the Monday after this one, because the whole app counts
 *                weeks Monday to Sunday (lib/relationship/brief.ts)
 *   Next month   the same day of the next month, clamped to its last day, so
 *                31 January lands on 28 February rather than 3 March
 *
 * Nothing here touches the database. The date this produces goes to
 * moveNextTouch, which is the one place a touch's day changes.
 */

export type SnoozeKey = "tomorrow" | "next_week" | "next_month";

export type SnoozeChoice = {
  key: SnoozeKey;
  /** What the button says. */
  label: string;
  /** YYYY-MM-DD. */
  dueOn: string;
};

const LABELS: Record<SnoozeKey, string> = {
  tomorrow: "Tomorrow",
  next_week: "Next week",
  next_month: "Next month",
};

/**
 * The choices to show, in order. `today` and `dueOn` are YYYY-MM-DD; a choice
 * on or before `dueOn` is left out, so the list can be shorter than three and
 * (for a touch due a long way off) empty — then only "Pick a date" is left.
 */
export function snoozeChoices(today: string, dueOn: string): SnoozeChoice[] {
  const dates: Record<SnoozeKey, string> = {
    tomorrow: addDays(today, 1),
    next_week: nextMonday(today),
    next_month: sameDayNextMonth(today),
  };

  return (Object.keys(dates) as SnoozeKey[])
    .map((key) => ({ key, label: LABELS[key], dueOn: dates[key] }))
    .filter((choice) => choice.dueOn > dueOn);
}

/** The date one of the choices means, or null if it isn't one of them. */
export function snoozeDate(today: string, dueOn: string, key: string): string | null {
  return snoozeChoices(today, dueOn).find((choice) => choice.key === key)?.dueOn ?? null;
}

/** The Monday after the week `isoDate` is in. Monday itself goes a week on. */
export function nextMonday(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  // getUTCDay: Sunday is 0, so Sunday is 6 days into a Monday-first week.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  return addDays(isoDate, 7 - dayOfWeek);
}

/**
 * The same day of the next month, or that month's last day when it has no
 * such date. Done by hand rather than with Date arithmetic, which rolls 31
 * January over into March instead of stopping at the end of February.
 */
export function sameDayNextMonth(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error(`Not a date: ${isoDate}`);
  const [year, month, day] = isoDate.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const clamped = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** `month` is 1–12. Day 0 of the next month is the last day of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
