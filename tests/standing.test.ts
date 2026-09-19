import { describe, expect, it } from "vitest";
import { prompts, standingOf } from "@/lib/relationship/standing";
import type { Turn } from "@/lib/relationship/whose-turn";

/**
 * What you said beats what the app inferred — and the order it happens in.
 */

const TODAY = "2026-09-19";

const wroteAt = new Date("2026-09-10T12:00:00Z");
const theyWrote: Turn = { kind: "yours", days: 9, at: wroteAt, threadId: "t1", subject: "Hej" };
const youWrote: Turn = {
  kind: "theirs",
  days: 9,
  goingQuiet: false,
  at: wroteAt,
  threadId: "t1",
  subject: "Hej",
};

/** The moment you pressed the button: after their message, before now. */
const settledAt = new Date("2026-09-18T08:00:00Z");

describe("standingOf", () => {
  it("says the plain fact when you have said nothing", () => {
    expect(standingOf({ turn: theyWrote }, TODAY)).toEqual({ kind: "open", turn: theyWrote });
    expect(standingOf({ turn: { kind: "none" } }, TODAY)).toEqual({
      kind: "open",
      turn: { kind: "none" },
    });
  });

  it("settles a finished conversation", () => {
    const standing = standingOf({ turn: theyWrote, settledAt }, TODAY);
    expect(standing).toEqual({ kind: "settled", at: settledAt });
    expect(prompts(standing)).toBe(false);
  });

  it("re-opens the thread when something newer arrives", () => {
    // They wrote again after you said nothing was owed. The newer fact wins.
    const wroteAgain: Turn = { ...theyWrote, at: new Date("2026-09-19T07:00:00Z"), days: 0 };
    const standing = standingOf({ turn: wroteAgain, settledAt }, TODAY);

    expect(standing).toEqual({ kind: "open", turn: wroteAgain });
    expect(prompts(standing)).toBe(true);
  });

  it("counts a settle made in the same breath as the message", () => {
    // Settling reads "nothing more is owed for what I have seen", so a settle
    // at the exact moment of the latest message still settles it.
    const standing = standingOf({ turn: theyWrote, settledAt: wroteAt }, TODAY);
    expect(standing.kind).toBe("settled");
  });

  it("says planned when you have chosen a day that hasn't come", () => {
    const standing = standingOf({ turn: theyWrote, plannedOn: "2026-03-03" }, "2026-01-10");
    expect(standing).toEqual({ kind: "planned", dueOn: "2026-03-03" });
    expect(prompts(standing)).toBe(false);
  });

  it("stops holding the prompt back once the day arrives", () => {
    // Due today, or overdue: the plan is now the thing that needs you.
    expect(standingOf({ turn: theyWrote, plannedOn: TODAY }, TODAY).kind).toBe("open");
    expect(standingOf({ turn: theyWrote, plannedOn: "2026-09-14" }, TODAY).kind).toBe("open");
  });

  it("never prompts about someone you never chase", () => {
    const standing = standingOf({ turn: theyWrote, neverChase: true }, TODAY);
    expect(standing).toEqual({ kind: "never_chase" });
    expect(prompts(standing)).toBe(false);
  });

  it("keeps the order: never chase, then planned, then settled, then the fact", () => {
    const all = { turn: theyWrote, settledAt, plannedOn: "2026-12-01", neverChase: true };

    expect(standingOf(all, TODAY).kind).toBe("never_chase");
    expect(standingOf({ ...all, neverChase: false }, TODAY).kind).toBe("planned");
    expect(standingOf({ ...all, neverChase: false, plannedOn: null }, TODAY).kind).toBe("settled");
    expect(standingOf({ turn: theyWrote }, TODAY).kind).toBe("open");
  });

  it("applies the same way whoever wrote last", () => {
    expect(standingOf({ turn: youWrote, settledAt }, TODAY).kind).toBe("settled");
    expect(standingOf({ turn: youWrote, neverChase: true }, TODAY).kind).toBe("never_chase");
  });
});
