import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MAIL, loadRelationships } from "@/lib/relationship/load";

/**
 * Loading whose turn and warmth for every contact, as a signed-in user, against
 * the real database — including reading page by page.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const NOW = new Date("2026-09-16T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `load-${label}-${randomUUID()}@example.com`,
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

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

describe("loadRelationships", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;
  let nilsId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: contacts, error } = await aliceClient
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Karin", source: "gmail" },
        { user_id: alice.id, first_name: "Nils", source: "manual" },
      ])
      .select("id, first_name");
    if (error) throw error;
    karinId = contacts.find((c) => c.first_name === "Karin")!.id;
    nilsId = contacts.find((c) => c.first_name === "Nils")!.id;

    const { error: emailsError } = await aliceClient.from("contact_emails").insert([
      { user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true },
      { user_id: alice.id, contact_id: karinId, email: "karin.l@gmail.com", is_primary: false },
    ]);
    if (emailsError) throw emailsError;

    const base = { user_id: alice.id, cc_emails: [] as string[], has_list_unsubscribe: false, subject: "Hej" };
    const { error: messagesError } = await aliceClient.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "to-gmail",
        thread_id: "t1",
        internal_date: daysAgo(10),
        from_email: "alice@example.se",
        to_emails: ["karin.l@gmail.com"],
        direction: "outbound",
      },
      {
        ...base,
        gmail_message_id: "from-work",
        thread_id: "t1",
        internal_date: daysAgo(6),
        from_email: "karin@fortnox.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Re: Hej",
      },
      {
        ...base,
        gmail_message_id: "stranger",
        thread_id: "t9",
        internal_date: daysAgo(1),
        from_email: "someone@else.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
      },
    ]);
    if (messagesError) throw messagesError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("works out whose turn and warmth per contact, across all their addresses", async () => {
    const relationships = await loadRelationships(aliceClient, alice.id, { now: NOW });

    const karin = relationships.get(karinId)!;
    expect(karin.messageCount).toBe(2);
    expect(karin.turn).toMatchObject({ kind: "yours", days: 6, subject: "Re: Hej" });
    expect(karin.warmth?.signals.replyRate).toEqual({ answered: 1, sent: 1 });

    // Nils has no mail, and the stranger isn't a contact at all.
    expect(relationships.has(nilsId)).toBe(false);
    expect(relationships.size).toBe(1);
    expect(NO_MAIL.turn).toEqual({ kind: "none" });
  });

  it("gives the same answer when reading one row per page", async () => {
    const all = await loadRelationships(aliceClient, alice.id, { now: NOW });
    const paged = await loadRelationships(aliceClient, alice.id, { now: NOW, pageSize: 1 });

    expect(paged).toEqual(all);
  });

  it("finds nothing when someone else asks for Alice's contacts", async () => {
    const relationships = await loadRelationships(bobClient, alice.id, { now: NOW });
    expect(relationships.size).toBe(0);
  });
});
