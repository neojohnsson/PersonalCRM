import { describe, expect, it } from "vitest";
import { dayMonth, dayMonthYear, weekdayDayMonth } from "@/lib/format";

describe("dayMonth", () => {
  it("writes the day and month the way the design does", () => {
    expect(dayMonth("2026-09-03T09:00:00Z")).toBe("3 September");
  });

  it("uses Swedish time, so late-evening mail keeps its own day", () => {
    // 21:30 UTC is 23:30 in Sweden (summer time): still the 3rd.
    expect(dayMonth("2026-09-03T21:30:00Z")).toBe("3 September");
    // 22:30 UTC is 00:30 in Sweden: already the 4th.
    expect(dayMonth("2026-09-03T22:30:00Z")).toBe("4 September");
  });

  it("can use another time zone", () => {
    expect(dayMonth("2026-09-03T22:30:00Z", "UTC")).toBe("3 September");
  });
});

describe("weekdayDayMonth", () => {
  it("writes the date the way Main's heading does, in Swedish time", () => {
    expect(weekdayDayMonth("2026-09-10T09:00:00Z")).toBe("Thursday, 10 September");
    // 22:30 UTC on Thursday is already Friday in Sweden.
    expect(weekdayDayMonth("2026-09-10T22:30:00Z")).toBe("Friday, 11 September");
  });
});

describe("dayMonthYear", () => {
  it("adds the year, still in Swedish time", () => {
    expect(dayMonthYear("2026-03-04T09:00:00Z")).toBe("4 March 2026");
    expect(dayMonthYear("2025-12-31T23:30:00Z")).toBe("1 January 2026");
  });
});
