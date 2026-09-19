import { describe, expect, it } from "vitest";
import {
  dateBadge,
  dueText,
  lastContactCaption,
  lastContactText,
  replyRateCaption,
  replySpeedText,
  standingPill,
  turnPill,
} from "@/lib/relationship/describe";
import type { Turn } from "@/lib/relationship/whose-turn";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const latest = { at: new Date("2026-09-10T12:00:00Z"), threadId: "t1", subject: "Hej" };

const yours = (days: number): Turn => ({ kind: "yours", days, ...latest });
const theirs = (days: number, goingQuiet = false): Turn => ({ kind: "theirs", goingQuiet, days, ...latest });

describe("turnPill", () => {
  it("says whose turn it is and for how long, as the design does", () => {
    expect(turnPill(yours(6))).toEqual({ text: "Your turn · 6 days", tone: "yours" });
    expect(turnPill(yours(1))).toEqual({ text: "Your turn · 1 day", tone: "yours" });
    expect(turnPill(yours(0))).toEqual({ text: "Your turn · today", tone: "yours" });
    expect(turnPill(theirs(3))).toEqual({ text: "Their turn · 3 days", tone: "theirs" });
    expect(turnPill(theirs(20, true))).toEqual({ text: "Going quiet · 20 days", tone: "quiet" });
  });

  it("has a quiet pill for a closed thread and none for no mail", () => {
    expect(turnPill({ kind: "closed", days: 40, ...latest })).toEqual({ text: "No open thread", tone: "closed" });
    expect(turnPill({ kind: "none" })).toBeNull();
  });
});

describe("standingPill", () => {
  it("says what you said, not what the app worked out", () => {
    expect(standingPill({ kind: "never_chase" })).toEqual({ text: "Just a contact", tone: "said" });
    expect(standingPill({ kind: "planned", dueOn: "2026-03-03" })).toEqual({
      text: "Planned for 3 March",
      tone: "planned",
    });
    expect(standingPill({ kind: "settled", at: new Date("2026-09-18T08:00:00Z") })).toEqual({
      text: "Nothing owed",
      tone: "said",
    });
  });

  it("falls back to the plain fact when you have said nothing", () => {
    expect(standingPill({ kind: "open", turn: yours(6) })).toEqual({
      text: "Your turn · 6 days",
      tone: "yours",
    });
    expect(standingPill({ kind: "open", turn: { kind: "none" } })).toBeNull();
  });
});

describe("replySpeedText", () => {
  it("uses the same steps as warmth's reply speed points", () => {
    expect(replySpeedText(5 * HOUR)).toBe("within a day");
    expect(replySpeedText(DAY)).toBe("within a day");
    expect(replySpeedText(2 * DAY)).toBe("within 3 days");
    expect(replySpeedText(7 * DAY)).toBe("within a week");
    expect(replySpeedText(12.4 * DAY)).toBe("after 12 days");
  });
});

describe("last contact", () => {
  it("counts days", () => {
    expect(lastContactText(0)).toBe("today");
    expect(lastContactText(1)).toBe("yesterday");
    expect(lastContactText(6)).toBe("6 days ago");
  });

  it("says who wrote, and that you haven't answered when it's your turn", () => {
    expect(lastContactCaption("them", yours(6))).toBe("they wrote, you didn't");
    expect(lastContactCaption("you", theirs(3))).toBe("you wrote, they haven't yet");
    expect(lastContactCaption("them", { kind: "closed", days: 40, ...latest })).toBe("they wrote last");
    expect(lastContactCaption("you", { kind: "closed", days: 40, ...latest })).toBe("you wrote last");
  });
});

describe("replyRateCaption", () => {
  it("reads like the design", () => {
    expect(replyRateCaption(3, 4)).toBe("they answered 3 of your last 4");
    expect(replyRateCaption(1, 1)).toBe("they answered your one message");
    expect(replyRateCaption(0, 1)).toBe("they haven't answered your one message");
    expect(replyRateCaption(0, 0)).toBe("you haven't written to them");
  });
});

describe("next touch dates", () => {
  it("makes the calendar badge from the date itself, with no time zone involved", () => {
    expect(dateBadge("2026-09-20")).toEqual({ day: "20", month: "Sep" });
    expect(dateBadge("2027-01-01")).toEqual({ day: "1", month: "Jan" });
  });

  it("says how far off it is", () => {
    expect(dueText("2026-09-16", "2026-09-16")).toEqual({ text: "today", overdue: false });
    expect(dueText("2026-09-17", "2026-09-16")).toEqual({ text: "tomorrow", overdue: false });
    expect(dueText("2026-09-20", "2026-09-16")).toEqual({ text: "in 4 days", overdue: false });
    expect(dueText("2026-09-15", "2026-09-16")).toEqual({ text: "1 day overdue", overdue: true });
    expect(dueText("2026-09-01", "2026-09-16")).toEqual({ text: "15 days overdue", overdue: true });
  });
});
