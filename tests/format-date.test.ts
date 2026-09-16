import { describe, expect, it } from "vitest";
import { dayMonth } from "@/lib/format";

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
