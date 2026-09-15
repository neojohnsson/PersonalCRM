import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOKBACK_DAYS, lookbackDays } from "@/lib/sync/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lookbackDays", () => {
  it("reads SYNC_DEFAULT_LOOKBACK_DAYS", () => {
    vi.stubEnv("SYNC_DEFAULT_LOOKBACK_DAYS", "30");
    expect(lookbackDays()).toBe(30);
  });

  it("falls back to 90 when the setting is missing or not a positive whole number", () => {
    for (const value of ["", "abc", "0", "-5", "12.5"]) {
      vi.stubEnv("SYNC_DEFAULT_LOOKBACK_DAYS", value);
      expect(lookbackDays()).toBe(DEFAULT_LOOKBACK_DAYS);
    }
    expect(DEFAULT_LOOKBACK_DAYS).toBe(90);
  });
});
