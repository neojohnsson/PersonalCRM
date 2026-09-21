import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GmailApiError,
  GmailHistoryTooOld,
  getMailboxHistoryId,
  getMessageMetadata,
  listAddedSince,
  listMessageIds,
} from "@/lib/google/gmail";

/**
 * The Gmail helpers against a fake fetch. No network, no real mailbox — each
 * test hands back a prepared Gmail reply and checks what was asked for.
 */

const TOKEN = "ya29.fake-access-token";

/** Replaces fetch with one that always answers `body` with `status`. */
function fakeGmail(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The URL and headers of the first request the helper made. */
function firstRequest(fetchMock: ReturnType<typeof fakeGmail>) {
  const [input, init] = fetchMock.mock.calls[0];
  return { url: new URL(String(input)), headers: new Headers(init?.headers) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMessageIds", () => {
  it("asks for one page from the last N days, with the access token", async () => {
    const fetchMock = fakeGmail(200, {
      messages: [
        { id: "a", threadId: "t1" },
        { id: "b", threadId: "t1" },
      ],
      nextPageToken: "page-2",
      resultSizeEstimate: 2,
    });

    const page = await listMessageIds(TOKEN, { lookbackDays: 90 });

    expect(page).toEqual({ ids: ["a", "b"], nextPageToken: "page-2" });

    const { url, headers } = firstRequest(fetchMock);
    expect(url.origin + url.pathname).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(url.searchParams.get("q")).toBe("newer_than:90d");
    expect(url.searchParams.get("maxResults")).toBe("100");
    expect(url.searchParams.has("pageToken")).toBe(false);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("sends the page token to continue where the last page ended", async () => {
    const fetchMock = fakeGmail(200, { messages: [{ id: "c", threadId: "t2" }] });

    const page = await listMessageIds(TOKEN, { lookbackDays: 90, pageToken: "page-2" });

    expect(firstRequest(fetchMock).url.searchParams.get("pageToken")).toBe("page-2");
    expect(page.nextPageToken).toBeNull();
  });

  it("treats a reply with no messages field as an empty last page", async () => {
    fakeGmail(200, { resultSizeEstimate: 0 });

    expect(await listMessageIds(TOKEN, { lookbackDays: 90 })).toEqual({
      ids: [],
      nextPageToken: null,
    });
  });
});

describe("getMessageMetadata", () => {
  it("asks for headers only, and only the ones the sync reads", async () => {
    const message = {
      id: "abc",
      threadId: "t1",
      internalDate: "1757322000000",
      payload: { headers: [{ name: "From", value: "karin@example.com" }] },
    };
    const fetchMock = fakeGmail(200, message);

    expect(await getMessageMetadata(TOKEN, "abc")).toEqual(message);

    const { url } = firstRequest(fetchMock);
    expect(url.pathname).toBe("/gmail/v1/users/me/messages/abc");
    expect(url.searchParams.get("format")).toBe("metadata");
    // The whole list, on purpose: this is the app's claim about what it reads
    // from your mail, so adding a header should have to be deliberate. The
    // four auto-reply ones arrived in slice 9a (lib/google/filter.ts).
    expect(url.searchParams.getAll("metadataHeaders")).toEqual([
      "From",
      "To",
      "Cc",
      "Subject",
      "List-Unsubscribe",
      "Auto-Submitted",
      "Precedence",
      "X-Autoreply",
      "X-Autorespond",
    ]);
  });
});

describe("listAddedSince", () => {
  it("collects each added message once and returns the new bookmark", async () => {
    const fetchMock = fakeGmail(200, {
      history: [
        { messagesAdded: [{ message: { id: "a", threadId: "t1" } }] },
        {
          messagesAdded: [
            { message: { id: "a", threadId: "t1" } },
            { message: { id: "b", threadId: "t2" } },
          ],
        },
        { labelsAdded: [{ message: { id: "z", threadId: "t9" }, labelIds: ["STARRED"] }] },
      ],
      historyId: "999",
    });

    const page = await listAddedSince(TOKEN, { startHistoryId: "123" });

    expect(page).toEqual({ ids: ["a", "b"], nextPageToken: null, historyId: "999" });

    const { url } = firstRequest(fetchMock);
    expect(url.pathname).toBe("/gmail/v1/users/me/history");
    expect(url.searchParams.get("startHistoryId")).toBe("123");
    expect(url.searchParams.get("historyTypes")).toBe("messageAdded");
  });

  it("returns no ids when nothing has changed", async () => {
    fakeGmail(200, { historyId: "123" });

    expect(await listAddedSince(TOKEN, { startHistoryId: "123" })).toEqual({
      ids: [],
      nextPageToken: null,
      historyId: "123",
    });
  });

  it("turns Gmail's 404 into GmailHistoryTooOld, so the sync starts over", async () => {
    fakeGmail(404, {
      error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
    });

    await expect(listAddedSince(TOKEN, { startHistoryId: "1" })).rejects.toBeInstanceOf(
      GmailHistoryTooOld,
    );
  });

  it("keeps other failures as GmailApiError with their status", async () => {
    fakeGmail(500, { error: { code: 500 } });

    const failure = listAddedSince(TOKEN, { startHistoryId: "1" });

    await expect(failure).rejects.toBeInstanceOf(GmailApiError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });

  it("keeps Google's reason in the error message, so the status line can show it", async () => {
    fakeGmail(403, {
      error: { code: 403, message: "Metadata scope does not support 'q' parameter", status: "PERMISSION_DENIED" },
    });

    await expect(listMessageIds(TOKEN, { lookbackDays: 90 })).rejects.toMatchObject({
      status: 403,
      message: "Gmail /messages failed with HTTP 403: Metadata scope does not support 'q' parameter",
    });
  });

  it("still fails cleanly when the error reply isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    );

    await expect(listMessageIds(TOKEN, { lookbackDays: 90 })).rejects.toMatchObject({
      status: 502,
      message: "Gmail /messages failed with HTTP 502",
    });
  });
});

describe("getMailboxHistoryId", () => {
  it("reads the current bookmark from the profile", async () => {
    const fetchMock = fakeGmail(200, {
      emailAddress: "me@example.com",
      messagesTotal: 10,
      threadsTotal: 5,
      historyId: "4242",
    });

    expect(await getMailboxHistoryId(TOKEN)).toBe("4242");
    expect(firstRequest(fetchMock).url.pathname).toBe("/gmail/v1/users/me/profile");
  });
});
