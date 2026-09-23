import { describe, expect, it } from "vitest";
import { EVENT_TIME_ZONE, MAX_TITLE, parseNewEvent } from "@/lib/calendar/new-event";

/**
 * Slice 10: what the Create event form is allowed to produce. The action checks
 * this again before anything reaches Google, because a POST can carry anything.
 */

const TODAY = "2026-09-22";
const form = (over: Partial<Parameters<typeof parseNewEvent>[0]> = {}) => ({
  title: "Coffee with Karin",
  date: "2026-09-29",
  time: "14:00",
  minutes: 30,
  ...over,
});

const ok = (over = {}) => {
  const parsed = parseNewEvent(form(over), TODAY);
  if (!parsed.ok) throw new Error(`expected it to parse: ${JSON.stringify(parsed.errors)}`);
  return parsed.event;
};

const errors = (over = {}) => {
  const parsed = parseNewEvent(form(over), TODAY);
  return parsed.ok ? {} : parsed.errors;
};

describe("an event the form may create", () => {
  it("is a title, a start, an end and the zone beside them", () => {
    expect(ok()).toEqual({
      title: "Coffee with Karin",
      startsAt: "2026-09-29T14:00:00",
      endsAt: "2026-09-29T14:30:00",
      timeZone: EVENT_TIME_ZONE,
    });
  });

  it("has no field for a guest, a description or anything else", () => {
    // The point of the whole slice: there is nowhere to put a guest.
    expect(Object.keys(ok()).sort()).toEqual(["endsAt", "startsAt", "timeZone", "title"]);
  });

  it("sends local times with no offset, so the hour the clocks change is Google's problem", () => {
    // Sweden moves to winter time on 25 October 2026.
    expect(ok({ date: "2026-10-25", time: "02:30" }).startsAt).toBe("2026-10-25T02:30:00");
    expect(ok().startsAt).not.toMatch(/[+Z]/);
  });

  it("carries a long one over midnight", () => {
    expect(ok({ time: "23:30", minutes: 60 })).toMatchObject({
      startsAt: "2026-09-29T23:30:00",
      endsAt: "2026-09-30T00:30:00",
    });
  });

  it("trims the title and keeps today as a valid day", () => {
    expect(ok({ title: "  Lunch  " }).title).toBe("Lunch");
    expect(ok({ date: TODAY }).startsAt).toBe(`${TODAY}T14:00:00`);
  });
});

describe("what it refuses", () => {
  it("an empty or enormous title", () => {
    expect(errors({ title: "   " })).toHaveProperty("title");
    expect(errors({ title: "x".repeat(MAX_TITLE + 1) })).toHaveProperty("title");
  });

  it("a day that has gone, and one absurdly far off", () => {
    expect(errors({ date: "2026-09-21" }).date).toBe("That day has passed.");
    expect(errors({ date: "2040-01-01" }).date).toBe("That's too far ahead.");
    expect(errors({ date: "not a date" })).toHaveProperty("date");
    expect(errors({ date: "2026-13-01" })).toHaveProperty("date");
  });

  it("anything that isn't a 24-hour time", () => {
    for (const time of ["25:00", "9:00", "14:60", "2pm", "", "14:00:00"]) {
      expect(errors({ time }), time).toHaveProperty("time");
    }
  });

  it("a length nobody was offered", () => {
    // A POST can say 10080 minutes; the form's list is the whole list.
    expect(errors({ minutes: 10080 })).toHaveProperty("minutes");
    expect(errors({ minutes: 0 })).toHaveProperty("minutes");
    expect(errors({ minutes: 31 })).toHaveProperty("minutes");
  });

  it("and says everything that is wrong at once", () => {
    const wrong = errors({ title: "", date: "yesterday", time: "midnight", minutes: 7 });
    expect(Object.keys(wrong).sort()).toEqual(["date", "minutes", "time", "title"]);
  });
});
