import { describe, expect, it } from "vitest";
import { countByFilter, hasTag, matchesFilter, parseFilter, topTags } from "@/lib/relationship/list";
import type { Turn } from "@/lib/relationship/whose-turn";

const latest = { days: 3, at: new Date("2026-09-13T09:00:00Z"), threadId: "t", subject: null };

const yours: Turn = { kind: "yours", ...latest };
const theirs: Turn = { kind: "theirs", goingQuiet: false, ...latest };
const quiet: Turn = { kind: "theirs", goingQuiet: true, ...latest, days: 20 };
const closed: Turn = { kind: "closed", ...latest, days: 60 };
const none: Turn = { kind: "none" };

describe("parseFilter", () => {
  it("accepts the known filters and falls back to all", () => {
    expect(parseFilter("yours")).toBe("yours");
    expect(parseFilter(["quiet", "yours"])).toBe("quiet");
    expect(parseFilter("everything")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});

describe("matchesFilter", () => {
  it("puts each turn under its chip", () => {
    expect(matchesFilter(yours, "yours")).toBe(true);
    expect(matchesFilter(theirs, "theirs")).toBe(true);
    expect(matchesFilter(theirs, "yours")).toBe(false);
  });

  it("counts going quiet as their turn too", () => {
    expect(matchesFilter(quiet, "theirs")).toBe(true);
    expect(matchesFilter(quiet, "quiet")).toBe(true);
    expect(matchesFilter(theirs, "quiet")).toBe(false);
  });

  it("puts contacts with no mail under no open thread", () => {
    expect(matchesFilter(closed, "closed")).toBe(true);
    expect(matchesFilter(none, "closed")).toBe(true);
    expect(matchesFilter(none, "all")).toBe(true);
  });
});

describe("countByFilter", () => {
  it("counts every chip", () => {
    expect(countByFilter([yours, yours, theirs, quiet, closed, none])).toEqual({
      all: 6,
      yours: 2,
      theirs: 2,
      closed: 2,
      quiet: 1,
    });
  });
});

describe("topTags", () => {
  it("counts tags across contacts regardless of case, most used first", () => {
    expect(topTags([["växjö", "thesis"], ["Växjö"], ["recruiter", "växjö"], ["Thesis"]])).toEqual([
      { tag: "växjö", count: 3 },
      { tag: "thesis", count: 2 },
      { tag: "recruiter", count: 1 },
    ]);
  });

  it("counts a contact once even if it repeats a tag, and keeps to the limit", () => {
    expect(topTags([["a", "A"], ["b"], ["c"]], 2)).toEqual([
      { tag: "a", count: 1 },
      { tag: "b", count: 1 },
    ]);
  });
});

describe("hasTag", () => {
  it("matches regardless of case", () => {
    expect(hasTag(["Växjö", "thesis"], "växjö")).toBe(true);
    expect(hasTag(["thesis"], "LNU")).toBe(false);
  });
});
