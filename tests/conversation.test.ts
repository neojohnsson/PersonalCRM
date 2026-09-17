import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGES_PER_SUMMARY, readConversation } from "@/lib/ai/conversation";
import { GmailApiError } from "@/lib/google/gmail";
import type { Touch } from "@/lib/relationship/touches";

/**
 * Reading a contact's recent messages from Gmail for one summary — against a
 * fake Gmail, and checking the text has no way into the database.
 */

const TOKEN = "ya29.fake-access-token";
const DAY = 24 * 60 * 60 * 1000;

const touch = (n: number, direction: Touch["direction"] = n % 2 ? "inbound" : "outbound"): Touch => ({
  messageId: `msg-${n}`,
  threadId: "t1",
  direction,
  at: new Date(Date.UTC(2026, 8, 1) + n * DAY),
  subject: `Subject ${n}`,
});

/** A fake Gmail answering each message id with a text body, or a status for some. */
function fakeGmail(failures: Record<string, number> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const id = decodeURIComponent(new URL(String(input)).pathname.split("/").pop()!);
    if (failures[id]) {
      return new Response(JSON.stringify({ error: { message: "nope" } }), { status: failures[id] });
    }
    return new Response(
      JSON.stringify({
        id,
        threadId: "t1",
        internalDate: "0",
        payload: {
          mimeType: "text/plain",
          body: { data: Buffer.from(`Text of ${id}\n\nOn Mon, 1 Sep 2026, X wrote:\n> quoted`).toString("base64url") },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readConversation", () => {
  it("reads the newest messages in full, oldest first, with refs the AI can cite", async () => {
    const fetchMock = fakeGmail();
    const touches = Array.from({ length: 25 }, (_, i) => touch(i + 1)).reverse();

    const conversation = await readConversation(TOKEN, touches);

    expect(conversation).toHaveLength(MESSAGES_PER_SUMMARY);
    expect(conversation[0]).toEqual({
      ref: "m1",
      messageId: "msg-6",
      threadId: "t1",
      from: "you",
      at: touch(6).at,
      subject: "Subject 6",
      text: "Text of msg-6",
    });
    expect(conversation.at(-1)).toMatchObject({ ref: "m20", messageId: "msg-25", from: "them" });

    expect(fetchMock).toHaveBeenCalledTimes(20);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("format")).toBe("full");
  });

  it("skips a message deleted from Gmail since the sync, and renumbers", async () => {
    fakeGmail({ "msg-2": 404 });
    const conversation = await readConversation(TOKEN, [touch(1), touch(2), touch(3)]);
    expect(conversation.map((m) => [m.ref, m.messageId])).toEqual([
      ["m1", "msg-1"],
      ["m2", "msg-3"],
    ]);
  });

  it("stops on any other Gmail failure", async () => {
    fakeGmail({ "msg-2": 403 });
    await expect(readConversation(TOKEN, [touch(1), touch(2), touch(3)])).rejects.toBeInstanceOf(GmailApiError);
  });

  it("reads nothing when there are no touches", async () => {
    const fetchMock = fakeGmail();
    expect(await readConversation(TOKEN, [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no way to write the text anywhere: no database client, no Supabase import", () => {
    for (const file of ["lib/ai/conversation.ts", "lib/google/body.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/supabase/i);
      expect(source).not.toMatch(/console\./);
    }
    // Its inputs are an access token and touches — nothing it could write to.
    expect(readConversation.length).toBe(2);
  });
});
