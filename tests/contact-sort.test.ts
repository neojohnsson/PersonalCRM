import { describe, expect, it } from "vitest";
import { compareOn, parseSort, sortLabel, type SortRow } from "@/lib/contacts/sort";

/**
 * Slice 9b, Part 6: five column headings that looked sortable and were not,
 * beside a white pill that looked like a dropdown and was a label.
 */

const row = (over: Partial<SortRow> = {}): SortRow => ({
  name: "Karin Lindqvist",
  company: "Combitech",
  warmth: 70,
  lastAt: "2026-09-10T08:00:00Z",
  ...over,
});

const order = (key: Parameters<typeof compareOn>[0], rows: SortRow[]) =>
  [...rows].sort((a, b) => compareOn(key, a, b)).map((r) => r.name);

describe("which order the list is in", () => {
  it("defaults to whose turn, whatever the address says", () => {
    // "That default is the product" (design/canvas.json).
    expect(parseSort(undefined)).toBe("turn");
    expect(parseSort("nonsense")).toBe("turn");
    expect(parseSort(["name"])).toBe("turn");
    expect(parseSort("name")).toBe("name");
  });

  it("says what it is in words, for the label beside the search box", () => {
    expect(sortLabel("turn")).toBe("Whose turn");
    expect(sortLabel("warmth")).toBe("Warmest first");
  });
});

describe("sorting by a column", () => {
  it("puts names in Swedish order, where å ä ö come after z", () => {
    expect(
      order("name", [row({ name: "Öberg" }), row({ name: "Zetterberg" }), row({ name: "Andersson" })]),
    ).toEqual(["Andersson", "Zetterberg", "Öberg"]);
  });

  it("sorts a bare address in with the names, because that is what the row shows", () => {
    // Eleven of twenty-five contacts show as an address; hiding them at the
    // bottom of an A–Z would be its own kind of wrong.
    expect(
      order("name", [row({ name: "Carl-Johan Hultenheim" }), row({ name: "bjorn.andersson@nordlo.com" })]),
    ).toEqual(["bjorn.andersson@nordlo.com", "Carl-Johan Hultenheim"]);
  });

  it("puts the warmest first and the ones with no mail last", () => {
    expect(
      order("warmth", [
        row({ name: "cold", warmth: 20 }),
        row({ name: "none", warmth: null }),
        row({ name: "warm", warmth: 85 }),
      ]),
    ).toEqual(["warm", "cold", "none"]);
  });

  it("puts the most recent first and never-spoken last", () => {
    expect(
      order("last", [
        row({ name: "old", lastAt: "2026-06-01T08:00:00Z" }),
        row({ name: "never", lastAt: null }),
        row({ name: "today", lastAt: "2026-09-22T08:00:00Z" }),
      ]),
    ).toEqual(["today", "old", "never"]);
  });

  it("puts a missing company last, not first", () => {
    // Unknown is not "before A": it belongs at the bottom either way.
    expect(
      order("company", [
        row({ name: "none", company: null }),
        row({ name: "blank", company: "   " }),
        row({ name: "atea", company: "Atea" }),
      ]),
    ).toEqual(["atea", "none", "blank"]);
  });

  it("calls two equal rows equal, so the page's own order breaks the tie", () => {
    expect(compareOn("warmth", row({ warmth: 70 }), row({ warmth: 70 }))).toBe(0);
    expect(compareOn("company", row({ company: null }), row({ company: null }))).toBe(0);
    expect(compareOn("last", row({ lastAt: null }), row({ lastAt: null }))).toBe(0);
  });
});
