import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import type { GmailMessage } from "@/lib/google/gmail";
import { GMAIL_UNITS, RATE_LIMIT_WAIT_MS, waitAfter } from "@/lib/sync/pace";
import { runSyncStep } from "@/lib/sync/run-sync-step";

/**
 * The sync state machine, one step at a time, against:
 *
 *   - a real Supabase test user, signed in — so every read and write goes
 *     through the same RLS policies the "Sync now" button will
 *   - a fake Google: the token endpoint and Gmail answer from an in-memory
 *     mailbox, so no real mail is read and every reply is under the test's
 *     control
 *
 * Needs migrations 0003 (page_token) and 0004 (subject, filtered_count,
 * seen_once_dismissals) run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const OWN_EMAIL = "neo@example.com";
const OPTIONS = { lookbackDays: 90 };

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `sync-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

// ── The fake Google ─────────────────────────────────────────────────────────

type Page = { ids: string[]; next?: string };

type FakeMailbox = {
  /** What getProfile reports as the current bookmark. */
  historyId: string;
  /** Every message Gmail can hand back. An id missing here answers 404. */
  messages: Record<string, GmailMessage>;
  /** messages.list pages, keyed by page token ("" is the first page). */
  listPages: Record<string, Page>;
  /** history.list pages, keyed by page token. */
  historyPages: Record<string, Page & { historyId: string }>;
  /** Make the token endpoint refuse, as Google does for a dead key. */
  tokenError?: "invalid_grant";
  /** Make messages.list or history.list fail with this HTTP status. */
  listStatus?: number;
  historyStatus?: number;
  /** Answer messages.list and history.list with Gmail's per-user quota 403. */
  rateLimited?: boolean;
  /** Hold messages.list replies until this many requests have arrived. */
  holdListUntil?: number;
  /** Runs before messages.list replies — for simulating another tab. */
  beforeListReply?: () => Promise<void>;
};

function gmailMessage(
  id: string,
  fields: {
    from: string;
    to?: string;
    cc?: string;
    subject?: string;
    sent?: boolean;
    listUnsubscribe?: boolean;
    date: string;
  },
): GmailMessage {
  const headers = [{ name: "From", value: fields.from }];
  if (fields.to) headers.push({ name: "To", value: fields.to });
  if (fields.cc) headers.push({ name: "Cc", value: fields.cc });
  if (fields.subject) headers.push({ name: "Subject", value: fields.subject });
  if (fields.listUnsubscribe) {
    headers.push({ name: "List-Unsubscribe", value: "<mailto:stop@example.se>" });
  }

  return {
    id,
    threadId: `thread-${id}`,
    labelIds: fields.sent ? ["SENT"] : ["INBOX"],
    internalDate: String(Date.parse(fields.date)),
    payload: { headers },
  };
}

const MESSAGES: Record<string, GmailMessage> = {
  m1: gmailMessage("m1", {
    from: '"Karin Lindqvist" <karin@example.se>',
    to: OWN_EMAIL,
    subject: "Examensarbete",
    date: "2026-09-01T09:00:00Z",
  }),
  m2: gmailMessage("m2", {
    from: OWN_EMAIL,
    to: "karin@example.se",
    cc: "Johan Ek <johan@example.se>",
    subject: "Re: Examensarbete",
    sent: true,
    date: "2026-09-02T09:00:00Z",
  }),
  m3: gmailMessage("m3", {
    from: "Johan Ek <johan@example.se>",
    to: OWN_EMAIL,
    date: "2026-09-03T09:00:00Z",
  }),
  m4: gmailMessage("m4", {
    from: "Elin Marklund <elin@example.se>",
    to: OWN_EMAIL,
    date: "2026-09-10T09:00:00Z",
  }),
  news: gmailMessage("news", {
    from: "Nyhetsbrev <news@example.se>",
    to: OWN_EMAIL,
    subject: "Veckans nyheter",
    listUnsubscribe: true,
    date: "2026-09-04T09:00:00Z",
  }),
  robot: gmailMessage("robot", {
    from: "noreply@github.com",
    to: OWN_EMAIL,
    subject: "[GitHub] A new sign-in",
    date: "2026-09-05T09:00:00Z",
  }),
};

/** Two backfill pages (m1 m2, then m3) and one history page adding m4. */
function mailbox(overrides: Partial<FakeMailbox> = {}): FakeMailbox {
  return {
    historyId: "1000",
    messages: MESSAGES,
    listPages: { "": { ids: ["m1", "m2"], next: "p2" }, p2: { ids: ["m3"] } },
    historyPages: { "": { ids: ["m4"], historyId: "1005" } },
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The 403 Gmail really sent on the preview when the sync went too fast. */
function quotaExceeded(): Response {
  return json(403, {
    error: {
      code: 403,
      message:
        "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'.",
      status: "PERMISSION_DENIED",
      errors: [{ reason: "rateLimitExceeded", domain: "usageLimits" }],
    },
  });
}

const realFetch = globalThis.fetch;

/**
 * Answers Google's URLs from `box`; everything else (Supabase) goes to the
 * real network. Returns the Google requests made, in order.
 */
function installFakeGoogle(box: FakeMailbox): URL[] {
  const requests: URL[] = [];

  let listRequests = 0;
  let releaseList: () => void = () => {};
  const listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
    // Never hang a test if fewer requests arrive than expected.
    setTimeout(resolve, 3_000);
  });

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.endsWith("googleapis.com")) return realFetch(input, init);

    requests.push(url);

    if (url.hostname === "oauth2.googleapis.com") {
      return box.tokenError
        ? json(400, { error: box.tokenError })
        : json(200, { access_token: "fake-access-token", expires_in: 3599 });
    }

    const path = url.pathname.replace("/gmail/v1/users/me", "");
    const pageToken = url.searchParams.get("pageToken") ?? "";

    if (path === "/profile") {
      return json(200, { emailAddress: OWN_EMAIL, historyId: box.historyId });
    }

    if (path === "/messages") {
      listRequests++;
      if (box.holdListUntil) {
        if (listRequests >= box.holdListUntil) releaseList();
        await listGate;
      }
      if (box.beforeListReply) await box.beforeListReply();
      if (box.rateLimited) return quotaExceeded();
      if (box.listStatus) return json(box.listStatus, { error: { code: box.listStatus } });

      const page = box.listPages[pageToken];
      return json(200, {
        messages: page.ids.map((id) => ({ id, threadId: `thread-${id}` })),
        nextPageToken: page.next,
      });
    }

    if (path.startsWith("/messages/")) {
      const message = box.messages[decodeURIComponent(path.slice("/messages/".length))];
      return message ? json(200, message) : json(404, { error: { code: 404 } });
    }

    if (path === "/history") {
      if (box.rateLimited) return quotaExceeded();
      if (box.historyStatus) return json(box.historyStatus, { error: { code: box.historyStatus } });

      const page = box.historyPages[pageToken];
      return json(200, {
        history: [{ messagesAdded: page.ids.map((id) => ({ message: { id, threadId: `thread-${id}` } })) }],
        nextPageToken: page.next,
        historyId: page.historyId,
      });
    }

    throw new Error(`Unexpected Google request: ${url}`);
  });

  return requests;
}

const onGmail = (requests: URL[]) => requests.filter((url) => url.hostname === "gmail.googleapis.com");
const toPath = (path: string) => (url: URL) => url.pathname === `/gmail/v1/users/me${path}`;

// ── The tests ───────────────────────────────────────────────────────────────

describe("runSyncStep", () => {
  let user: User;
  let db: SupabaseClient;

  const step = () => runSyncStep(db, user.id, OPTIONS);

  async function state() {
    const { data, error } = await db.from("gmail_sync_state").select("*").maybeSingle();
    if (error) throw error;
    return data;
  }

  async function setState(fields: Record<string, unknown>) {
    const { error } = await db.from("gmail_sync_state").upsert({ user_id: user.id, ...fields });
    if (error) throw error;
  }

  async function savedMessageIds(): Promise<string[]> {
    const { data, error } = await db
      .from("gmail_messages")
      .select("gmail_message_id")
      .order("gmail_message_id");
    if (error) throw error;
    return data.map((row) => row.gmail_message_id);
  }

  beforeAll(async () => {
    for (const [name, value] of Object.entries({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: SECRET_KEY,
      TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    })) {
      if (!value) throw new Error(`${name} is not set in .env.local`);
    }

    user = await createUser();
    db = await signInAs(user.email!);
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  beforeEach(async () => {
    // Every test starts connected, with no sync state, messages or dismissals.
    await db.from("gmail_sync_state").delete().eq("user_id", user.id);
    await db.from("gmail_messages").delete().eq("user_id", user.id);
    await db.from("seen_once_dismissals").delete().eq("user_id", user.id);

    const { error } = await db.from("google_accounts").upsert(
      {
        user_id: user.id,
        email: OWN_EMAIL,
        refresh_token_encrypted: encrypt("fake-refresh-token"),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("a first sync, start to finish", () => {
    it("goes ready → backfilling → one step per page → synced, and fills the people view", async () => {
      installFakeGoogle(mailbox());

      const statuses: string[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await step();
        statuses.push(result.status);
        if (result.done) break;
      }

      expect(statuses).toEqual(["ready", "backfilling", "backfilling", "synced"]);
      expect(await savedMessageIds()).toEqual(["m1", "m2", "m3"]);
      expect(await state()).toMatchObject({
        status: "synced",
        history_id: "1000",
        page_token: null,
        message_count: 3,
        filtered_count: 0,
        last_error: null,
      });
      expect((await state())!.last_synced_at).not.toBeNull();

      const { data: people } = await db
        .from("people")
        .select("email, message_count")
        .order("email");
      expect(people).toEqual([
        { email: "johan@example.se", message_count: 2 },
        { email: "karin@example.se", message_count: 2 },
      ]);
    });
  });

  describe("one step at a time", () => {
    it("creates the sync state as ready, without calling Google", async () => {
      const requests = installFakeGoogle(mailbox());

      expect(await step()).toEqual({ status: "ready", done: false, waitMs: 0 });
      expect((await state())!.status).toBe("ready");
      expect(requests).toEqual([]);
    });

    it("saves Gmail's bookmark before backfilling, so mail arriving mid-backfill isn't missed", async () => {
      installFakeGoogle(mailbox());
      await setState({ status: "ready" });

      expect(await step()).toMatchObject({ status: "backfilling", done: false });
      expect(await state()).toMatchObject({ history_id: "1000", page_token: null });
      expect(await savedMessageIds()).toEqual([]);
    });

    it("saves one page of 50 per step and remembers the next page token", async () => {
      const requests = installFakeGoogle(mailbox());
      await setState({ status: "backfilling", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "backfilling", done: false });
      expect(await savedMessageIds()).toEqual(["m1", "m2"]);
      expect(await state()).toMatchObject({ page_token: "p2", message_count: 2 });

      const list = onGmail(requests).find(toPath("/messages"))!;
      expect(list.searchParams.get("q")).toBe("newer_than:90d");
      expect(list.searchParams.get("maxResults")).toBe("50");
    });

    it("asks the caller to wait long enough to stay inside Gmail's per-user quota", async () => {
      installFakeGoogle(mailbox());
      await setState({ status: "backfilling", history_id: "1000" });

      // One list (5 units) and two messages read (20 units each).
      const result = await step();
      expect(result.waitMs).toBe(waitAfter(GMAIL_UNITS.messagesList + 2 * GMAIL_UNITS.messagesGet));
      expect(result.waitMs).toBeGreaterThan(0);
    });

    it("finishes the backfill on the last page, with nothing left to wait for", async () => {
      installFakeGoogle(mailbox());
      await setState({ status: "backfilling", history_id: "1000", page_token: "p2" });

      expect(await step()).toEqual({ status: "synced", done: true, waitMs: 0 });
      expect(await savedMessageIds()).toEqual(["m3"]);
      expect(await state()).toMatchObject({ status: "synced", page_token: null });
      expect((await state())!.last_synced_at).not.toBeNull();
    });

    it("does nothing while the user needs to reconnect", async () => {
      const requests = installFakeGoogle(mailbox());
      await setState({ status: "needs_reconnect" });

      expect(await step()).toEqual({ status: "needs_reconnect", done: true, waitMs: 0 });
      expect(requests).toEqual([]);
    });

    it("reports not_connected, and touches nothing, without a Gmail connection", async () => {
      const requests = installFakeGoogle(mailbox());
      await db.from("google_accounts").delete().eq("user_id", user.id);

      expect(await step()).toEqual({ status: "not_connected", done: true, waitMs: 0 });
      expect(await state()).toBeNull();
      expect(requests).toEqual([]);
    });
  });

  describe("what the sync stores", () => {
    it("saves each message's subject", async () => {
      installFakeGoogle(mailbox({ listPages: { "": { ids: ["m1", "m3"] } } }));
      await setState({ status: "backfilling", history_id: "1000" });

      await step();

      const { data } = await db
        .from("gmail_messages")
        .select("gmail_message_id, subject")
        .order("gmail_message_id");
      expect(data).toEqual([
        { gmail_message_id: "m1", subject: "Examensarbete" },
        { gmail_message_id: "m3", subject: null },
      ]);
    });

    it("never stores newsletters or automated senders, and counts what it skipped", async () => {
      installFakeGoogle(mailbox({ listPages: { "": { ids: ["m1", "news", "robot"] } } }));
      await setState({ status: "backfilling", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "synced" });
      expect(await savedMessageIds()).toEqual(["m1"]);
      expect(await state()).toMatchObject({ message_count: 1, filtered_count: 2 });
    });

    it("adds to the count page by page, and starts it over with a fresh backfill", async () => {
      installFakeGoogle(mailbox({ listPages: { p2: { ids: ["robot"] } } }));
      await setState({ status: "backfilling", history_id: "1000", page_token: "p2", filtered_count: 5 });

      await step();
      expect((await state())!.filtered_count).toBe(6);

      await setState({ status: "ready" });
      await step();
      expect(await state()).toMatchObject({ status: "backfilling", filtered_count: 0 });
    });

    it("never stores mail from someone the user dismissed", async () => {
      installFakeGoogle(mailbox({ listPages: { "": { ids: ["m1", "m3"] } } }));
      await db.from("seen_once_dismissals").insert({ user_id: user.id, email: "karin@example.se" });
      await setState({ status: "backfilling", history_id: "1000" });

      await step();

      expect(await savedMessageIds()).toEqual(["m3"]);
      expect((await state())!.filtered_count).toBe(1);
    });

    it("still stores mail the user sent to a dismissed address", async () => {
      installFakeGoogle(mailbox({ listPages: { "": { ids: ["m2"] } } }));
      await db.from("seen_once_dismissals").insert({ user_id: user.id, email: "karin@example.se" });
      await setState({ status: "backfilling", history_id: "1000" });

      await step();

      expect(await savedMessageIds()).toEqual(["m2"]);
      expect((await state())!.filtered_count).toBe(0);
    });

    it("filters mail found by a later sync too", async () => {
      installFakeGoogle(mailbox({ historyPages: { "": { ids: ["m4", "news"], historyId: "1005" } } }));
      await setState({ status: "synced", history_id: "1000", filtered_count: 3 });

      await step();

      expect(await savedMessageIds()).toEqual(["m4"]);
      expect((await state())!.filtered_count).toBe(4);
    });
  });

  describe("later syncs", () => {
    it("fetches only mail added since the bookmark, then moves the bookmark", async () => {
      const requests = installFakeGoogle(mailbox());
      await setState({ status: "synced", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "synced", done: true });
      expect(await savedMessageIds()).toEqual(["m4"]);
      expect((await state())!.history_id).toBe("1005");

      const gmail = onGmail(requests);
      expect(gmail.find(toPath("/history"))!.searchParams.get("startHistoryId")).toBe("1000");
      expect(gmail.some(toPath("/messages"))).toBe(false);
    });

    it("pages through history, keeping the old bookmark until the last page", async () => {
      installFakeGoogle(
        mailbox({
          historyPages: {
            "": { ids: ["m3"], next: "h2", historyId: "1003" },
            h2: { ids: ["m4"], historyId: "1005" },
          },
        }),
      );
      await setState({ status: "synced", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "incremental", done: false });
      expect(await state()).toMatchObject({ history_id: "1000", page_token: "h2" });

      expect(await step()).toMatchObject({ status: "synced", done: true });
      expect(await state()).toMatchObject({ history_id: "1005", page_token: null });
      expect(await savedMessageIds()).toEqual(["m3", "m4"]);
    });

    it("skips a message deleted before it could be read", async () => {
      installFakeGoogle(mailbox({ listPages: { "": { ids: ["m1", "gone"] } } }));
      await setState({ status: "backfilling", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "synced", done: true });
      expect(await savedMessageIds()).toEqual(["m1"]);
      expect((await state())!.last_error).toBeNull();
    });
  });

  describe("when things go wrong", () => {
    it("pauses on Gmail's rate limit without losing its place, and asks the caller to wait", async () => {
      installFakeGoogle(mailbox({ rateLimited: true }));
      await setState({ status: "backfilling", history_id: "1000", page_token: "p2" });

      expect(await step()).toEqual({ status: "backfilling", done: false, waitMs: RATE_LIMIT_WAIT_MS });
      expect(await state()).toMatchObject({
        status: "backfilling",
        page_token: "p2",
        last_error: null,
      });
      expect(await savedMessageIds()).toEqual([]);
    });

    it("pauses an incremental sync on the rate limit too, keeping its bookmark", async () => {
      installFakeGoogle(mailbox({ rateLimited: true }));
      await setState({ status: "synced", history_id: "1000" });

      expect(await step()).toEqual({ status: "synced", done: false, waitMs: RATE_LIMIT_WAIT_MS });
      expect(await state()).toMatchObject({ status: "synced", history_id: "1000" });
    });

    it("starts over from a fresh bookmark when Gmail's history has expired", async () => {
      installFakeGoogle(mailbox({ historyStatus: 404 }));
      await setState({ status: "synced", history_id: "1" });

      expect(await step()).toMatchObject({ status: "ready", done: false });
      expect((await state())!.page_token).toBeNull();

      expect(await step()).toMatchObject({ status: "backfilling", done: false });
      expect((await state())!.history_id).toBe("1000");
    });

    it("marks a dead Gmail key needs_reconnect, and stops", async () => {
      const requests = installFakeGoogle(mailbox({ tokenError: "invalid_grant" }));
      await setState({ status: "backfilling", history_id: "1000", page_token: "p2" });

      expect(await step()).toEqual({ status: "needs_reconnect", done: true, waitMs: 0 });
      expect((await state())!.last_error).toBeTruthy();
      expect(onGmail(requests)).toEqual([]);
    });

    it("records any other failure as error, and a retry starts again", async () => {
      installFakeGoogle(mailbox({ listStatus: 500 }));
      await setState({ status: "backfilling", history_id: "1000" });

      expect(await step()).toEqual({ status: "error", done: true, waitMs: 0 });
      expect((await state())!.last_error).toContain("500");

      vi.unstubAllGlobals();
      installFakeGoogle(mailbox());

      expect(await step()).toMatchObject({ status: "backfilling", done: false });
      expect((await state())!.last_error).toBeNull();
    });
  });

  describe("two tabs at once", () => {
    it("saves a page once, however many steps run it together", async () => {
      // Both steps read the state, then both ask Gmail for the same page —
      // the fake holds the reply until both requests have arrived.
      const requests = installFakeGoogle(mailbox({ holdListUntil: 2 }));
      await setState({ status: "backfilling", history_id: "1000" });

      const results = await Promise.all([step(), step()]);

      expect(results.map((result) => result.status)).toEqual(["backfilling", "backfilling"]);
      expect(await savedMessageIds()).toEqual(["m1", "m2"]);
      expect(await state()).toMatchObject({ page_token: "p2", message_count: 2 });
      expect(onGmail(requests).filter(toPath("/messages"))).toHaveLength(2);
    });

    it("counts skipped mail once when two steps run the same page", async () => {
      const requests = installFakeGoogle(
        mailbox({ holdListUntil: 2, listPages: { "": { ids: ["m1", "news"], next: "p2" } } }),
      );
      await setState({ status: "backfilling", history_id: "1000" });

      await Promise.all([step(), step()]);

      expect((await state())!.filtered_count).toBe(1);
      expect(onGmail(requests).filter(toPath("/messages"))).toHaveLength(2);
    });

    it("doesn't undo progress another step saved while this one was working", async () => {
      // While this step waits on Gmail, "another tab" finishes the whole sync.
      // A slow step that saved blindly would drag the sync back to page 2.
      installFakeGoogle(
        mailbox({
          beforeListReply: () => setState({ status: "synced", history_id: "1000", page_token: null }),
        }),
      );
      await setState({ status: "backfilling", history_id: "1000" });

      expect(await step()).toMatchObject({ status: "synced", done: true });
      expect(await state()).toMatchObject({ status: "synced", page_token: null });
    });
  });
});
