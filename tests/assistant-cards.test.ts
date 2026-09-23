import { describe, expect, it } from "vitest";
import { thingsToDecide, type DecideCounts } from "@/lib/assistant/cards";

/** Slice 11: the "Things to decide" card, from counts the app already has. */

const nothing: DecideCounts = {
  duplicates: 0,
  summaries: { count: 0, firstContactId: null },
  promises: 0,
  names: { count: 0, firstContactId: null, firstShownAs: null },
};

describe("things to decide", () => {
  it("shows nothing when every queue is empty", () => {
    // A row saying "0 promises" asks you to press something with nothing behind it.
    expect(thingsToDecide(nothing)).toEqual([]);
  });

  it("lists every queue with something in it, in the design's order", () => {
    const rows = thingsToDecide({
      duplicates: 1,
      summaries: { count: 3, firstContactId: "c1" },
      promises: 5,
      names: { count: 6, firstContactId: "c2", firstShownAs: "bjorn.andersson@nordlo.com" },
    });

    expect(rows.map((row) => row.key)).toEqual(["duplicates", "summaries", "promises", "names"]);
    expect(rows.map((row) => row.title)).toEqual([
      "Two contacts may be the same person",
      "3 summaries waiting for you",
      "5 promises found, none decided",
      "6 contacts could have a better name",
    ]);
  });

  it("takes you to the thing itself", () => {
    const rows = thingsToDecide({
      ...nothing,
      summaries: { count: 1, firstContactId: "karin" },
      names: { count: 1, firstContactId: "bjorn", firstShownAs: "bjorn.andersson@nordlo.com" },
    });

    expect(rows.find((row) => row.key === "summaries")?.href).toBe("/contacts/karin");
    expect(rows.find((row) => row.key === "names")).toMatchObject({
      href: "/contacts/bjorn",
      detail: "Starting with bjorn.andersson@nordlo.com. Nothing is renamed without you.",
    });
  });

  it("never offers to merge, only to compare", () => {
    // A wrong merge is nearly impossible to undo (plan.md §3.7).
    const [row] = thingsToDecide({ ...nothing, duplicates: 2 });
    expect(row.action).toBe("Compare");
    expect(row.detail).toBe("Only you can merge them.");
    expect(row.href).toBe("/contacts/duplicates");
  });

  it("leaves out a count it has nowhere to send you", () => {
    // Three summaries but no contact to open is a button to nowhere.
    expect(thingsToDecide({ ...nothing, summaries: { count: 3, firstContactId: null } })).toEqual([]);
    expect(
      thingsToDecide({ ...nothing, names: { count: 2, firstContactId: null, firstShownAs: null } }),
    ).toEqual([]);
  });
});
