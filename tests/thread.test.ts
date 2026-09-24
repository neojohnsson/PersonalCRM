import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestThread, loadThreadMessages, writerOf } from "@/lib/ai/thread";

/**
 * Reading a contact's threads whole — the real case this came from: you write
 * to Carl-Johan, he replies and copies in Pontus, and Pontus answers. A
 * summary that sees only your own message says "you are waiting for a reply".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("writerOf", () => {
  it("names anyone who isn't you or the contact", () => {
    expect(writerOf({ from: "you", who: null })).toBe("you");
    expect(writerOf({ from: "them", who: null })).toBe("them");
    expect(writerOf({ from: "other", who: "Pontus Berglund" })).toBe("Pontus Berglund");
    expect(writerOf({ from: "other", who: null })).toBe("someone else");
  });
});

describe("latestThread", () => {
  const item = (threadId: string, day: number) => ({
    messageId: `${threadId}-${day}`,
    threadId,
    at: new Date(Date.UTC(2026, 8, day)),
    subject: null,
    from: "you" as const,
    who: null,
    to: [],
    cc: [],
  });

  it("is the thread holding the newest message", () => {
    expect(latestThread([item("a", 1), item("b", 9), item("a", 3)]).map((i) => i.threadId)).toEqual(["b"]);
    expect(latestThread([])).toEqual([]);
  });
});

describe("loadThreadMessages", () => {
  let alice: User;
  let bob: User;
  let db: SupabaseClient;
  let bobDb: SupabaseClient;
  let carlId: string;
  let loneId: string;

  beforeAll(async () => {
    const users: User[] = [];
    for (const label of ["alice", "bob"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `thread-${label}-${randomUUID()}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      users.push(data.user);
    }
    [alice, bob] = users;

    const signIn = async (email: string) => {
      const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw error;
      return client;
    };
    db = await signIn(alice.email!);
    bobDb = await signIn(bob.email!);

    const { data: contacts, error } = await db
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Carl-Johan", last_name: "Hultenheim", source: "gmail" },
        { user_id: alice.id, first_name: "Lone", source: "manual" },
      ])
      .select("id, first_name");
    if (error) throw error;
    carlId = contacts.find((c) => c.first_name === "Carl-Johan")!.id;
    loneId = contacts.find((c) => c.first_name === "Lone")!.id;

    await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: carlId, email: "carl-johan@atea.se", is_primary: true });

    const base = { user_id: alice.id, cc_emails: [], has_list_unsubscribe: false };
    const { error: messagesError } = await db.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "t-1",
        thread_id: "thread-atea",
        internal_date: "2026-09-10T09:00:00Z",
        from_email: "alice@example.se",
        to_emails: ["carl-johan@atea.se"],
        direction: "outbound",
        subject: "Kort fråga",
      },
      {
        ...base,
        gmail_message_id: "t-2",
        thread_id: "thread-atea",
        internal_date: "2026-09-10T10:00:00Z",
        from_email: "carl-johan@atea.se",
        from_name: "Carl-Johan Hultenheim",
        to_emails: ["alice@example.se"],
        cc_emails: ["pontus.berglund@atea.se"],
        direction: "inbound",
        subject: "Re: Kort fråga",
      },
      {
        ...base,
        gmail_message_id: "t-3",
        thread_id: "thread-atea",
        internal_date: "2026-09-10T11:00:00Z",
        from_email: "pontus.berglund@atea.se",
        from_name: "Pontus Berglund",
        to_emails: ["alice@example.se", "carl-johan@atea.se"],
        direction: "inbound",
        subject: "Re: Kort fråga",
      },
      // Another thread, with nobody the contact knows: must not be mixed in.
      {
        ...base,
        gmail_message_id: "u-1",
        thread_id: "thread-other",
        internal_date: "2026-09-11T09:00:00Z",
        from_email: "someone@else.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Annat",
      },
    ]);
    if (messagesError) throw messagesError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("reads the whole thread, labelling who wrote each message", async () => {
    const items = await loadThreadMessages(db, alice.id, carlId);

    expect(items.map((item) => [item.messageId, item.from, item.who])).toEqual([
      ["t-1", "you", null],
      ["t-2", "them", null],
      // The third person is named from the header already synced.
      ["t-3", "other", "Pontus Berglund"],
    ]);
  });

  it("leaves out threads the contact isn't in", async () => {
    const items = await loadThreadMessages(db, alice.id, carlId);
    expect(items.some((item) => item.threadId === "thread-other")).toBe(false);
  });

  it("finds nothing for a contact with no mail, and nothing of Alice's for Bob", async () => {
    expect(await loadThreadMessages(db, alice.id, loneId)).toEqual([]);
    expect(await loadThreadMessages(bobDb, alice.id, carlId)).toEqual([]);
  });
});
