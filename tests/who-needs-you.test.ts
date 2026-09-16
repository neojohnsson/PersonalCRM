import { describe, expect, it } from "vitest";
import { NO_MAIL, type Relationship } from "@/lib/relationship/load";
import { whoNeedsYou, type OpenTouch, type Person } from "@/lib/relationship/today";
import type { Turn } from "@/lib/relationship/whose-turn";

const latest = { at: new Date("2026-09-10T12:00:00Z"), threadId: "t", subject: "Hej" };

const person = (id: string, turn: Turn): Person<{ name: string }> => ({
  contact: { id, name: id },
  relationship: { ...NO_MAIL, turn } satisfies Relationship,
});

const yours = (days: number): Turn => ({ kind: "yours", days, ...latest });
const theirs = (days: number, goingQuiet: boolean): Turn => ({ kind: "theirs", days, goingQuiet, ...latest });

const touch = (contact_id: string, due_on: string): OpenTouch => ({
  id: `touch-${contact_id}`,
  contact_id,
  due_on,
  reason: null,
});

describe("whoNeedsYou", () => {
  const people = [
    person("karin", yours(2)),
    person("johan", yours(11)),
    person("sofia", theirs(24, true)),
    person("anders", theirs(16, true)),
    person("lars", theirs(3, false)),
    person("maja", { kind: "closed", days: 40, ...latest }),
    person("nils", { kind: "none" }),
  ];

  it("lists your turn with the longest wait first", () => {
    const { yours } = whoNeedsYou(people, [], "2026-09-16");
    expect(yours.map((p) => p.contact.id)).toEqual(["johan", "karin"]);
  });

  it("lists only threads going quiet, longest silence first — not every their turn", () => {
    const { quiet } = whoNeedsYou(people, [], "2026-09-16");
    expect(quiet.map((p) => p.contact.id)).toEqual(["sofia", "anders"]);
  });

  it("puts coming-up touches in date order, marking overdue and today", () => {
    const { comingUp } = whoNeedsYou(
      people,
      [touch("lars", "2026-10-02"), touch("maja", "2026-09-10"), touch("nils", "2026-09-16")],
      "2026-09-16",
    );

    expect(comingUp.map((t) => [t.contact.id, t.overdue, t.dueToday])).toEqual([
      ["maja", true, false],
      ["nils", false, true],
      ["lars", false, false],
    ]);
  });

  it("leaves out a touch whose contact isn't in the list", () => {
    const { comingUp } = whoNeedsYou(people, [touch("gone", "2026-09-20")], "2026-09-16");
    expect(comingUp).toEqual([]);
  });
});
