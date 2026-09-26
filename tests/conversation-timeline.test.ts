import { describe, expect, it } from "vitest";
import {
  CONVERSATION_ROWS,
  conversation,
  firstLine,
  type StoredMessage,
} from "@/lib/relationship/conversation";
import type { GmailThread } from "@/lib/google/gmail";

/**
 * Slice 9b, Part 4: the contact page shows the conversation. The rows come
 * from what is stored; the first lines come from Gmail and are never stored.
 */

const stored = (
  id: string,
  date: string,
  direction: "inbound" | "outbound",
  extra: Partial<StoredMessage> = {},
): StoredMessage => ({
  gmail_message_id: id,
  internal_date: date,
  direction,
  subject: "Praktik och examensarbete",
  from_name: direction === "inbound" ? "Karin Lindqvist" : "Neo Johnsson",
  from_email: direction === "inbound" ? "karin@combitech.se" : "johnsson.neo@gmail.com",
  ...extra,
});

const thread = (messages: { id: string; snippet?: string }[]): GmailThread => ({
  id: "t1",
  messages: messages.map((message) => ({
    id: message.id,
    threadId: "t1",
    internalDate: "0",
    snippet: message.snippet,
  })),
});

describe("the conversation", () => {
  it("is newest first, says who wrote each one, and which way it went", () => {
    const rows = conversation(
      [
        stored("m1", "2026-09-10T08:00:00Z", "inbound"),
        stored("m3", "2026-09-12T11:00:00Z", "inbound"),
        stored("m2", "2026-09-11T09:30:00Z", "outbound"),
      ],
      thread([
        { id: "m1", snippet: "Hej Neo, tack för att du hörde av dig!" },
        { id: "m2", snippet: "Tack Karin — jag börjar i januari." },
        { id: "m3", snippet: "Perfekt, jag kollar med min chef." },
      ]),
    );

    expect(rows.map((row) => row.id)).toEqual(["m3", "m2", "m1"]);
    expect(rows[0]).toMatchObject({
      fromThem: true,
      who: "Karin Lindqvist",
      subject: "Praktik och examensarbete",
      line: "Perfekt, jag kollar med min chef.",
    });
    expect(rows[1]).toMatchObject({ fromThem: false, who: "You" });
  });

  it("stands up when Gmail says nothing at all", () => {
    // An expired token, Gmail down, or the read never made: every row is still
    // here, with everything but the line.
    const rows = conversation([stored("m1", "2026-09-10T08:00:00Z", "inbound")], null);

    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBeNull();
    expect(rows[0].who).toBe("Karin Lindqvist");
  });

  it("leaves a row without a snippet alone, and ignores a snippet with no row", () => {
    const rows = conversation(
      [stored("m1", "2026-09-10T08:00:00Z", "inbound"), stored("m2", "2026-09-11T08:00:00Z", "outbound")],
      thread([{ id: "m2", snippet: "Bara den här." }, { id: "ghost", snippet: "Not in the database." }]),
    );

    expect(rows.map((row) => row.line)).toEqual(["Bara den här.", null]);
  });

  it("falls back to the address when the From header carried no name", () => {
    const rows = conversation(
      [stored("m1", "2026-09-10T08:00:00Z", "inbound", { from_name: "  " })],
      null,
    );
    expect(rows[0].who).toBe("karin@combitech.se");
  });

  it("shows at most eight, and the newest eight", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      stored(`m${i}`, `2026-09-${String(i + 1).padStart(2, "0")}T08:00:00Z`, "inbound"),
    );
    const rows = conversation(many, null);

    expect(rows).toHaveLength(CONVERSATION_ROWS);
    expect(rows[0].id).toBe("m13");
  });
});

describe("the first line", () => {
  it("un-escapes what Gmail escaped, and never renders any of it as markup", () => {
    expect(firstLine("Tack &amp; hej &lt;b&gt;inte fet&lt;/b&gt;")).toBe("Tack & hej <b>inte fet</b>");
    expect(firstLine("R&#39;n&#39;R &quot;ja&quot;&nbsp;tack")).toBe(`R'n'R "ja" tack`);
  });

  it("stops where the quoted reply starts, in Swedish and in English", () => {
    expect(firstLine("Ja, det funkar! Den 11 sep. 2026 kl. 09:30 skrev Neo Johnsson: Hej Karin...")).toBe(
      "Ja, det funkar!",
    );
    expect(firstLine("Sounds good. On 11 Sep 2026 at 09:30 Neo Johnsson wrote: Hi Karin, thanks")).toBe(
      "Sounds good.",
    );
  });

  it("drops a forwarded header", () => {
    expect(firstLine("Se nedan. ---------- Vidarebefordrat meddelande --------- Från: någon")).toBe("Se nedan.");
  });

  it("stops at an Outlook-style quoted header, and drops the sign-off before it", () => {
    // UI quality pass, milestone 6: a preview read "... M vh /Niklas Från: Neo
    // Johnsson <johnsson.neo@gma…" -- the quoted mail's header and the sign-off.
    expect(
      firstLine("Hej Neo, jag kollar med chefen och återkommer. M vh /Niklas Från: Neo Johnsson <johnsson.neo@gmail.com> Skickat: den 10 sep"),
    ).toBe("Hej Neo, jag kollar med chefen och återkommer.");
    expect(firstLine("Thanks, see you Tuesday. Best regards, Karin From: Neo <neo@example.se> Sent: 10 September")).toBe(
      "Thanks, see you Tuesday.",
    );
    expect(firstLine("Låter bra! -----Ursprungligt meddelande----- Från: Neo")).toBe("Låter bra!");
    expect(firstLine("Great. -----Original Message----- From: Neo")).toBe("Great.");
  });

  it("keeps a sign-off word that is part of the message", () => {
    // Only a sign-off at the very end goes; "hälsningar" mid-sentence stays.
    expect(firstLine("Hälsningar från Växjö! Vi ses på mässan.")).toBe("Hälsningar från Växjö! Vi ses på mässan.");
    expect(firstLine("Thanks for the intro to Karin.")).toBe("Thanks for the intro to Karin.");
    // A sign-off starts its own sentence: the last word of one is not one.
    expect(firstLine("Thanks again, you're the best")).toBe("Thanks again, you're the best");
    expect(firstLine("Vi hörs. Best, Karin")).toBe("Vi hörs.");
  });

  it("puts everything on one line and cuts a long one", () => {
    expect(firstLine("Hej\n\n  Neo,   tack")).toBe("Hej Neo, tack");

    const long = firstLine("a".repeat(400));
    expect(long).toHaveLength(160);
    expect(long!.endsWith("…")).toBe(true);
  });

  it("is nothing at all when there is nothing to show", () => {
    expect(firstLine(undefined)).toBeNull();
    expect(firstLine("")).toBeNull();
    expect(firstLine("   ")).toBeNull();
    // A snippet that is only a quoted reply says nothing about this message.
    expect(firstLine("On 11 Sep 2026 at 09:30 Neo wrote: Hi")).toBeNull();
  });
});
