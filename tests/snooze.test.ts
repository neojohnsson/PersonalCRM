import { describe, expect, it } from "vitest";
import { nextMonday, sameDayNextMonth, snoozeChoices, snoozeDate } from "@/lib/relationship/snooze";

/**
 * Slice 9b, Part 3: "Snooze" asks how long instead of silently adding seven
 * days. These are the dates behind the four buttons.
 */

describe("next Monday", () => {
  it("is the Monday after the week you are in", () => {
    // 2026-09-22 is a Tuesday.
    expect(nextMonday("2026-09-22")).toBe("2026-09-28");
    expect(nextMonday("2026-09-23")).toBe("2026-09-28"); // Wednesday
    expect(nextMonday("2026-09-27")).toBe("2026-09-28"); // Sunday, the week's last day
  });

  it("gives a Monday a whole week, not nothing at all", () => {
    expect(nextMonday("2026-09-28")).toBe("2026-10-05");
  });
});

describe("the same day next month", () => {
  it("keeps the day of the month", () => {
    expect(sameDayNextMonth("2026-09-22")).toBe("2026-10-22");
  });

  it("crosses the new year", () => {
    expect(sameDayNextMonth("2026-12-14")).toBe("2027-01-14");
  });

  it("stops at the end of a shorter month instead of rolling over", () => {
    // Plain Date arithmetic turns 31 January into 3 March.
    expect(sameDayNextMonth("2027-01-31")).toBe("2027-02-28");
    expect(sameDayNextMonth("2028-01-31")).toBe("2028-02-29"); // a leap year
    expect(sameDayNextMonth("2026-08-31")).toBe("2026-09-30");
  });
});

describe("the snooze choices", () => {
  const today = "2026-09-22"; // Tuesday

  it("offers tomorrow, next Monday and a month from now", () => {
    expect(snoozeChoices(today, today)).toEqual([
      { key: "tomorrow", label: "Tomorrow", dueOn: "2026-09-23" },
      { key: "next_week", label: "Next week", dueOn: "2026-09-28" },
      { key: "next_month", label: "Next month", dueOn: "2026-10-22" },
    ]);
  });

  it("counts from today, whatever the touch says, so a label is never a lie", () => {
    // Overdue by three days: "Tomorrow" still means tomorrow.
    const overdue = snoozeChoices(today, "2026-09-19");
    expect(overdue.map((choice) => choice.dueOn)).toEqual(["2026-09-23", "2026-09-28", "2026-10-22"]);
  });

  it("never offers a day that would pull a touch forward", () => {
    // Due next Friday: tomorrow and next Monday are both before it.
    expect(snoozeChoices(today, "2026-10-02").map((choice) => choice.key)).toEqual(["next_month"]);
    // Due in four months: none of them is a snooze at all.
    expect(snoozeChoices(today, "2027-02-01")).toEqual([]);
  });

  it("never offers the day the touch already has", () => {
    expect(snoozeChoices(today, "2026-09-28").map((choice) => choice.key)).toEqual(["next_month"]);
  });

  it("turns a choice back into a date, and refuses anything else", () => {
    expect(snoozeDate(today, today, "next_week")).toBe("2026-09-28");
    expect(snoozeDate(today, today, "next_year")).toBeNull();
    // A choice that isn't on offer has no date, so it can't be sent instead.
    expect(snoozeDate(today, "2026-10-02", "tomorrow")).toBeNull();
  });
});
