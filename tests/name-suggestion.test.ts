import { describe, expect, it } from "vitest";
import { suggestName } from "@/lib/contacts/name-suggestion";

/**
 * Slice 9b, Part 5: names shown as "Jönsson Linda" or as a bare address.
 * Every suggestion needs evidence in the address, and nothing here is ever
 * written without a press.
 */

const contact = (first: string | null, last: string | null, email: string | null) => ({
  first_name: first,
  last_name: last,
  primary_email: email,
});

describe("a name the wrong way round", () => {
  it("is suggested swapped when the address says which name is which", () => {
    // The real case: "Jönsson Linda" from a municipality mailbox.
    expect(suggestName(contact("Jönsson", "Linda", "linda.jonsson@vaxjo.se"))).toMatchObject({
      kind: "swap",
      first: "Linda",
      last: "Jönsson",
    });
  });

  it("reads through the accents an address drops", () => {
    expect(suggestName(contact("Öberg", "Maja", "maja.oberg@tietoevry.com"))).toMatchObject({
      first: "Maja",
      last: "Öberg",
    });
    expect(suggestName(contact("Ekström", "Pär", "par.ekstrom@fortnox.se"))).toMatchObject({
      first: "Pär",
      last: "Ekström",
    });
  });

  it("copes with an address written as one word", () => {
    expect(suggestName(contact("Hanel", "Helena", "helenahanel@softwerk.se"))).toMatchObject({
      first: "Helena",
      last: "Hanel",
    });
  });

  it("says nothing when the address agrees with the name as stored", () => {
    expect(suggestName(contact("Karin", "Lindqvist", "karin.lindqvist@combitech.se"))).toBeNull();
    expect(suggestName(contact("Karin", "Lindqvist", "karin@combitech.se"))).toBeNull();
  });

  it("says nothing without evidence, whatever the name looks like", () => {
    // No dictionary of given names: an app confident about strangers is wrong
    // about most Swedish names, and confidently.
    expect(suggestName(contact("Jönsson", "Linda", "omsorgsnamnden@vaxjo.se"))).toBeNull();
    expect(suggestName(contact("Hjelm", "Michael", "michael.hjelm@vaxjo.se"))).toMatchObject({ kind: "swap" });
  });

  it("leaves a middle name alone", () => {
    // "Anna Maria Ek" is stored as "Anna Maria" / "Ek"; swapping that is nonsense.
    expect(suggestName(contact("Anna Maria", "Ek", "ek.anna.maria@example.se"))).toBeNull();
  });

  it("says nothing when one of the two is missing", () => {
    expect(suggestName(contact("Linda", null, "linda.jonsson@vaxjo.se"))).toBeNull();
    expect(suggestName(contact(null, "Jönsson", "linda.jonsson@vaxjo.se"))).toBeNull();
  });
});

describe("a name guessed from the address", () => {
  it("is offered when nothing at all is stored", () => {
    expect(suggestName(contact(null, null, "bjorn.andersson@nordlo.com"))).toMatchObject({
      kind: "from_address",
      first: "Bjorn",
      last: "Andersson",
    });
    expect(suggestName(contact("  ", "", "sofia_hedlund@netlight.com"))).toMatchObject({
      first: "Sofia",
      last: "Hedlund",
    });
  });

  it("keeps the shape of a name that carries a hyphen or an apostrophe", () => {
    expect(suggestName(contact(null, null, "anna-lena.ek@example.se"))).toMatchObject({
      first: "Anna-Lena",
      last: "Ek",
    });
    expect(suggestName(contact(null, null, "o'brien.sean@example.ie"))).toMatchObject({
      first: "O'Brien",
      last: "Sean",
    });
  });

  it("says nothing for a desk, a robot or a department", () => {
    for (const address of [
      "info.kontakt@vaxjo.se",
      "no.reply@fortnox.se",
      "registrator.arkiv@vaxjo.se",
      "jobb.karriar@softwerk.se",
    ]) {
      expect(suggestName(contact(null, null, address)), address).toBeNull();
    }
  });

  it("says nothing when the address is not two words", () => {
    expect(suggestName(contact(null, null, "omsorgsnamnden@vaxjo.se"))).toBeNull();
    expect(suggestName(contact(null, null, "a.b.c@example.se"))).toBeNull();
    expect(suggestName(contact(null, null, "k.andersson@example.se"))).toBeNull();
    expect(suggestName(contact(null, null, "erik.svensson2@example.se"))).toBeNull();
  });

  it("says nothing without an address to read", () => {
    expect(suggestName(contact(null, null, null))).toBeNull();
    expect(suggestName(contact(null, null, "not-an-address"))).toBeNull();
    expect(suggestName(contact("Jönsson", "Linda", null))).toBeNull();
  });
});
