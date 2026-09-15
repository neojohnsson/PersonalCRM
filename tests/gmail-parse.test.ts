import { describe, expect, it } from "vitest";
import type { GmailMessage } from "@/lib/google/gmail";
import { decodeEncodedWords, parseAddressList, toMessageRow } from "@/lib/google/parse";

/** An RFC 2047 B-encoded word for `text`, the way a mail client writes one. */
function base64Word(text: string, charset = "UTF-8"): string {
  return `=?${charset}?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

describe("decodeEncodedWords", () => {
  it("decodes a UTF-8 B-encoded name", () => {
    expect(decodeEncodedWords(base64Word("Björn Ek"))).toBe("Björn Ek");
  });

  it("decodes a Latin-1 Q-encoded name, the older Swedish way", () => {
    expect(decodeEncodedWords("=?ISO-8859-1?Q?Bj=F6rn_Ek?=")).toBe("Björn Ek");
  });

  it("joins adjacent encoded words without the space between them", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?Bj=C3=B6rn?= =?UTF-8?Q?_Ek?=")).toBe("Björn Ek");
  });

  it("leaves plain text, including å ä ö, untouched", () => {
    expect(decodeEncodedWords("Åsa Öberg")).toBe("Åsa Öberg");
  });

  it("leaves a word in an unknown charset encoded rather than guessing", () => {
    expect(decodeEncodedWords("=?x-made-up?Q?abc?=")).toBe("=?x-made-up?Q?abc?=");
  });
});

describe("parseAddressList", () => {
  it("reads a quoted name with Swedish characters, and lowercases the address", () => {
    expect(parseAddressList('"Björn Ek" <B.Ek@Example.se>')).toEqual([
      { email: "b.ek@example.se", name: "Björn Ek" },
    ]);
  });

  it("reads an unquoted name", () => {
    expect(parseAddressList("Karin Lindqvist <karin@example.se>")).toEqual([
      { email: "karin@example.se", name: "Karin Lindqvist" },
    ]);
  });

  it("reads a bare address with no name", () => {
    expect(parseAddressList("karin@example.se")).toEqual([
      { email: "karin@example.se", name: null },
    ]);
  });

  it("does not split on a comma inside a quoted name", () => {
    expect(parseAddressList('"Ek, Björn" <b@example.se>, karin@example.se')).toEqual([
      { email: "b@example.se", name: "Ek, Björn" },
      { email: "karin@example.se", name: null },
    ]);
  });

  it("decodes an encoded name, quoted or not", () => {
    expect(parseAddressList(`${base64Word("Åsa Öberg")} <asa@example.se>`)).toEqual([
      { email: "asa@example.se", name: "Åsa Öberg" },
    ]);
    expect(parseAddressList(`"${base64Word("Åsa Öberg")}" <asa@example.se>`)).toEqual([
      { email: "asa@example.se", name: "Åsa Öberg" },
    ]);
  });

  it("unescapes quotes inside a quoted name", () => {
    expect(parseAddressList('"Anna \\"Nan\\" Berg" <anna@example.se>')).toEqual([
      { email: "anna@example.se", name: 'Anna "Nan" Berg' },
    ]);
  });

  it("reads the old comment style: address (name)", () => {
    expect(parseAddressList("b@example.se (Björn Ek)")).toEqual([
      { email: "b@example.se", name: "Björn Ek" },
    ]);
  });

  it("keeps the addresses in a group and drops the group name", () => {
    expect(parseAddressList("Team: a@example.se, b@example.se;")).toEqual([
      { email: "a@example.se", name: null },
      { email: "b@example.se", name: null },
    ]);
  });

  it("drops things that aren't addresses", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it("lists an address once even if it appears twice in different case", () => {
    expect(parseAddressList("KARIN@example.se, karin@example.se")).toEqual([
      { email: "karin@example.se", name: null },
    ]);
  });

  it("doesn't treat an address repeated as its own name as a name", () => {
    expect(parseAddressList('"karin@example.se" <Karin@example.se>')).toEqual([
      { email: "karin@example.se", name: null },
    ]);
  });
});

describe("toMessageRow", () => {
  const mailbox = { userId: "user-1", ownEmail: "Neo@Gmail.com" };

  function message(overrides: {
    labelIds?: string[];
    headers?: Record<string, string>;
    internalDate?: string;
  }): GmailMessage {
    return {
      id: "m1",
      threadId: "t1",
      labelIds: overrides.labelIds ?? ["INBOX"],
      internalDate: overrides.internalDate ?? "1757322000000",
      payload: {
        headers: Object.entries(overrides.headers ?? {}).map(([name, value]) => ({ name, value })),
      },
    };
  }

  it("maps a received message to an inbound row", () => {
    const row = toMessageRow(
      message({
        headers: {
          From: '"Karin Lindqvist" <Karin@Example.se>',
          To: "neo@gmail.com",
          Cc: "Johan <johan@example.se>, KARIN@example.se",
        },
      }),
      mailbox,
    );

    expect(row).toEqual({
      user_id: "user-1",
      gmail_message_id: "m1",
      thread_id: "t1",
      internal_date: new Date(1757322000000).toISOString(),
      from_email: "karin@example.se",
      from_name: "Karin Lindqvist",
      to_emails: ["neo@gmail.com"],
      cc_emails: ["johan@example.se", "karin@example.se"],
      direction: "inbound",
      has_list_unsubscribe: false,
    });
  });

  it("is outbound when Gmail labelled it SENT, even from an alias", () => {
    const row = toMessageRow(
      message({
        labelIds: ["SENT"],
        headers: { From: "neo@alias.se", To: "karin@example.se" },
      }),
      mailbox,
    );

    expect(row?.direction).toBe("outbound");
  });

  it("is outbound when From is the mailbox's own address, in any case", () => {
    const row = toMessageRow(
      message({ headers: { From: "Neo <NEO@gmail.com>", To: "karin@example.se" } }),
      mailbox,
    );

    expect(row?.direction).toBe("outbound");
  });

  it("notices List-Unsubscribe whatever case the header name is in", () => {
    const row = toMessageRow(
      message({
        headers: { From: "news@example.se", "list-unsubscribe": "<mailto:stop@example.se>" },
      }),
      mailbox,
    );

    expect(row?.has_list_unsubscribe).toBe(true);
  });

  it("skips drafts: nobody was talked to yet", () => {
    const row = toMessageRow(
      message({ labelIds: ["DRAFT"], headers: { From: "neo@gmail.com", To: "karin@example.se" } }),
      mailbox,
    );

    expect(row).toBeNull();
  });

  it("skips a message with no readable sender", () => {
    expect(toMessageRow(message({ headers: { To: "neo@gmail.com" } }), mailbox)).toBeNull();
    expect(
      toMessageRow(message({ headers: { From: "undisclosed-recipients:;" } }), mailbox),
    ).toBeNull();
  });

  it("skips a message with no usable date", () => {
    expect(
      toMessageRow(message({ internalDate: "not-a-number", headers: { From: "k@example.se" } }), mailbox),
    ).toBeNull();
  });
});
