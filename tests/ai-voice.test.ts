import { describe, expect, it } from "vitest";
import { COMMON_AI_PHRASES, hasEmDash, tidyDraft } from "@/lib/ai/tidy";
import { pickVoiceCandidates, voiceSectionText, type SentRow } from "@/lib/ai/voice";

/** Sounding like you: which of your emails are shown, and the tidy pass. */

const row = (id: string, thread: string, date: string): SentRow => ({
  gmail_message_id: id,
  thread_id: thread,
  internal_date: date,
});

describe("pickVoiceCandidates", () => {
  const rows = [
    row("a", "t1", "2026-09-01T09:00:00Z"),
    row("b", "t2", "2026-09-05T09:00:00Z"),
    row("c", "t1", "2026-09-06T09:00:00Z"),
    row("d", "t3", "2026-09-03T09:00:00Z"),
  ];

  it("takes the newest, one per thread", () => {
    expect(pickVoiceCandidates(rows).map((r) => r.gmail_message_id)).toEqual(["c", "b", "d"]);
  });

  it("never uses the thread being answered", () => {
    expect(pickVoiceCandidates(rows, { excludeThreadId: "t1" }).map((r) => r.gmail_message_id)).toEqual(["b", "d"]);
  });

  it("stops at the limit", () => {
    expect(pickVoiceCandidates(rows, { limit: 2 })).toHaveLength(2);
    expect(pickVoiceCandidates([])).toEqual([]);
  });
});

describe("voiceSectionText", () => {
  it("presents the examples as voice only, never as content", () => {
    const text = voiceSectionText(["Hej Karin, tack för svaret.", "Hej Johan, jag hör av mig i oktober."])!;
    expect(text).toMatch(/for voice only/i);
    expect(text).toMatch(/never copy their content/i);
    expect(text).toContain("Example 1:\nHej Karin, tack för svaret.");
    expect(text).toContain("Example 2:");
  });

  it("is nothing when there are no examples", () => {
    expect(voiceSectionText([])).toBeNull();
  });
});

describe("tidyDraft", () => {
  it("turns an em dash into ordinary punctuation", () => {
    expect(tidyDraft("Tack — det passar bra")).toBe("Tack, det passar bra");
    expect(tidyDraft("Tack—det passar bra")).toBe("Tack, det passar bra");
    expect(tidyDraft("Det går bra —")).toBe("Det går bra.");
  });

  it("leaves a Swedish en dash alone — it's ordinary punctuation", () => {
    expect(tidyDraft("Jag kan måndag–fredag, 10–15 minuter")).toBe("Jag kan måndag–fredag, 10–15 minuter");
  });

  it("doesn't leave double commas or space before punctuation", () => {
    expect(tidyDraft("Ja, — och sen då?")).toBe("Ja, och sen då?");
    expect(hasEmDash(tidyDraft("Ja — nej"))).toBe(false);
  });

  it("keeps ordinary text exactly as it is", () => {
    const text = "Hej Karin,\n\nTack för svaret! Jag hör av mig i oktober.\n\nVänliga hälsningar\nNeo";
    expect(tidyDraft(text)).toBe(text);
  });
});

describe("COMMON_AI_PHRASES", () => {
  it("holds the tells the Profile page offers, in both languages", () => {
    expect(COMMON_AI_PHRASES).toContain("I hope this email finds you well");
    expect(COMMON_AI_PHRASES).toContain("Just circling back");
    expect(COMMON_AI_PHRASES.some((phrase) => phrase.includes("Tveka inte"))).toBe(true);
  });
});
