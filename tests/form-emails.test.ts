import { describe, expect, it } from "vitest";
import { MAX_FORM_EMAILS, emailsFromForm } from "@/lib/contacts/form-emails";

function form(entries: [string, string | Blob][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("emailsFromForm", () => {
  it("reads every ticked address", () => {
    expect(
      emailsFromForm(form([["email", "johan@example.se"], ["email", "sara@example.se"]])),
    ).toEqual(["johan@example.se", "sara@example.se"]);
  });

  it("acts on just one row when that row's own button was pressed", () => {
    expect(
      emailsFromForm(
        form([
          ["email", "johan@example.se"],
          ["email", "sara@example.se"],
          ["only", "mikael@example.se"],
        ]),
      ),
    ).toEqual(["mikael@example.se"]);
  });

  it("trims, lowercases and lists each address once", () => {
    expect(
      emailsFromForm(form([["email", "  Johan@Example.se "], ["email", "johan@example.se"]])),
    ).toEqual(["johan@example.se"]);
  });

  it("drops anything that isn't an address", () => {
    expect(
      emailsFromForm(
        form([
          ["email", ""],
          ["email", "not an address"],
          ["email", new Blob(["file"])],
          ["email", "sara@example.se"],
        ]),
      ),
    ).toEqual(["sara@example.se"]);
  });

  it("returns nothing for an empty form", () => {
    expect(emailsFromForm(new FormData())).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: 500 }, (_, i): [string, string] => ["email", `p${i}@example.se`]);
    expect(emailsFromForm(form(many))).toHaveLength(MAX_FORM_EMAILS);
  });
});
