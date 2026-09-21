import { MAX_GUESTS } from "@/lib/calendar/meetings";
import type { GoogleEvent } from "@/lib/google/calendar";
import { addDays, todayIn } from "@/lib/relationship/dates";

/**
 * The week the calendar page draws (slice 8b; design/Calendar.dc.html).
 *
 * Pure: events and a contact map in, positioned blocks out. The page does no
 * arithmetic of its own, so the grid can be tested without a browser.
 *
 * Only the grid lives here. What counts as a *meeting* is
 * lib/calendar/meetings.ts, and the two are deliberately different questions:
 * the grid shows everything in your week, including the lectures and the focus
 * blocks, because a week with the other events left out would look wrong and
 * make the meetings hard to place.
 */

/** The hours the grid covers, as the design draws them: 08 to 18. */
export const FIRST_HOUR = 8;
export const LAST_HOUR = 18;

/** Pixels per hour, from the design's 64px hour lines. */
export const HOUR_HEIGHT = 64;

export type WeekDay = {
  /** YYYY-MM-DD. */
  date: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  isWeekend: boolean;
};

export type WeekEvent = {
  id: string;
  title: string;
  /** "09:00 – 10:00", in the reader's own day. */
  when: string;
  /** Which day column, as an index into `days`. */
  dayIndex: number;
  /** Where the block sits, in pixels from the top of the grid. */
  top: number;
  height: number;
  /** The contact it is with, when it is with one. */
  contactId: string | null;
  startedAt: Date;
  endedAt: Date;
};

export type Week = {
  /** Monday, YYYY-MM-DD. */
  monday: string;
  days: WeekDay[];
  events: WeekEvent[];
  /** Hour labels down the left: 8, 9, … 18. */
  hours: number[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week a date falls in. YYYY-MM-DD. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/**
 * `addressToContact` maps a lowercased address to a contact id — the same map
 * the read uses, so the grid agrees with what was stored.
 *
 * `timeZone` decides which column an event lands in and what time is printed:
 * a meeting at 00:30 Swedish time is Tuesday in Sweden and Monday in UTC, and
 * the person reading is in Sweden.
 */
export function buildWeek(
  monday: string,
  events: GoogleEvent[],
  addressToContact: Map<string, string>,
  now: Date,
  timeZone = "Europe/Stockholm",
): Week {
  const today = todayIn(timeZone, now);

  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return {
      date,
      weekday: WEEKDAYS[index],
      dayOfMonth: Number(date.slice(8, 10)),
      isToday: date === today,
      isWeekend: index >= 5,
    };
  });

  const dayIndexes = new Map(days.map((day, index) => [day.date, index]));
  const placed: WeekEvent[] = [];

  for (const event of events) {
    if (!event.id || event.status === "cancelled") continue;
    // All-day entries have no place in an hour grid; the design has no row for
    // them either.
    if (!event.start?.dateTime || !event.end?.dateTime) continue;

    const startedAt = new Date(event.start.dateTime);
    const endedAt = new Date(event.end.dateTime);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) continue;

    const dayIndex = dayIndexes.get(todayIn(timeZone, startedAt));
    if (dayIndex === undefined) continue;

    const attendees = event.attendees ?? [];
    const contactId =
      attendees.length > MAX_GUESTS
        ? null
        : (attendees
            .filter((attendee) => !attendee.self && attendee.email)
            .map((attendee) => addressToContact.get(attendee.email!.trim().toLowerCase()))
            .find((id): id is string => Boolean(id)) ?? null);

    const startMinutes = minutesIntoDay(startedAt, timeZone);
    const endMinutes = minutesIntoDay(endedAt, timeZone);

    placed.push({
      id: event.id,
      title: event.summary?.trim() || "(no title)",
      when: `${clock(startedAt, timeZone)} – ${clock(endedAt, timeZone)}`,
      dayIndex,
      top: ((startMinutes - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT,
      // A 15-minute meeting still needs to be readable.
      height: Math.max(24, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT),
      contactId,
      startedAt,
      endedAt,
    });
  }

  return {
    monday,
    days,
    events: placed.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
    hours: Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i),
  };
}

/** "09:00" in the given zone. */
export function clock(at: Date, timeZone = "Europe/Stockholm"): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(at);
}

function minutesIntoDay(at: Date, timeZone: string): number {
  const [hours, minutes] = clock(at, timeZone).split(":").map(Number);
  return hours * 60 + minutes;
}

/** "8 – 14 September", the design's week label. Spans a month end honestly. */
export function weekLabel(monday: string, timeZone = "Europe/Stockholm"): string {
  const sunday = addDays(monday, 6);
  const month = (date: string) =>
    new Intl.DateTimeFormat("en-GB", { month: "long", timeZone }).format(new Date(`${date}T12:00:00Z`));
  const day = (date: string) => Number(date.slice(8, 10));

  return month(monday) === month(sunday)
    ? `${day(monday)} – ${day(sunday)} ${month(sunday)}`
    : `${day(monday)} ${month(monday)} – ${day(sunday)} ${month(sunday)}`;
}
