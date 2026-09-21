import { describe, expect, it } from "vitest";
import { FIRST_HOUR, LAST_HOUR, buildWeek, clock, mondayOf, weekLabel } from "@/lib/calendar/week";
import type { GoogleEvent } from "@/lib/google/calendar";

/**
 * The week the calendar page draws (docs/slice-8-plan.md, Part 5).
 *
 * The grid shows everything in the week, not only meetings with contacts: a
 * week with the lectures left out would look wrong and make the meetings hard
 * to place. Which of them *counts* is a different question, answered in
 * lib/calendar/meetings.ts.
 */

const MONDAY = "2026-09-21";
const NOW = new Date("2026-09-23T10:00:00Z"); // Wednesday
const contacts = new Map([["karin@fortnox.se", "contact-karin"]]);

const event = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "evt-1",
  status: "confirmed",
  summary: "Coffee with Karin",
  start: { dateTime: "2026-09-22T09:00:00Z" },
  end: { dateTime: "2026-09-22T10:00:00Z" },
  attendees: [{ email: "me@example.se", self: true }, { email: "karin@fortnox.se" }],
  ...over,
});

describe("the week", () => {
  it("runs Monday to Sunday and marks today", () => {
    const week = buildWeek(MONDAY, [], contacts, NOW);

    expect(week.days.map((day) => day.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(week.days.map((day) => day.dayOfMonth)).toEqual([21, 22, 23, 24, 25, 26, 27]);
    expect(week.days.filter((day) => day.isToday).map((day) => day.date)).toEqual(["2026-09-23"]);
    expect(week.days.filter((day) => day.isWeekend).map((day) => day.weekday)).toEqual(["Sat", "Sun"]);
  });

  it("finds Monday from any day, and labels the week", () => {
    expect(mondayOf("2026-09-23")).toBe(MONDAY);
    expect(mondayOf("2026-09-27")).toBe(MONDAY); // Sunday belongs to that week
    expect(weekLabel(MONDAY)).toBe("21 – 27 September");
    // A week that crosses a month says both months rather than lying.
    expect(weekLabel("2026-09-28")).toBe("28 September – 4 October");
  });
});

describe("placing an event", () => {
  it("puts it in the right column, at the right height", () => {
    const week = buildWeek(MONDAY, [event()], contacts, NOW);
    const placed = week.events[0];

    // 09:00 UTC is 11:00 in Sweden, on the Tuesday.
    expect(placed.dayIndex).toBe(1);
    expect(placed.when).toBe("11:00 – 12:00");

    // A place in the grid, not a number of pixels: the grid fills whatever
    // height the page gives it, so nothing scrolls (2026-09-21).
    const hours = LAST_HOUR - FIRST_HOUR;
    expect(placed.topPercent).toBeCloseTo(((11 - FIRST_HOUR) / hours) * 100);
    expect(placed.heightPercent).toBeCloseTo((1 / hours) * 100);
    expect(placed.contactId).toBe("contact-karin");
    expect(placed.title).toBe("Coffee with Karin");
  });

  it("puts an event in the reader's own day, not UTC's", () => {
    // 23:30 UTC on Monday is 01:30 Tuesday in Sweden.
    const lateNight = event({
      start: { dateTime: "2026-09-21T23:30:00Z" },
      end: { dateTime: "2026-09-22T00:00:00Z" },
    });

    expect(buildWeek(MONDAY, [lateNight], contacts, NOW).events[0].dayIndex).toBe(1);
  });

  it("gives a short meeting its true height, and lets CSS keep it readable", () => {
    const quarter = event({
      start: { dateTime: "2026-09-22T09:00:00Z" },
      end: { dateTime: "2026-09-22T09:15:00Z" },
    });

    // Fifteen minutes of a ten-hour grid. The page floors the *rendered*
    // height in pixels rather than lying here about how long it was.
    const placed = buildWeek(MONDAY, [quarter], contacts, NOW).events[0];
    expect(placed.heightPercent).toBeCloseTo((0.25 / (LAST_HOUR - FIRST_HOUR)) * 100);
  });

  it("shows other people's events too, with no contact on them", () => {
    const lecture = event({
      id: "evt-lecture",
      summary: "Lecture · Systems theory",
      attendees: undefined,
    });

    const placed = buildWeek(MONDAY, [lecture], contacts, NOW).events[0];
    expect(placed.contactId).toBeNull();
    expect(placed.title).toBe("Lecture · Systems theory");
  });

  it("does not colour a webinar as a meeting with somebody", () => {
    const webinar = event({
      attendees: [
        { email: "me@example.se", self: true },
        { email: "karin@fortnox.se" },
        ...Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@example.com` })),
      ],
    });

    // The same rule as the meeting count: being in the room says nothing.
    expect(buildWeek(MONDAY, [webinar], contacts, NOW).events[0].contactId).toBeNull();
  });

  it("leaves out what has no place in an hour grid", () => {
    const week = buildWeek(
      MONDAY,
      [
        event({ id: "evt-cancelled", status: "cancelled" }),
        event({ id: "evt-holiday", start: { date: "2026-09-22" }, end: { date: "2026-09-23" } }),
        event({ id: "evt-elsewhere", start: { dateTime: "2026-10-05T09:00:00Z" }, end: { dateTime: "2026-10-05T10:00:00Z" } }),
      ],
      contacts,
      NOW,
    );

    expect(week.events).toEqual([]);
  });

  it("gives an untitled event something to show", () => {
    const untitled = buildWeek(MONDAY, [event({ summary: undefined })], contacts, NOW);
    expect(untitled.events[0].title).toBe("(no title)");
  });

  it("puts the events in time order", () => {
    const week = buildWeek(
      MONDAY,
      [
        event({ id: "later", start: { dateTime: "2026-09-22T14:00:00Z" }, end: { dateTime: "2026-09-22T15:00:00Z" } }),
        event({ id: "earlier" }),
      ],
      contacts,
      NOW,
    );

    expect(week.events.map((placed) => placed.id)).toEqual(["earlier", "later"]);
  });
});

describe("clock", () => {
  it("prints a 24-hour time in the reader's zone", () => {
    expect(clock(new Date("2026-09-22T09:00:00Z"))).toBe("11:00");
    expect(clock(new Date("2026-09-22T09:00:00Z"), "UTC")).toBe("09:00");
  });
});
