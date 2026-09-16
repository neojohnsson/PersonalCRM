import { describe, expect, it } from "vitest";
import {
  LIMITS,
  MAX_EMAILS,
  MAX_TAGS,
  emptyContactValues,
  isUuid,
  parseContactForm,
  valuesFromContact,
} from "@/lib/contacts/contact-form";

function form(fields: Record<string, string>, emails: string[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  for (const email of emails) data.append("emails", email);
  return data;
}

describe("parseContactForm", () => {
  it("keeps text as typed, trimming only the ends, and turns empty fields into null", () => {
    const result = parseContactForm(
      form({ first_name: "  Kaja ", last_name: "af Klint", company: "", notes: "Line one\nLine two  " }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact).toMatchObject({
      first_name: "Kaja",
      last_name: "af Klint",
      company: null,
      role: null,
      notes: "Line one\nLine two",
    });
  });

  it("lowercases addresses, keeps their order (the first is primary) and skips empty rows", () => {
    const result = parseContactForm(
      form({ first_name: "Karin" }, [" Karin@Fortnox.se ", "", "karin.l@gmail.com"]),
    );

    expect(result.ok && result.contact.emails).toEqual(["karin@fortnox.se", "karin.l@gmail.com"]);
  });

  it("needs a name or an address", () => {
    const result = parseContactForm(form({ company: "Fortnox" }, [""]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.form).toBe("Give the contact a name or an email address.");
  });

  it("accepts a contact with only an address", () => {
    expect(parseContactForm(form({}, ["karin@fortnox.se"])).ok).toBe(true);
  });

  it("refuses something that isn't an address, and says which", () => {
    const result = parseContactForm(form({ first_name: "Karin" }, ["karin at fortnox"]));

    expect(!result.ok && result.errors.emails).toBe("“karin at fortnox” isn't an email address.");
  });

  it("refuses the same address twice, whatever its case", () => {
    const result = parseContactForm(form({ first_name: "Karin" }, ["karin@fortnox.se", "KARIN@fortnox.se"]));

    expect(!result.ok && result.errors.emails).toBe("karin@fortnox.se is listed twice.");
  });

  it("limits the number of addresses", () => {
    const many = Array.from({ length: MAX_EMAILS + 1 }, (_, i) => `k${i}@fortnox.se`);
    expect(!parseContactForm(form({ first_name: "Karin" }, many)).ok).toBe(true);
  });

  it("splits tags on commas, keeps their spelling, and lists each once", () => {
    const result = parseContactForm(form({ first_name: "Karin", tags: "växjö, Thesis ,, thesis, LNU" }));

    expect(result.ok && result.contact.tags).toEqual(["växjö", "Thesis", "LNU"]);
  });

  it("limits tags in length and number", () => {
    expect(
      !parseContactForm(form({ first_name: "K", tags: "x".repeat(41) })).ok,
    ).toBe(true);

    const tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `tag${i}`).join(",");
    const result = parseContactForm(form({ first_name: "K", tags }));
    expect(!result.ok && result.errors.tags).toBe(`Use at most ${MAX_TAGS} tags.`);
  });

  it("accepts phone numbers as people write them, and refuses anything else", () => {
    for (const phone of ["+46 70 123 45 67", "070-123 45 67", "(0470) 123456"]) {
      expect(parseContactForm(form({ first_name: "K", phone })).ok, phone).toBe(true);
    }
    for (const phone of ["call me", "12", "+46 70 abc"]) {
      const result = parseContactForm(form({ first_name: "K", phone }));
      expect(!result.ok && result.errors.phone, phone).toBe("Use digits, spaces and + ( ) - only.");
    }
  });

  it("limits every text field", () => {
    const result = parseContactForm(form({ first_name: "K", notes: "x".repeat(LIMITS.notes + 1) }));
    expect(!result.ok && result.errors.notes).toBe("Keep it under 10,000 characters.");
  });

  it("hands back what was typed when something is wrong, so nothing is lost", () => {
    const result = parseContactForm(
      form({ first_name: " Karin ", tags: "växjö, thesis" }, ["karin at fortnox", "k@fortnox.se"]),
    );

    expect(result.ok).toBe(false);
    expect(result.values).toMatchObject({
      first_name: " Karin ",
      tags: "växjö, thesis",
      emails: ["karin at fortnox", "k@fortnox.se"],
    });
  });
});

describe("valuesFromContact", () => {
  it("fills the edit form from a saved contact", () => {
    const values = valuesFromContact(
      {
        first_name: "Karin",
        last_name: null,
        company: "Fortnox",
        role: null,
        one_liner: null,
        how_known: null,
        phone: null,
        notes: null,
        tags: ["växjö", "thesis"],
      },
      ["karin@fortnox.se"],
    );

    expect(values).toEqual({
      ...emptyContactValues(),
      first_name: "Karin",
      company: "Fortnox",
      tags: "växjö, thesis",
      emails: ["karin@fortnox.se"],
    });
  });
});

describe("isUuid", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(isUuid("3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("new")).toBe(false);
    expect(isUuid("3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6")).toBe(false);
  });
});
