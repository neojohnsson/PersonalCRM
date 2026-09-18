import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  NoThreadToReplyTo,
  buildReferences,
  headerValue,
  latestThreadOf,
  loadReplyContext,
  replySubject,
  replyThreadText,
} from "@/lib/ai/reply";
import type { ThreadItem } from "@/lib/ai/thread";

/**
 * What a reply needs: the right thread, the right recipient, and the headers
 * that keep it in the same conversation.
 */

describe("reply headers", () => {
  it("reads a header whatever its case, and trims it", () => {
    const headers = [{ name: "message-id", value: " <abc@mail.gmail.com> " }];
    expect(headerValue(headers, "Message-ID")).toBe("<abc@mail.gmail.com>");
    expect(headerValue(headers, "References")).toBeNull();
    expect(headerValue(undefined, "Subject")).toBeNull();
  });

  it("prefixes the subject with Re: once", () => {
    expect(replySubject("Examensarbete")).toBe("Re: Examensarbete");
    expect(replySubject("Re: Examensarbete")).toBe("Re: Examensarbete");
    expect(replySubject("RE:Examensarbete")).toBe("RE:Examensarbete");
    expect(replySubject(null)).toBe("Re:");
  });

  it("builds References from the thread so far plus the answered message", () => {
    expect(buildReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
    expect(buildReferences("<a@x> <b@x>", "<b@x>")).toBe("<a@x> <b@x>");
    expect(buildReferences(null, "<c@x>")).toBe("<c@x>");
    expect(buildReferences("not-an-id", null)).toBeNull();
  });
});

describe("latestThreadOf", () => {
  const touch = (thread: string, day: number): ThreadItem => ({
    messageId: `${thread}-${day}`,
    threadId: thread,
    from: day % 2 ? "them" : "you",
    who: null,
    at: new Date(Date.UTC(2026, 8, day)),
    subject: thread,
  });

  it("takes the thread of the newest message, oldest first", () => {
    const touches = [touch("old", 1), touch("new", 9), touch("old", 3), touch("new", 5)];
    expect(latestThreadOf(touches).map((t) => t.messageId)).toEqual(["new-5", "new-9"]);
    expect(latestThreadOf([])).toEqual([]);
  });
});

// ── Against the database, with a fake Gmail ─────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const TOKEN = "ya29.fake";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const b64 = (text: string) => Buffer.from(text).toString("base64url");

/** Gmail's reply for each message id: text, and the headers a reply needs. */
const MESSAGES: Record<string, { text: string; headers: { name: string; value: string }[] }> = {
  "m-1": {
    text: "Hej Karin! Jag undrar om ni tar emot examensarbetare.",
    headers: [
      { name: "Subject", value: "Examensarbete" },
      { name: "Message-ID", value: "<first@mail.gmail.com>" },
    ],
  },
  "m-2": {
    text: "Hej Neo, det gör vi. Hör av dig i oktober.\n\n-- \nKarin",
    headers: [
      { name: "Subject", value: "Re: Examensarbete" },
      { name: "Message-ID", value: "<second@fortnox.se>" },
      { name: "References", value: "<first@mail.gmail.com>" },
      { name: "From", value: "Karin Lindqvist <Karin@Fortnox.se>" },
    ],
  },
  "other-1": { text: "Older thread", headers: [{ name: "Subject", value: "Gammalt" }] },
};

function fakeGmail() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://gmail.googleapis.com/")) return realFetch(input, init);
      const id = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
      const message = MESSAGES[id] ?? { text: "", headers: [] };
      return Response.json({
        id,
        threadId: "t1",
        internalDate: "0",
        payload: { mimeType: "text/plain", headers: message.headers, body: { data: b64(message.text) } },
      });
    }),
  );
}

describe("loadReplyContext", () => {
  let alice: User;
  let db: SupabaseClient;
  let karinId: string;
  let nilsId: string;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `reply-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    alice = data.user;
    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await db.auth.signInWithPassword({ email: alice.email!, password: PASSWORD });
    if (signInError) throw signInError;

    const { data: contacts, error: contactsError } = await db
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Karin", source: "gmail" },
        { user_id: alice.id, first_name: "Nils", source: "manual" },
      ])
      .select("id, first_name");
    if (contactsError) throw contactsError;
    karinId = contacts.find((c) => c.first_name === "Karin")!.id;
    nilsId = contacts.find((c) => c.first_name === "Nils")!.id;

    const { error: emailError } = await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true });
    if (emailError) throw emailError;

    const base = { user_id: alice.id, cc_emails: [], has_list_unsubscribe: false };
    const { error: messagesError } = await db.from("gmail_messages").insert([
      // An older thread, which must not be the one replied to.
      {
        ...base,
        gmail_message_id: "other-1",
        thread_id: "t-old",
        internal_date: "2026-08-01T09:00:00Z",
        from_email: "alice@example.se",
        to_emails: ["karin@fortnox.se"],
        direction: "outbound",
        subject: "Gammalt",
      },
      {
        ...base,
        gmail_message_id: "m-1",
        thread_id: "t1",
        internal_date: "2026-09-01T09:00:00Z",
        from_email: "alice@example.se",
        to_emails: ["karin@fortnox.se"],
        direction: "outbound",
        subject: "Examensarbete",
      },
      {
        ...base,
        gmail_message_id: "m-2",
        thread_id: "t1",
        internal_date: "2026-09-02T09:00:00Z",
        from_email: "karin@fortnox.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Re: Examensarbete",
      },
    ]);
    if (messagesError) throw messagesError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the latest thread, its text, and the headers that keep a reply in it", async () => {
    fakeGmail();
    const context = await loadReplyContext(db, alice.id, karinId, TOKEN);

    expect(context.threadId).toBe("t1");
    expect(context.to).toBe("karin@fortnox.se");
    expect(context.subject).toBe("Re: Examensarbete");
    expect(context.inReplyTo).toBe("<second@fortnox.se>");
    expect(context.references).toBe("<first@mail.gmail.com> <second@fortnox.se>");
    expect(context.lastFrom).toBe("them");

    // Oldest first, signatures cut, and nothing from the older thread.
    expect(context.messages.map((m) => [m.ref, m.from, m.text])).toEqual([
      ["m1", "you", "Hej Karin! Jag undrar om ni tar emot examensarbetare."],
      ["m2", "them", "Hej Neo, det gör vi. Hör av dig i oktober."],
    ]);
    expect(replyThreadText(context)).toContain("[m2] 2026-09-02 · from them");
  });

  it("uses the address they wrote from, whatever its case", async () => {
    fakeGmail();
    const context = await loadReplyContext(db, alice.id, karinId, TOKEN);
    // The From header says "Karin@Fortnox.se"; a reply goes to it lowercased.
    expect(context.to).toBe("karin@fortnox.se");
  });

  it("reads only the newest messages when a thread is long", async () => {
    fakeGmail();
    const context = await loadReplyContext(db, alice.id, karinId, TOKEN, { limit: 1 });
    expect(context.messages.map((m) => m.messageId)).toEqual(["m-2"]);
  });

  it("refuses a contact with no mail", async () => {
    fakeGmail();
    await expect(loadReplyContext(db, alice.id, nilsId, TOKEN)).rejects.toBeInstanceOf(NoThreadToReplyTo);
  });
});
