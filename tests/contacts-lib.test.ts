import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/contacts/display";
import { MAX_QUERY_LENGTH, ilikePattern, normaliseQuery, searchHref } from "@/lib/contacts/search";

describe("normaliseQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseQuery("  karin   lindqvist ")).toBe("karin lindqvist");
  });

  it("uses the first value when ?q= is repeated, and nothing when it's missing", () => {
    expect(normaliseQuery(["karin", "nils"])).toBe("karin");
    expect(normaliseQuery(undefined)).toBe("");
    expect(normaliseQuery([])).toBe("");
  });

  it("cuts very long input instead of rejecting it", () => {
    expect(normaliseQuery("a".repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("ilikePattern", () => {
  it("finds the text anywhere, lowercased", () => {
    expect(ilikePattern("Karin")).toBe("%karin%");
  });

  it("escapes %, _ and backslash so they match themselves", () => {
    expect(ilikePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("displayName", () => {
  const none = { first_name: null, last_name: null, primary_email: null };

  it("joins first and last name", () => {
    expect(displayName({ ...none, first_name: "Karin", last_name: "Lindqvist" })).toBe("Karin Lindqvist");
  });

  it("uses whichever part exists", () => {
    expect(displayName({ ...none, first_name: "Kim" })).toBe("Kim");
    expect(displayName({ ...none, last_name: "Ek" })).toBe("Ek");
  });

  it("falls back to the address, then to a plain label", () => {
    expect(displayName({ ...none, first_name: "  ", primary_email: "karin@fortnox.se" })).toBe(
      "karin@fortnox.se",
    );
    expect(displayName(none)).toBe("Unnamed contact");
  });
});

describe("searchHref", () => {
  it("puts the cleaned-up text in ?q=", () => {
    expect(searchHref("", "  karin  l ")).toBe("/contacts?q=karin+l");
  });

  it("keeps the chosen chip and tag, and starts again at the first page", () => {
    expect(searchHref("?filter=yours&tag=vc&show=100", "karin")).toBe("/contacts?filter=yours&tag=vc&q=karin");
    expect(searchHref("?q=old&filter=yours", "new")).toBe("/contacts?q=new&filter=yours");
  });

  it("drops ?q= when the box is emptied", () => {
    expect(searchHref("?q=karin", "   ")).toBe("/contacts");
    expect(searchHref("?q=karin&tag=vc", "")).toBe("/contacts?tag=vc");
  });
});
