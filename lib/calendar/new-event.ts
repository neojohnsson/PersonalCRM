import { addDays, isIsoDate } from "@/lib/relationship/dates";

/**
 * What you typed into the Create event form, checked (slice 10;
 * docs/slice-10-plan.md, decision 4).
 *
 * Pure, so the rules are a test rather than a thing the form is trusted to do.
 * The action checks the same input again before anything reaches Google — a
 * POST can carry whatever it likes, and this is the only place that decides
 * what an event may be.
 *
 * Deliberately four fields. No guests (a guest list makes Google email an
 * invitation), no description (the app reads none, so writing one would be a
 * new claim), no recurrence, no location.
 */

/** The app's zone, as everywhere else: dates are Swedish time (lib/relationship/dates.ts). */
export const EVENT_TIME_ZONE = "Europe/Stockholm";

/** How long, in minutes. The form offers these; anything else is refused. */
export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
export type Duration = (typeof DURATIONS)[number];

export const MAX_TITLE = 200;

/** How far ahead an event may be put: the same five years a next touch allows. */
export const MAX_DAYS_AHEAD = 5 * 366;

export type NewEventForm = {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
  minutes: number;
};

export type NewEventErrors = Partial<Record<"title" | "date" | "time" | "minutes", string>>;

export type ParsedNewEvent =
  | {
      ok: true;
      event: {
        title: string;
        /**
         * Local time, RFC 3339 without an offset — which Google accepts and
         * prefers when `timeZone` is sent beside it. No offset means no
         * guessing about the hour the clocks change.
         */
        startsAt: string;
        endsAt: string;
        timeZone: string;
      };
    }
  | { ok: false; errors: NewEventErrors };

/** `today` is YYYY-MM-DD in the app's zone, from the server. */
export function parseNewEvent(form: NewEventForm, today: string): ParsedNewEvent {
  const errors: NewEventErrors = {};

  const title = form.title.trim();
  if (!title) errors.title = "Give it a name.";
  else if (title.length > MAX_TITLE) errors.title = `Keep it under ${MAX_TITLE} characters.`;

  if (!isIsoDate(form.date)) errors.date = "Pick a date.";
  else if (form.date < today) errors.date = "That day has passed.";
  else if (form.date > addDays(today, MAX_DAYS_AHEAD)) errors.date = "That's too far ahead.";

  const minutes = Number(form.minutes);
  if (!DURATIONS.includes(minutes as Duration)) errors.minutes = "Pick how long it is.";

  const time = form.time.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = "Pick a time, like 14:00.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    event: {
      title,
      startsAt: `${form.date}T${time}:00`,
      endsAt: endOf(form.date, time, minutes),
      timeZone: EVENT_TIME_ZONE,
    },
  };
}

/**
 * The end, which can be on the next day: 23:30 plus an hour is 00:30 tomorrow.
 *
 * Done in whole minutes rather than with a Date, so no zone is involved — the
 * zone is named beside the times and Google applies it.
 */
function endOf(date: string, time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  const days = Math.floor(total / (24 * 60));
  const rest = total % (24 * 60);

  const endDate = days > 0 ? addDays(date, days) : date;
  const hh = String(Math.floor(rest / 60)).padStart(2, "0");
  const mm = String(rest % 60).padStart(2, "0");
  return `${endDate}T${hh}:${mm}:00`;
}
