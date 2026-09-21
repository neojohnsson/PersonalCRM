import { describe, expect, it } from "vitest";
import {
  addMonths,
  addWorkingDays,
  firstWorkingDayOfMonth,
  nextWorkingDay,
  onWorkingDay,
  touchDate,
  type TimingContext,
} from "@/lib/relationship/touch-date";

/**
 * The next-touch date rules (docs/next-touch-dates-plan.md). 2026-09-17 is a
 * Thursday; 2026-09-19 and -20 are a weekend.
 */

const TODAY = "2026-09-17";
const context = (overrides: Partial<TimingContext> = {}): TimingContext => ({
  today: TODAY,
  lastFromYou: "2026-09-10",
  lastFromThem: "2026-09-12",
  ...overrides,
});
const date = (timing: string, extra: { date?: string | null; month?: string | null } = {}, ctx = context()) =>
  touchDate({ timing, date: extra.date ?? null, month: extra.month ?? null }, ctx);

describe("calendar helpers", () => {
  it("moves weekends to Monday and leaves weekdays alone", () => {
    expect(onWorkingDay("2026-09-19")).toBe("2026-09-21"); // Saturday
    expect(onWorkingDay("2026-09-20")).toBe("2026-09-21"); // Sunday
    expect(onWorkingDay("2026-09-17")).toBe("2026-09-17");
  });

  it("counts working days, skipping weekends", () => {
    expect(nextWorkingDay("2026-09-17")).toBe("2026-09-18"); // Thu → Fri
    expect(nextWorkingDay("2026-09-18")).toBe("2026-09-21"); // Fri → Mon
    expect(addWorkingDays("2026-09-17", 3)).toBe("2026-09-22"); // Thu → Fri, Mon, Tue
  });

  it("finds the first working day of a named month, and rejects nonsense", () => {
    expect(firstWorkingDayOfMonth("2026-11")).toBe("2026-11-02"); // 1 Nov 2026 is a Sunday
    expect(firstWorkingDayOfMonth("2027-02")).toBe("2027-02-01");
    for (const bad of [null, "2026-13", "spring", "2026-11-01"]) expect(firstWorkingDayOfMonth(bad)).toBeNull();
  });

  it("adds months, keeping to the end of shorter months", () => {
    expect(addMonths("2026-09-17", 1)).toBe("2026-10-17");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("touchDate", () => {
  it("stated_date: the date from the email, on a working day", () => {
    expect(date("stated_date", { date: "2026-10-01" })).toEqual({ dueOn: "2026-10-01", rough: false });
    expect(date("stated_date", { date: "2026-10-03" })).toEqual({ dueOn: "2026-10-05", rough: false }); // Sat → Mon
  });

  it("stated_date: no date when it isn't a real future date", () => {
    for (const bad of [null, "2026-02-30", "2026-09-16", "the 20th", "2040-01-01"]) {
      expect(date("stated_date", { date: bad })).toBeNull();
    }
  });

  it("reply_owed: next working day", () => {
    expect(date("reply_owed")).toEqual({ dueOn: "2026-09-18", rough: false });
    expect(date("reply_owed", {}, context({ today: "2026-09-18" }))).toEqual({ dueOn: "2026-09-21", rough: false });
  });

  it("referral: 3 working days from today", () => {
    expect(date("referral")).toEqual({ dueOn: "2026-09-22", rough: false });
  });

  it("waiting_on_them: a week after your last email, or next working day once that's past", () => {
    expect(date("waiting_on_them", {}, context({ lastFromYou: "2026-09-15" }))).toEqual({
      dueOn: "2026-09-22",
      rough: false,
    });
    expect(date("waiting_on_them", {}, context({ lastFromYou: "2026-09-01" }))).toEqual({
      dueOn: "2026-09-18",
      rough: false,
    });
    expect(date("waiting_on_them", {}, context({ lastFromYou: null }))).toEqual({ dueOn: "2026-09-18", rough: false });
  });

  it("they_will_get_back: two weeks after their last email, on a working day", () => {
    // 12 Sep + 14 = 26 Sep, a Saturday → Monday 28 Sep.
    expect(date("they_will_get_back")).toEqual({ dueOn: "2026-09-28", rough: false });
    expect(date("they_will_get_back", {}, context({ lastFromThem: "2026-08-01" }))).toEqual({
      dueOn: "2026-09-18",
      rough: false,
    });
  });

  it("later_event: the named month's first working day, else a month ahead marked rough", () => {
    expect(date("later_event", { month: "2027-02" })).toEqual({ dueOn: "2027-02-01", rough: false });
    expect(date("later_event")).toEqual({ dueOn: "2026-10-19", rough: true }); // 17 Oct is a Saturday
    expect(date("later_event", { month: "2026-05" })).toEqual({ dueOn: "2026-10-19", rough: true }); // month past
  });

  it("nothing_open and unknown kinds: no date at all", () => {
    expect(date("nothing_open")).toBeNull();
    expect(date("whenever")).toBeNull();
  });
});

/**
 * Slice 8a: a meeting already booked with them is the follow-up, so there is
 * nothing to plan.
 */
describe("touchDate, when you are seeing them anyway", () => {
  it("suggests nothing when the meeting comes first", () => {
    // they_will_get_back is 14 days after their last message: 26 September.
    const withoutCalendar = date("they_will_get_back");
    expect(withoutCalendar).toEqual({ dueOn: "2026-09-28", rough: false });

    // Seeing them on the 22nd, before that day: the meeting is the follow-up.
    expect(date("they_will_get_back", {}, context({ meetingWith: "2026-09-22" }))).toBeNull();
  });

  it("still suggests a day when the meeting is after it", () => {
    // Meeting in November, suggestion in September: you would write first.
    expect(date("they_will_get_back", {}, context({ meetingWith: "2026-11-10" }))).toEqual({
      dueOn: "2026-09-28",
      rough: false,
    });
  });

  it("suggests nothing when the meeting is on the very day it would pick", () => {
    expect(date("reply_owed", {}, context({ meetingWith: "2026-09-18" }))).toBeNull();
  });

  it("ignores a meeting that has already been and gone", () => {
    // Yesterday's meeting is contact that happened; warmth counted it, and it
    // is no reason to skip planning the next thing.
    expect(date("reply_owed", {}, context({ meetingWith: "2026-09-16" }))).toEqual({
      dueOn: "2026-09-18",
      rough: false,
    });
  });

  it("changes nothing at all with no calendar connected", () => {
    for (const timing of ["reply_owed", "referral", "waiting_on_them", "they_will_get_back"]) {
      expect(date(timing, {}, context({ meetingWith: null }))).toEqual(date(timing));
    }
  });
});
