import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_CHARS, htmlToText, messageText, ownWords, readableText, trimText } from "@/lib/google/body";
import type { GmailPart } from "@/lib/google/gmail";

/** Reading what someone wrote out of a full Gmail message. No network. */

const b64 = (text: string, encoding: BufferEncoding = "utf8") => Buffer.from(text, encoding).toString("base64url");

const part = (mimeType: string, text: string, extra: Partial<GmailPart> = {}): GmailPart => ({
  mimeType,
  body: { data: b64(text) },
  ...extra,
});

describe("readableText", () => {
  it("prefers the plain text part of a multipart message", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "Hej Neo!"), part("text/html", "<p>Hej <b>Neo</b>!</p>")],
    };
    expect(readableText(payload)).toBe("Hej Neo!");
  });

  it("finds it inside nested multiparts, skipping attachments", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      parts: [
        part("text/plain", "cv.txt contents", { filename: "cv.txt" }),
        { mimeType: "multipart/alternative", parts: [part("text/plain", "See my CV attached.")] },
      ],
    };
    expect(readableText(payload)).toBe("See my CV attached.");
  });

  it("falls back to the HTML part as text", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      parts: [part("text/html", "<div>Hej,</div><div>vi ses p&aring; fredag &amp; sen</div>")],
    };
    expect(readableText(payload)).toBe("Hej,\nvi ses på fredag & sen\n");
  });

  it("keeps å ä ö in UTF-8 and in older Swedish charsets", () => {
    expect(readableText(part("text/plain", "Hälsningar, Åsa Öberg"))).toBe("Hälsningar, Åsa Öberg");

    const latin1: GmailPart = {
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: b64("Hälsningar, Åsa", "latin1") },
    };
    expect(readableText(latin1)).toBe("Hälsningar, Åsa");
  });

  it("gives an empty string for a message with no text at all", () => {
    expect(readableText(undefined)).toBe("");
    expect(readableText({ mimeType: "image/png", body: { attachmentId: "x" } })).toBe("");
  });
});

describe("htmlToText", () => {
  it("drops styles and quoted blockquotes", () => {
    expect(htmlToText("<style>p{}</style><p>Ja!</p><blockquote>old message</blockquote>")).toBe("Ja!\n");
  });
});

describe("ownWords", () => {
  it("cuts Gmail's quoted reply, in English and Swedish", () => {
    expect(ownWords("Sounds good.\n\nOn Thu, 11 Sep 2026 at 09:14, Karin <k@fortnox.se> wrote:\n> Can we meet?")).toBe(
      "Sounds good.",
    );
    expect(
      ownWords("Låter bra!\n\nDen tors 11 sep. 2026 kl 09:14 skrev Karin Lindqvist <k@fortnox.se>:\n> Ses vi?"),
    ).toBe("Låter bra!");
  });

  it("cuts a Gmail reply header that wrapped onto two lines", () => {
    expect(ownWords("Thanks!\n\nOn Thu, 11 Sep 2026 at 09:14, Karin Lindqvist <karin.lindqvist@\nfortnox.se> wrote:\n> Hi")).toBe(
      "Thanks!",
    );
  });

  it("cuts Outlook's quoted header, but not a sentence that starts with From:", () => {
    expect(ownWords("Ok!\n________________________________\nFrån: Karin\nSkickat: den 11 september\nÄmne: Hej")).toBe("Ok!");
    expect(ownWords("Ok!\nFrom: Karin Lindqvist\nSent: Thursday\nSubject: Hi")).toBe("Ok!");
    expect(ownWords("From: the start, I liked the idea.\nMore text.")).toBe("From: the start, I liked the idea.\nMore text.");
  });

  it("keeps a Swedish sentence that just ends in a colon", () => {
    expect(ownWords("Jag skrev till henne:\nkan vi ses?")).toBe("Jag skrev till henne:\nkan vi ses?");
    expect(ownWords("Den dagen skrev hon till mig:\nkom förbi")).toBe("Den dagen skrev hon till mig:\nkom förbi");
  });

  it("cuts signatures and 'sent from my phone'", () => {
    expect(ownWords("See you then.\n-- \nKarin Lindqvist\nFortnox")).toBe("See you then.");
    expect(ownWords("Ja!\n\nSkickat från min iPhone")).toBe("Ja!");
  });

  it("drops quoted lines and tidies the whitespace", () => {
    expect(ownWords("> earlier\nMy answer:   yes.\r\n\r\n\r\n\r\nBye")).toBe("My answer: yes.\n\nBye");
  });
});

describe("trimText", () => {
  it("leaves short text alone and cuts long text at a word, saying so", () => {
    expect(trimText("short")).toBe("short");

    const long = "word ".repeat(1000);
    const trimmed = trimText(long);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 4);
    expect(trimmed.endsWith("word […]")).toBe(true);
  });
});

describe("messageText", () => {
  it("does all of it: finds, decodes, cuts quotes and signature, trims", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "Yes, October works.\n\n-- \nKarin\n\nOn Mon, 1 Sep 2026, Neo wrote:\n> When?")],
    };
    expect(messageText(payload)).toBe("Yes, October works.");
  });
});
