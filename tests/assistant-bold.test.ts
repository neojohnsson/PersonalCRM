import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boldParts } from "@/lib/assistant/bold";

/**
 * The Assistant's **bold** (2026-09-26): the chat showed the asterisks.
 */

describe("bold in the Assistant's answers", () => {
  it("draws a pair as bold, and leaves the rest as it was written", () => {
    expect(boldParts("Mail **Karin** by **Friday**.")).toEqual([
      { text: "Mail ", bold: false },
      { text: "Karin", bold: true },
      { text: " by ", bold: false },
      { text: "Friday", bold: true },
      { text: ".", bold: false },
    ]);
    expect(boldParts("No formatting at all.")).toEqual([{ text: "No formatting at all.", bold: false }]);
    expect(boldParts("")).toEqual([]);
  });

  it("guesses at nothing: a lone pair, an empty one, or one across lines stays as written", () => {
    // A pair still arriving while the answer streams in looks like this.
    expect(boldParts("Mail **Kar")).toEqual([{ text: "Mail **Kar", bold: false }]);
    expect(boldParts("a **** b")).toEqual([{ text: "a **** b", bold: false }]);
    expect(boldParts("**one\ntwo**")).toEqual([{ text: "**one\ntwo**", bold: false }]);
  });

  it("is text, never markup, whatever the model writes", () => {
    expect(boldParts("**<img src=x onerror=alert(1)>**")).toEqual([
      { text: "<img src=x onerror=alert(1)>", bold: true },
    ]);
    // The chat draws each piece as a text node, and has no HTML escape hatch.
    const chat = readFileSync("app/assistant/chat.tsx", "utf8");
    expect(chat).toContain("boldParts(entry.text)");
    expect(chat).not.toContain("dangerouslySetInnerHTML");
  });
});
