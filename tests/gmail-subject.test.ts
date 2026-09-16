import { describe, expect, it } from "vitest";
import { parseSubject } from "@/lib/google/parse";

describe("parseSubject", () => {
  it("keeps a plain subject, including å ä ö", () => {
    expect(parseSubject("Re: Praktikplats hösten 2026")).toBe("Re: Praktikplats hösten 2026");
  });

  it("decodes an encoded subject", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("Fråga om examensarbete", "utf8").toString("base64")}?=`;
    expect(parseSubject(encoded)).toBe("Fråga om examensarbete");
  });

  it("decodes a subject split over several encoded words", () => {
    expect(parseSubject("=?ISO-8859-1?Q?Tack_f=F6r?= =?ISO-8859-1?Q?_visat_intresse?=")).toBe(
      "Tack för visat intresse",
    );
  });

  it("collapses the line breaks long subjects are folded with", () => {
    expect(parseSubject("Inbjudan till\r\n event i Växjö")).toBe("Inbjudan till event i Växjö");
  });

  it("returns null for a missing or empty subject", () => {
    expect(parseSubject(undefined)).toBeNull();
    expect(parseSubject("")).toBeNull();
    expect(parseSubject("   ")).toBeNull();
  });
});
