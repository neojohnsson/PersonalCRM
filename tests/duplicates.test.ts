import { describe, expect, it } from "vitest";
import {
  addressNameKey,
  findDuplicates,
  nameKey,
  pairKey,
  phoneKey,
  type DuplicateContact,
} from "@/lib/contacts/duplicates";

/** Finding contacts that are probably the same person. No AI, no network. */

const contact = (id: string, fields: Partial<DuplicateContact> = {}): DuplicateContact => ({
  id,
  first_name: null,
  last_name: null,
  company: null,
  phone: null,
  emails: [],
  ...fields,
});

describe("the keys", () => {
  it("reads a phone number by its digits, ignoring how it's written", () => {
    expect(phoneKey("+46 70 123 45 67")).toBe(phoneKey("070-123 45 67"));
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("uses a full name only — a first name is not evidence", () => {
    expect(nameKey(contact("c", { first_name: "Carl-Johan", last_name: "Hultenheim" }))).toBe("carljohanhultenheim");
    expect(nameKey(contact("c", { first_name: "Åsa", last_name: "Öberg" }))).toBe(nameKey(contact("d", { first_name: "asa", last_name: "oberg" })));
    expect(nameKey(contact("c", { first_name: "Pontus" }))).toBeNull();
    expect(nameKey(contact("c"))).toBeNull();
  });

  it("reads a name out of an address only when it has two parts", () => {
    expect(addressNameKey("carl-johan.hultenheim@atea.se")).toBe("carljohanhultenheim");
    expect(addressNameKey("carl-johan.hultenheim@atea.com")).toBe("carljohanhultenheim");
    expect(addressNameKey("oskar@stilta.com")).toBeNull();
    expect(addressNameKey("info@atea.se")).toBeNull();
  });

  it("names a pair the same way round either way", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});

describe("findDuplicates", () => {
  const carlNamed = contact("carl-com", {
    first_name: "Carl-Johan",
    last_name: "Hultenheim",
    emails: ["carl-johan.hultenheim@atea.com"],
  });
  const carlUnnamed = contact("carl-se", { emails: ["carl-johan.hultenheim@atea.se"] });
  const pontus = contact("pontus", { first_name: "Pontus", last_name: "Berglund", emails: ["pontus.berglund@atea.se"] });

  const thread = {
    threadId: "t1",
    addresses: ["me@example.se", "carl-johan.hultenheim@atea.se", "carl-johan.hultenheim@atea.com", "pontus.berglund@atea.se"],
  };

  it("finds the real case: two addresses of one person, in one thread", () => {
    const found = findDuplicates([carlNamed, carlUnnamed, pontus], [thread]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      reason: "same_thread",
      because: "Their addresses are built from the same name, and both wrote in the same email thread.",
    });
    expect([found[0].a, found[0].b].sort()).toEqual(["carl-com", "carl-se"]);
  });

  it("finds the same pair by the name in both addresses, with no thread at all", () => {
    const found = findDuplicates([carlNamed, carlUnnamed, pontus], []);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toBe("name_in_addresses");
  });

  it("finds two contacts with the same full name, or the same phone", () => {
    const one = contact("one", { first_name: "Maja", last_name: "Öberg", phone: "+46 70 111 22 33" });
    const two = contact("two", { first_name: "maja", last_name: "oberg" });
    const three = contact("three", { first_name: "Erik", last_name: "Ek", phone: "070-111 22 33" });

    const found = findDuplicates([one, two, three], []);
    expect(found.find((pair) => pair.reason === "same_name")).toBeDefined();
    expect(found.find((pair) => pair.reason === "same_phone")).toBeDefined();
  });

  it("never pairs two people just because they are in the same thread", () => {
    // Pontus is in Carl-Johan's thread, and is somebody else.
    const found = findDuplicates([carlNamed, carlUnnamed, pontus], [thread]);
    expect(found.some((pair) => [pair.a, pair.b].includes("pontus"))).toBe(false);
  });

  it("never suggests a pair on a first name, a company, or a look-alike address", () => {
    const oskarOne = contact("o1", { first_name: "Oskar", company: "Atea", emails: ["oskar.sunesson@softhouse.se"] });
    const oskarTwo = contact("o2", { first_name: "Oskar", company: "Atea", emails: ["oskar@stilta.com"] });
    expect(findDuplicates([oskarOne, oskarTwo], [])).toEqual([]);
  });

  it("keeps quiet about a pair you said isn't the same person", () => {
    const dismissed = new Set([pairKey("carl-com", "carl-se")]);
    expect(findDuplicates([carlNamed, carlUnnamed], [thread], dismissed)).toEqual([]);
  });

  it("suggests each pair once, with its most convincing reason first", () => {
    const found = findDuplicates([carlNamed, carlUnnamed], [thread]);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toBe("same_thread");
  });
});
