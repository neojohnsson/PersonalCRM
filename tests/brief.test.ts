import { describe, expect, it } from "vitest";
import {
  BRIEF_SIZE,
  pickBrief,
  thisWeek,
  weekEnd,
  weekStart,
  type BriefEntry,
} from "@/lib/relationship/brief";
import { NO_MAIL, type Relationship } from "@/lib/relationship/load";
import type { OpenTouch, Person } from "@/lib/relationship/today";
import type { Turn } from "@/lib/relationship/whose-turn";
import type { Band } from "@/lib/relationship/warmth";

/** Who the weekly brief picks, and the line it gives each of them. */

const latest = { at: new Date("2026-09-10T12:00:00Z"), threadId: "t", subject: "Hej" };
const yours = (days: number): Turn => ({ kind: "yours", days, ...latest });
const theirs = (days: number): Turn => ({ kind: "theirs", days, goingQuiet: days > 14, ...latest });
const closed = (days: number): Turn => ({ kind: "closed", days, ...latest });

const warmth = (band: Band): Relationship["warmth"] => ({
  score: band === "warm" ? 70 : band === "cooling" ? 45 : 20,
  band,
  signals: {
    replyRate: { answered: 1, sent: 1 },
    replySpeed: { medianMs: null, replies: 0 },
    lastContact: { days: 0, from: "them", at: latest.at },
    exchanges: { count: 2, since: latest.at },
  },
  points: { lastContact: 0, replyRate: 0, replySpeed: 0, exchanges: 0 },
});

const person = (id: string, turn: Turn, band: Band | null = null): Person<{ name: string }> => ({
  contact: { id, name: id },
  relationship: { ...NO_MAIL, turn, warmth: band ? warmth(band) : null, messageCount: 2 } satisfies Relationship,
});

const touch = (contact_id: string, due_on: string, reason: string | null = null): OpenTouch => ({
  id: `touch-${contact_id}`,
  contact_id,
  due_on,
  reason,
});

// Thursday 17 September 2026: the week runs Mon 14 – Sun 20.
const WEEK = { start: "2026-09-14", end: "2026-09-20", today: "2026-09-17" };
const reasons = (entries: BriefEntry<{ name: string }>[]) => entries.map((entry) => [entry.contact.id, entry.reason]);

describe("the week", () => {
  it("runs Monday to Sunday, whatever day it is", () => {
    expect(weekStart("2026-09-17")).toBe("2026-09-14"); // Thursday
    expect(weekStart("2026-09-14")).toBe("2026-09-14"); // Monday itself
    expect(weekStart("2026-09-20")).toBe("2026-09-14"); // Sunday belongs to the week before
    expect(weekEnd("2026-09-17")).toBe("2026-09-20");
  });

  it("asks Swedish time for today", () => {
    // 22:30 UTC on Sunday is already Monday in Sweden: a new week.
    expect(thisWeek(new Date("2026-09-20T22:30:00Z")).start).toBe("2026-09-21");
  });
});

describe("pickBrief", () => {
  it("puts the people waiting longest first, at most three of them", () => {
    const people = [person("a", yours(11)), person("b", yours(30)), person("c", yours(4)), person("d", yours(2))];
    const brief = pickBrief(people, [], WEEK);

    expect(reasons(brief)).toEqual([
      ["b", "waiting"],
      ["a", "waiting"],
      ["c", "waiting"],
    ]);
    expect(brief[0].because).toBe("They wrote 30 days ago and you haven't answered.");
  });

  it("adds what you planned: overdue first, then the rest of this week", () => {
    const people = [person("late", closed(40)), person("soon", closed(40)), person("later", closed(40))];
    const brief = pickBrief(
      people,
      [touch("late", "2026-09-13", "Ask about the thesis"), touch("soon", "2026-09-18"), touch("later", "2026-10-05")],
      WEEK,
    );

    expect(reasons(brief)).toEqual([
      ["late", "overdue"],
      ["soon", "due_this_week"],
    ]);
    expect(brief[0].because).toBe("You planned this for 4 days ago: Ask about the thesis.");
    expect(brief[1].because).toBe("You planned to get back to them on Friday.");
  });

  it("adds two going quiet, and warns before someone goes cold", () => {
    const people = [
      person("quiet-long", theirs(31)),
      person("quiet", theirs(20)),
      person("quiet-too", theirs(16)),
      person("cooling", closed(68), "cooling"),
      person("gone", closed(120), "cold"),
    ];
    const brief = pickBrief(people, [], WEEK);

    expect(reasons(brief)).toEqual([
      ["quiet-long", "going_quiet"],
      ["quiet", "going_quiet"],
      ["cooling", "about_to_cool"],
    ]);
    expect(brief.find((entry) => entry.contact.id === "cooling")!.because).toBe(
      "You've talked for months, and it's been 68 days.",
    );
  });

  it("leaves out no mail, a touch planned for later, and someone you just wrote to", () => {
    const people = [
      person("no-mail", { kind: "none" }),
      person("planned-later", yours(20)),
      person("just-wrote", theirs(2)),
    ];
    const brief = pickBrief(people, [touch("planned-later", "2026-10-01")], WEEK);
    expect(brief).toEqual([]);
  });

  it("lists a person once, under their strongest reason", () => {
    const people = [person("both", yours(25), "warm")];
    const brief = pickBrief(people, [touch("both", "2026-09-13")], WEEK);

    expect(brief).toHaveLength(1);
    expect(brief[0].reason).toBe("waiting");
  });

  it("never gives more than eight people", () => {
    const people = Array.from({ length: 30 }, (_, i) => person(`p${i}`, theirs(20 + i)));
    expect(pickBrief(people, [], WEEK).length).toBeLessThanOrEqual(BRIEF_SIZE);
  });
});
