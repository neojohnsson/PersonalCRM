import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import type { GmailMessage } from "@/lib/google/gmail";
import { addAddressAsContact, undoDismissal } from "@/lib/contacts/dismissals";
import { importContacts } from "@/lib/sync/import-contacts";
import { readBackMailFrom } from "@/lib/sync/read-back-mail";

/**
 * Undoing a dismissal and getting the person back:
 *
 *   readBackMailFrom     reads the mail they sent back in from Gmail — headers
 *                        only, same filters as the sync, only that address
 *   addAddressAsContact  makes the address a contact: through import when the
 *                        mail is both ways, Seen once's path when it's one way,
 *                        and just the address when there's no mail at all
 *
 * Against a real Supabase test user (so RLS applies) and a fake Google that
 * answers from an in-memory mailbox, so no real mail is read.
 *
 * Needs migration 0012 run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const OWN_EMAIL = "alice@example.se";
const OPTIONS = { lookbackDays: 90 };

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `undo-${label}-${randomUUID()}@example.com`,
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

function gmailMessage(
  id: string,
  fields: { from: string; to?: string; subject?: string; sent?: boolean; listUnsubscribe?: boolean; day: number },
): GmailMessage {
  const headers = [{ name: "From", value: fields.from }];
  if (fields.to) headers.push({ name: "To", value: fields.to });
  if (fields.subject) headers.push({ name: "Subject", value: fields.subject });
  if (fields.listUnsubscribe) headers.push({ name: "List-Unsubscribe", value: "<mailto:stop@example.se>" });

  return {
    id,
    threadId: `thread-${id}`,
    labelIds: fields.sent ? ["SENT"] : ["INBOX"],
    internalDate: String(Date.parse(`2026-09-${String(fields.day).padStart(2, "0")}T09:00:00Z`)),
    payload: { headers },
  };
}

/** What Gmail holds. Its from: search answers with every id whose From contains the searched text. */
const MAILBOX: Record<string, GmailMessage> = {
  "karin-1": gmailMessage("karin-1", { from: '"Karin Lindqvist" <karin@example.se>', to: OWN_EMAIL, subject: "Examensarbete", day: 1 }),
  "karin-2": gmailMessage("karin-2", { from: "Karin Lindqvist <karin@example.se>", to: OWN_EMAIL, day: 3 }),
  // Gmail's search is loose: this one matches "karin@example.se" too, but isn't from her.
  "karin-lookalike": gmailMessage("karin-lookalike", { from: "Karin Fan <fan.karin@example.se.spam.test>", to: OWN_EMAIL, day: 4 }),
  "karin-news": gmailMessage("karin-news", { from: "karin@example.se", to: OWN_EMAIL, listUnsubscribe: true, day: 5 }),
  "sara-1": gmailMessage("sara-1", { from: "Sara Berg <sara@example.se>", to: OWN_EMAIL, day: 6 }),
};

const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers Google's URLs; everything else goes to the real network. Returns the Google requests. */
function installFakeGoogle(options: { tokenError?: "invalid_grant" } = {}): URL[] {
  const requests: URL[] = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.endsWith("googleapis.com")) return realFetch(input, init);
    requests.push(url);

    if (url.hostname === "oauth2.googleapis.com") {
      return options.tokenError
        ? json(400, { error: options.tokenError })
        : json(200, { access_token: "fake-access-token", expires_in: 3599 });
    }

    const path = url.pathname.replace("/gmail/v1/users/me", "");
    if (path === "/messages") {
      const from = (url.searchParams.get("q") ?? "").match(/from:(\S+)/)?.[1] ?? "";
      const ids = Object.values(MAILBOX)
        .filter((message) => from && message.payload?.headers?.some((h) => h.name === "From" && h.value.includes(from)))
        .map((message) => ({ id: message.id, threadId: message.threadId }));
      return json(200, ids.length > 0 ? { messages: ids } : {});
    }
    if (path.startsWith("/messages/")) {
      const message = MAILBOX[decodeURIComponent(path.slice("/messages/".length))];
      return message ? json(200, message) : json(404, { error: { code: 404 } });
    }

    throw new Error(`Unexpected Google request: ${url}`);
  });

  return requests;
}

// ── The tests ───────────────────────────────────────────────────────────────

describe("undoing a dismissal and getting the person back", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  async function messageIds(): Promise<string[]> {
    const { data, error } = await aliceClient.from("gmail_messages").select("gmail_message_id").order("gmail_message_id");
    if (error) throw error;
    return data.map((row) => row.gmail_message_id);
  }

  async function contactWith(email: string) {
    const { data, error } = await aliceClient
      .from("contact_emails")
      .select("contact_id, contacts(first_name, last_name, source)")
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Dismiss the contact with this address, the way the contact page does. */
  async function dismissContactWith(email: string) {
    const contact = await contactWith(email);
    const { error } = await aliceClient.rpc("dismiss_contact", {
      p_user_id: alice.id,
      p_contact_id: contact!.contact_id,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const account = await aliceClient.from("google_accounts").insert({
      user_id: alice.id,
      email: OWN_EMAIL,
      refresh_token_encrypted: encrypt("fake-refresh-token"),
    });
    if (account.error) throw account.error;

    // Karin: both ways. Sara: only wrote. Test: added by hand, no mail at all.
    const messages = await aliceClient.from("gmail_messages").insert([
      row("karin-1", "karin@example.se", "inbound", 1, "Karin Lindqvist"),
      row("karin-out", OWN_EMAIL, "outbound", 2, null, ["karin@example.se"]),
      row("karin-2", "karin@example.se", "inbound", 3, "Karin Lindqvist"),
      row("sara-1", "sara@example.se", "inbound", 6, "Sara Berg"),
    ]);
    if (messages.error) throw messages.error;

    expect(await importContacts(aliceClient, alice.id)).toBe(1);
    const sara = await aliceClient.rpc("add_seen_once_contacts", { p_user_id: alice.id, p_emails: ["sara@example.se"] });
    if (sara.error) throw sara.error;
    const test = await aliceClient.rpc("save_contact", {
      p_user_id: alice.id,
      p_contact_id: null,
      p_contact: { first_name: "Test", tags: [] },
      p_emails: ["test@test.test"],
    });
    if (test.error) throw test.error;

    await dismissContactWith("karin@example.se");
    await dismissContactWith("sara@example.se");
    await dismissContactWith("test@test.test");
    expect(await messageIds()).toEqual(["karin-out"]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  function row(id: string, from: string, direction: string, day: number, name: string | null, to = [OWN_EMAIL]) {
    return {
      user_id: alice.id,
      gmail_message_id: id,
      thread_id: `thread-${id}`,
      internal_date: `2026-09-${String(day).padStart(2, "0")}T09:00:00Z`,
      from_email: from,
      from_name: name,
      to_emails: to,
      cc_emails: [],
      direction,
      has_list_unsubscribe: false,
      subject: null,
    };
  }

  describe("readBackMailFrom", () => {
    it("reads nothing for Bob asking about Alice: he can't see her Gmail connection", async () => {
      const requests = installFakeGoogle();
      expect(await readBackMailFrom(bobClient, alice.id, "karin@example.se", OPTIONS)).toEqual({ status: "not_connected" });
      expect(requests).toEqual([]);
    });

    it("refuses an address that would add search words to the Gmail query", async () => {
      installFakeGoogle();
      await expect(readBackMailFrom(aliceClient, alice.id, "karin@example.se OR in:anywhere", OPTIONS)).rejects.toThrow();
    });

    it("says needs_reconnect, and reads nothing, when Google refuses the key", async () => {
      const requests = installFakeGoogle({ tokenError: "invalid_grant" });
      expect(await readBackMailFrom(aliceClient, alice.id, "karin@example.se", OPTIONS)).toEqual({ status: "needs_reconnect" });
      expect(requests.filter((url) => url.hostname === "gmail.googleapis.com")).toEqual([]);
      expect(await messageIds()).toEqual(["karin-out"]);
    });

    it("stores only her own mail from the window, filtered like the sync", async () => {
      const requests = installFakeGoogle();
      expect(await readBackMailFrom(aliceClient, alice.id, "Karin@Example.se", OPTIONS)).toEqual({ status: "read", stored: 2 });

      const list = requests.find((url) => url.pathname.endsWith("/messages"))!;
      expect(list.searchParams.get("q")).toBe("newer_than:90d from:karin@example.se");

      // Not the lookalike, not the newsletter.
      expect(await messageIds()).toEqual(["karin-1", "karin-2", "karin-out"]);
    });

    it("reading twice stores no copies", async () => {
      installFakeGoogle();
      await readBackMailFrom(aliceClient, alice.id, "karin@example.se", OPTIONS);
      expect(await messageIds()).toEqual(["karin-1", "karin-2", "karin-out"]);
    });
  });

  describe("addAddressAsContact, after the undo and the read-back", () => {
    it("mail both ways: a Gmail contact with the name from her mail", async () => {
      expect(await undoDismissal(aliceClient, alice.id, "karin@example.se")).toBe(true);

      const id = await addAddressAsContact(aliceClient, alice.id, "karin@example.se");
      expect(await contactWith("karin@example.se")).toEqual({
        contact_id: id,
        contacts: { first_name: "Karin", last_name: "Lindqvist", source: "gmail" },
      });
    });

    it("mail one way: a contact through Seen once's path", async () => {
      installFakeGoogle();
      expect(await undoDismissal(aliceClient, alice.id, "sara@example.se")).toBe(true);
      expect(await readBackMailFrom(aliceClient, alice.id, "sara@example.se", OPTIONS)).toEqual({ status: "read", stored: 1 });

      await addAddressAsContact(aliceClient, alice.id, "sara@example.se");
      expect((await contactWith("sara@example.se"))?.contacts).toEqual({ first_name: "Sara", last_name: "Berg", source: "gmail" });
    });

    it("no mail at all: a contact with just the address", async () => {
      installFakeGoogle();
      expect(await undoDismissal(aliceClient, alice.id, "test@test.test")).toBe(true);
      expect(await readBackMailFrom(aliceClient, alice.id, "test@test.test", OPTIONS)).toEqual({ status: "read", stored: 0 });

      await addAddressAsContact(aliceClient, alice.id, "test@test.test");
      expect((await contactWith("test@test.test"))?.contacts).toEqual({ first_name: null, last_name: null, source: "manual" });
    });

    it("an address that's already a contact: that contact, nothing new", async () => {
      const before = await contactWith("test@test.test");
      expect(await addAddressAsContact(aliceClient, alice.id, "test@test.test")).toBe(before!.contact_id);

      const { data } = await aliceClient.from("contacts").select("id");
      expect(data).toHaveLength(3);
    });

    it("Bob can't create a contact in Alice's name", async () => {
      await expect(addAddressAsContact(bobClient, alice.id, "someone@example.se")).rejects.toThrow();

      const { data } = await aliceClient.from("contacts").select("id");
      expect(data).toHaveLength(3);
    });
  });
});
