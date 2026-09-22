import { describe, expect, it } from "vitest";
import { sourceNumbers } from "@/lib/ai/source-numbers";
import type { SavedSummary } from "@/lib/ai/summary-parts";

/**
 * Slice 9b, Part 4: "email 1" is one message everywhere on a contact's page.
 * Each part numbered its own list from one, so the numbers named different
 * messages in different places — the one thing a citation must not do.
 */

const email = (id: string) => ({ messageId: id, threadId: "t1" });

describe("numbering a summary's sources", () => {
  it("numbers by where the page first cites them, across every part", () => {
    const sources: SavedSummary["sources"] = {
      who_they_are: [email("m10"), email("m20")],
      how_you_know: [email("m30")],
      discussed: [email("m20")],
      next_step: [email("m40")],
    };

    const numbers = sourceNumbers(sources);

    expect([...numbers]).toEqual([
      ["m10", 1],
      ["m20", 2],
      ["m30", 3],
      ["m40", 4],
    ]);
  });

  it("gives one message one number, however often it is cited", () => {
    const numbers = sourceNumbers({
      who_they_are: [email("m1")],
      how_you_know: [email("m1")],
      discussed: [email("m1"), email("m2")],
    });

    expect(numbers.get("m1")).toBe(1);
    expect(numbers.get("m2")).toBe(2);
    expect(numbers.size).toBe(2);
  });

  it("carries on into the suggestions, which cite mail too", () => {
    const numbers = sourceNumbers({
      who_they_are: [email("m1")],
      company: [email("m2")],
      next_touch: [email("m1"), email("m3")],
    });

    expect([...numbers]).toEqual([
      ["m1", 1],
      ["m2", 2],
      ["m3", 3],
    ]);
  });

  it("does not number the contact's own address, which is not a message", () => {
    const numbers = sourceNumbers({
      who_they_are: [{ address: "karin@combitech.se" }, email("m1")],
      company: [{ address: "karin@combitech.se" }],
    });

    // The address is named on the page ("their address karin@…"), not numbered.
    expect([...numbers]).toEqual([["m1", 1]]);
  });

  it("is empty for a summary that cites nothing", () => {
    expect(sourceNumbers({}).size).toBe(0);
  });

  it("reads the parts in the order the page shows them", () => {
    // next_step is written first here, and still numbered last: the order is
    // the page's, not the object's.
    const numbers = sourceNumbers({
      next_step: [email("last")],
      who_they_are: [email("first")],
    });

    expect(numbers.get("first")).toBe(1);
    expect(numbers.get("last")).toBe(2);
  });
});
