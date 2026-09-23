import { readFileSync } from "node:fs";
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
import { GOING_QUIET_DAYS, type Turn } from "@/lib/relationship/whose-turn";
import type { Band } from "@/lib/relationship/warmth";

/** Who the weekly brief picks, and the line it gives each of them. */

const latest = { at: new Date("2026-09-10T12:00:00Z"), threadId: "t", subject: "Hej" };
const yours = (days: number): Turn => ({ kind: "yours", days, ...latest });
const theirs = (days: number): Turn => ({ kind: "theirs", days, goingQuiet: days > GOING_QUIET_DAYS, ...latest });
const closed = (days: number): Turn => ({ kind: "closed", days, ...latest });

const warmth = (band: Band): Relationship["warmth"] => ({
  score: band === "warm" ? 70 : band === "cooling" ? 45 : 20,
  band,
  signals: {
    replyRate: { answered: 1, sent: 1 },
    replySpeed: { medianMs: null, replies: 0 },
    lastContact: { days: 0, from: "them", at: latest.at },
    exchanges: { count: 2, since: latest.at },
    meetings: { count: 0, lastAt: null },
  },
  points: { lastContact: 0, replyRate: 0, replySpeed: 0, exchanges: 0 },
});

const person = (id: string, turn: Turn, band: Band | null = null): Person<{ name: string }> => ({
  contact: { id, name: id },
  relationship: { ...NO_MAIL, turn, warmth: band ? warmth(band) : null, messageCount: 2 } satisfies Relationship,
});

const touch = (
  contact_id: string,
  due_on: string,
  reason: string | null = null,
  kind: string | null = null,
): OpenTouch => ({
  id: `touch-${contact_id}`,
  contact_id,
  due_on,
  reason,
  kind,
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
    expect(brief[1].because).toBe("You planned to get back to them tomorrow.");
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
    // A day you chose and missed beats a wait (changed 2026-09-21): the passes
    // run in the order the reasons are listed, and overdue is listed first.
    expect(brief[0].reason).toBe("overdue");
  });

  it("does not let one reason fill the whole list", () => {
    // Ten plans all due the same Monday was the real case: before the caps,
    // the eight rows were nearly all plans and the people waiting fell off.
    const planned = Array.from({ length: 6 }, (_, i) => person(`plan${i}`, closed(40)));
    const waiting = Array.from({ length: 4 }, (_, i) => person(`wait${i}`, yours(10 + i)));
    const touches = planned.map((p) => touch(p.contact.id, "2026-09-18"));

    const brief = pickBrief([...planned, ...waiting], touches, WEEK);
    const reasonsUsed = brief.map((entry) => entry.reason);

    expect(reasonsUsed.filter((reason) => reason === "due_this_week")).toHaveLength(3);
    expect(reasonsUsed.filter((reason) => reason === "waiting")).toHaveLength(3);
  });

  it("leaves out a finished conversation, and takes it back when they write again", () => {
    const settledAt = new Date("2026-09-15T08:00:00Z");
    const handedOff = person("michail", yours(9));
    handedOff.relationship = { ...handedOff.relationship, settledAt };

    expect(pickBrief([handedOff], [], WEEK)).toEqual([]);

    // They wrote again after you said you were done: a newer fact wins.
    const wroteAgain = person("michail", {
      ...latest,
      kind: "yours",
      days: 1,
      at: new Date("2026-09-16T09:00:00Z"),
    });
    wroteAgain.relationship = { ...wroteAgain.relationship, settledAt };
    expect(reasons(pickBrief([wroteAgain], [], WEEK))).toEqual([["michail", "waiting"]]);
  });

  it("never works out a reason for someone you never chase", () => {
    const linda = person("linda", yours(30));
    linda.relationship = { ...linda.relationship, neverChase: true };
    const sven = person("sven", theirs(40));
    sven.relationship = { ...sven.relationship, neverChase: true };

    expect(pickBrief([linda, sven], [], WEEK)).toEqual([]);
  });

  it("still lists a day you set yourself, whatever you said about the person", () => {
    // A next touch is your own plan. Silencing it would only hide it from you.
    const linda = person("linda", yours(30));
    linda.relationship = { ...linda.relationship, neverChase: true };

    const brief = pickBrief([linda], [touch("linda", "2026-09-18", "Send the address")], WEEK);
    expect(reasons(brief)).toEqual([["linda", "due_this_week"]]);
  });

  it("puts the soonest of this week's plans first", () => {
    const people = [person("sun", closed(40)), person("fri", closed(40))];
    const brief = pickBrief(people, [touch("sun", "2026-09-20"), touch("fri", "2026-09-18")], WEEK);

    expect(brief.map((entry) => entry.contact.id)).toEqual(["fri", "sun"]);
  });

  it("never gives more than eight people", () => {
    const people = Array.from({ length: 30 }, (_, i) => person(`p${i}`, theirs(20 + i)));
    expect(pickBrief(people, [], WEEK).length).toBeLessThanOrEqual(BRIEF_SIZE);
  });
});

/** Slice 9a: waiting on somebody is a reminder to check, not a thing to do. */
describe("a touch you are waiting on", () => {
  it("says so, and offers nothing to draft", () => {
    const people = [person("peter", closed(40))];
    const touches = [touch("peter", "2026-09-18", "Wait for Peter's response", "they_will_get_back")];

    const [entry] = pickBrief(people, touches, WEEK);

    expect(entry.waitingOnThem).toBe(true);
    expect(entry.because).toBe("Waiting on them: Wait for Peter's response. Check again tomorrow.");
  });

  it("says something different again when the day has passed", () => {
    const people = [person("peter", closed(40))];
    const touches = [touch("peter", "2026-09-14", "Wait for the manager", "waiting_on_them")];

    const [entry] = pickBrief(people, touches, WEEK);

    expect(entry.waitingOnThem).toBe(true);
    expect(entry.because).toBe("Still nothing from them: Wait for the manager. You were checking 3 days ago.");
  });

  it("leaves a touch with no kind exactly as it was", () => {
    const people = [person("karin", closed(40))];
    const touches = [touch("karin", "2026-09-18", "Ask about the thesis")];

    const [entry] = pickBrief(people, touches, WEEK);

    expect(entry.waitingOnThem).toBe(false);
    expect(entry.because).toBe("You planned to get back to them tomorrow: Ask about the thesis.");
  });
});

/** Found in QA, 2026-09-23. */
describe("the words, as a person reads them", () => {
  it("says today and tomorrow, and the weekday after that", () => {
    const people = [person("a", closed(40)), person("b", closed(40)), person("c", closed(40))];
    const touches = [touch("a", "2026-09-17"), touch("b", "2026-09-18"), touch("c", "2026-09-19")];

    const because = Object.fromEntries(pickBrief(people, touches, WEEK).map((entry) => [entry.contact.id, entry.because]));

    expect(because.a).toBe("You planned to get back to them today.");
    expect(because.b).toBe("You planned to get back to them tomorrow.");
    expect(because.c).toBe("You planned to get back to them on Saturday.");
  });

  it("ends a sentence with one full stop, whatever the reason ends with", () => {
    const people = [person("mats", closed(40)), person("peter", closed(40))];
    const touches = [
      touch("mats", "2026-09-19", "Check with the development manager."),
      touch("peter", "2026-09-19", "Wait for the manager...", "waiting_on_them"),
    ];

    const because = Object.fromEntries(pickBrief(people, touches, WEEK).map((entry) => [entry.contact.id, entry.because]));

    expect(because.mats).toBe("You planned to get back to them on Saturday: Check with the development manager.");
    expect(because.peter).toBe("Waiting on them: Wait for the manager. Check again on Saturday.");
  });
});

describe("going quiet", () => {
  it("means what it means on Home and Contacts: day 14 is not quiet yet, day 15 is", () => {
    const brief = pickBrief([person("fourteen", theirs(GOING_QUIET_DAYS)), person("fifteen", theirs(GOING_QUIET_DAYS + 1))], [], WEEK);

    expect(reasons(brief)).toEqual([["fifteen", "going_quiet"]]);
  });

  it("has no rule of its own to drift from that one", () => {
    const source = readFileSync("lib/relationship/brief.ts", "utf8");
    expect(source).not.toMatch(/GOING_QUIET_DAYS\s*=/);
    expect(source).toContain("turn.goingQuiet");
  });
});
