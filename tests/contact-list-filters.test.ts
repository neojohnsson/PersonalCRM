import { describe, expect, it } from "vitest";
import {
  bucketOf,
  countByFilter,
  hasTag,
  matchesFilter,
  parseFilter,
  standingRank,
  topTags,
} from "@/lib/relationship/list";
import { standingOf, type Standing } from "@/lib/relationship/standing";
import type { Turn } from "@/lib/relationship/whose-turn";

/**
 * The chips take a Standing, not a Turn (slice 9a). Before that they knew
 * nothing about a settled conversation or a person never chased, so the list
 * said YOUR TURN about somebody whose own page said "Nothing owed".
 */

const latest = { days: 3, at: new Date("2026-09-13T09:00:00Z"), threadId: "t", subject: null };

const turns = {
  yours: { kind: "yours", ...latest } as Turn,
  theirs: { kind: "theirs", goingQuiet: false, ...latest } as Turn,
  quiet: { kind: "theirs", goingQuiet: true, ...latest, days: 20 } as Turn,
  closed: { kind: "closed", ...latest, days: 60 } as Turn,
  none: { kind: "none" } as Turn,
};

const open = (turn: Turn): Standing => ({ kind: "open", turn });

const yours = open(turns.yours);
const theirs = open(turns.theirs);
const quiet = open(turns.quiet);
const closed = open(turns.closed);
const none = open(turns.none);
const settled: Standing = { kind: "settled", at: new Date("2026-09-18T08:00:00Z") };
const planned: Standing = { kind: "planned", dueOn: "2026-12-01" };
const muted: Standing = { kind: "never_chase" };

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

  it("takes a settled contact out of Your turn, and gives them their own chip", () => {
    // The bug, in one test: they wrote last, and you said it was finished.
    expect(matchesFilter(settled, "yours")).toBe(false);
    expect(matchesFilter(settled, "settled")).toBe(true);
  });

  it("takes a never-chased contact out of Going quiet", () => {
    expect(matchesFilter(muted, "quiet")).toBe(false);
    expect(matchesFilter(muted, "theirs")).toBe(false);
    expect(matchesFilter(muted, "muted")).toBe(true);
  });

  it("takes a planned contact out of the turn chips", () => {
    expect(matchesFilter(planned, "yours")).toBe(false);
    expect(matchesFilter(planned, "planned")).toBe(true);
  });

  it("leaves everyone in All, whatever you said about them", () => {
    for (const standing of [yours, settled, planned, muted, none]) {
      expect(matchesFilter(standing, "all")).toBe(true);
    }
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
    expect(countByFilter([yours, yours, theirs, quiet, closed, none, settled, planned, muted])).toEqual({
      all: 9,
      yours: 2,
      theirs: 2,
      quiet: 1,
      closed: 2,
      settled: 1,
      planned: 1,
      muted: 1,
    });
  });

  it("counts a settled contact once, and not as Your turn", () => {
    const counts = countByFilter([settled]);

    expect(counts.yours).toBe(0);
    expect(counts.settled).toBe(1);
    // Counted in All and under one chip, and nowhere else.
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(2);
  });
});

describe("bucketOf", () => {
  it("gives every standing exactly one home", () => {
    expect(bucketOf(yours)).toBe("yours");
    expect(bucketOf(theirs)).toBe("theirs");
    expect(bucketOf(quiet)).toBe("quiet");
    expect(bucketOf(closed)).toBe("closed");
    expect(bucketOf(none)).toBe("closed");
    expect(bucketOf(settled)).toBe("settled");
    expect(bucketOf(planned)).toBe("planned");
    expect(bucketOf(muted)).toBe("muted");
  });

  it("is what the row says, so a row cannot disagree with its chip", () => {
    // The whole point: one function decides the bucket, and the label is it.
    for (const standing of [yours, theirs, quiet, closed, settled, planned, muted]) {
      expect(matchesFilter(standing, bucketOf(standing))).toBe(true);
    }
  });
});

describe("the default order", () => {
  it("puts people the app would ask you about first", () => {
    const order = [muted, settled, planned, yours].sort((a, b) => standingRank(a) - standingRank(b));

    expect(order.map(bucketOf)).toEqual(["yours", "planned", "settled", "muted"]);
  });
});

/**
 * The test that would have caught this in 6c: one contact, one standing, and
 * every surface asked the same question.
 */
describe("every screen agrees", () => {
  const turn = turns.yours;
  const today = "2026-09-21";

  it("a settled conversation is settled on the list as well as on the page", () => {
    const standing = standingOf({ turn, settledAt: new Date("2026-09-20T08:00:00Z") }, today);

    expect(standing.kind).toBe("settled");
    // The list agrees, because it is the same function.
    expect(bucketOf(standing)).toBe("settled");
    expect(matchesFilter(standing, "yours")).toBe(false);
  });

  it("and comes back on both the moment they write again", () => {
    const wroteAfter: Turn = {
      kind: "yours",
      days: 0,
      at: new Date("2026-09-21T09:00:00Z"),
      threadId: "t",
      subject: null,
    };
    const standing = standingOf({ turn: wroteAfter, settledAt: new Date("2026-09-20T08:00:00Z") }, today);

    expect(standing.kind).toBe("open");
    expect(bucketOf(standing)).toBe("yours");
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
