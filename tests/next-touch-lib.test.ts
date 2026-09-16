import { describe, expect, it } from "vitest";
import { addDays, daysBetweenDates, isIsoDate, laterDate, todayIn } from "@/lib/relationship/dates";
import { MAX_REASON_LENGTH, parseNextTouchForm } from "@/lib/relationship/next-touch";

describe("dates", () => {
  it("gives today's date in Swedish time, not the server's", () => {
    // 22:30 UTC on the 15th is 00:30 on the 16th in Sweden (summer time).
    expect(todayIn("Europe/Stockholm", new Date("2026-09-15T22:30:00Z"))).toBe("2026-09-16");
    expect(todayIn("UTC", new Date("2026-09-15T22:30:00Z"))).toBe("2026-09-15");
  });

  it("recognises only real dates", () => {
    expect(isIsoDate("2026-09-20")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("20 September")).toBe(false);
  });

  it("adds days across month and year ends and leap days", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2028-02-25", 7)).toBe("2028-03-03");
  });

  it("compares and measures dates", () => {
    expect(laterDate("2026-09-20", "2026-10-01")).toBe("2026-10-01");
    expect(daysBetweenDates("2026-09-16", "2026-09-20")).toBe(4);
    expect(daysBetweenDates("2026-09-20", "2026-09-16")).toBe(-4);
    // Across the switch to winter time, still whole days.
    expect(daysBetweenDates("2026-10-20", "2026-10-30")).toBe(10);
  });
});

describe("parseNextTouchForm", () => {
  const TODAY = "2026-09-16";

  function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.append(name, value);
    return data;
  }

  it("accepts a date and trims the reason", () => {
    expect(parseNextTouchForm(form({ due_on: "2026-10-01", reason: "  said the budget lands in October " }), TODAY)).toEqual({
      ok: true,
      touch: { dueOn: "2026-10-01", reason: "said the budget lands in October" },
    });
  });

  it("allows today, and no reason", () => {
    expect(parseNextTouchForm(form({ due_on: TODAY, reason: "  " }), TODAY)).toEqual({
      ok: true,
      touch: { dueOn: TODAY, reason: null },
    });
  });

  it("needs a real date that isn't in the past or years away", () => {
    const error = (due_on: string) => {
      const result = parseNextTouchForm(form({ due_on }), TODAY);
      return result.ok ? null : result.errors.due_on;
    };

    expect(error("")).toBe("Pick a date.");
    expect(error("2026-02-30")).toBe("Use a real date.");
    expect(error("2026-09-15")).toBe("Pick today or a later date.");
    expect(error("2035-01-01")).toBe("Pick a date within five years.");
  });

  it("limits the reason, and hands back what was typed", () => {
    const long = "x".repeat(MAX_REASON_LENGTH + 1);
    const result = parseNextTouchForm(form({ due_on: "2026-10-01", reason: long }), TODAY);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.reason).toBe(`Keep it under ${MAX_REASON_LENGTH} characters.`);
    expect(result.values).toEqual({ due_on: "2026-10-01", reason: long });
  });
});
