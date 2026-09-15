import { describe, expect, it } from "vitest";
import { BUDGET_SHARE, GMAIL_UNITS, GMAIL_UNITS_PER_MINUTE, waitAfter } from "@/lib/sync/pace";

describe("waitAfter", () => {
  it("spaces full backfill pages so a minute of them stays within budget", () => {
    const page = GMAIL_UNITS.messagesList + 50 * GMAIL_UNITS.messagesGet; // 1,005 units
    const unitsPerMinute = (page * 60_000) / waitAfter(page);

    expect(unitsPerMinute).toBeLessThanOrEqual(GMAIL_UNITS_PER_MINUTE * BUDGET_SHARE);
    expect(waitAfter(page)).toBe(12_563);
  });

  it("would have needed 25 seconds between the old 100-message pages", () => {
    expect(waitAfter(GMAIL_UNITS.messagesList + 100 * GMAIL_UNITS.messagesGet)).toBe(25_063);
  });

  it("barely waits after a cheap step, and not at all after a free one", () => {
    expect(waitAfter(GMAIL_UNITS.getProfile)).toBe(13);
    expect(waitAfter(0)).toBe(0);
  });
});
