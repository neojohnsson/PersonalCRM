import { describe, expect, it } from "vitest";
import { AVATAR_COLORS, avatarColors, countOf, daysAgo, initials, timeAgo } from "@/lib/format";

const NOW = new Date("2026-09-15T12:00:00Z");
const before = (ms: number) => new Date(NOW.getTime() - ms);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("countOf", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(countOf(1, "message")).toBe("1 message");
    expect(countOf(0, "message")).toBe("0 messages");
    expect(countOf(1, "person", "people")).toBe("1 person");
    expect(countOf(48, "person", "people")).toBe("48 people");
  });

  it("groups thousands", () => {
    expect(countOf(1234, "message")).toBe("1,234 messages");
  });
});

describe("timeAgo", () => {
  it("says just now for under a minute, and for clocks slightly ahead", () => {
    expect(timeAgo(before(30_000), NOW)).toBe("just now");
    expect(timeAgo(before(-5_000), NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(timeAgo(before(MINUTE), NOW)).toBe("1 minute ago");
    expect(timeAgo(before(4 * MINUTE + 59_000), NOW)).toBe("4 minutes ago");
    expect(timeAgo(before(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(timeAgo(before(2 * DAY), NOW)).toBe("2 days ago");
  });

  it("accepts the ISO strings the database returns", () => {
    expect(timeAgo("2026-09-15T11:56:00+00:00", NOW)).toBe("4 minutes ago");
  });
});

describe("daysAgo", () => {
  it("writes days the way the design's Last column does", () => {
    expect(daysAgo(before(3 * HOUR), NOW)).toBe("today");
    expect(daysAgo(before(6 * DAY), NOW)).toBe("6d");
    expect(daysAgo(before(120 * DAY), NOW)).toBe("120d");
  });
});

describe("initials", () => {
  it("takes the first and last word of a name, keeping å ä ö", () => {
    expect(initials("Maja Öberg", "maja@example.se")).toBe("MÖ");
    expect(initials("Anna Maria Ek", "anna@example.se")).toBe("AE");
  });

  it("uses one letter for a one-word name", () => {
    expect(initials("Karin", "karin@example.se")).toBe("K");
  });

  it("falls back to the address when there's no name", () => {
    expect(initials(null, "karin.lindqvist@example.se")).toBe("KL");
    expect(initials("  ", "johan_ek@example.se")).toBe("JE");
    expect(initials(null, "karin@example.se")).toBe("K");
  });

  it("skips words with no letters in them", () => {
    expect(initials("Karin (Fortnox)", "k@example.se")).toBe("KF");
    expect(initials(null, "123@example.se")).toBe("?");
  });
});

describe("avatarColors", () => {
  it("always gives the same person the same colours", () => {
    expect(avatarColors("karin@example.se")).toEqual(avatarColors("karin@example.se"));
  });

  it("only uses the design's colour pairs", () => {
    for (const key of ["a", "karin@example.se", "johan@example.se", "åsa@example.se"]) {
      expect(AVATAR_COLORS).toContain(avatarColors(key));
    }
  });
});
