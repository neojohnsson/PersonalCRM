import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ilikePattern } from "@/lib/contacts/search";

/**
 * The contact_list view (migration 0006): one row per contact, with its
 * addresses, activity across all of them, and a search text — and nothing of
 * anyone else's.
 *
 * Fails until supabase/migrations/0006_contact_list.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `list-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe("contact_list", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;
  let nilsId: string;

  async function search(text: string): Promise<string[]> {
    const { data, error } = await aliceClient
      .from("contact_list")
      .select("id")
      .ilike("search_text", ilikePattern(text));
    if (error) throw error;
    return data.map((row) => row.id);
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    // Karin: two addresses (work, primary; and Gmail), mail with both.
    const { data: karin, error: karinError } = await aliceClient
      .from("contacts")
      .insert({
        user_id: alice.id,
        first_name: "Karin",
        last_name: "Lindqvist",
        company: "Fortnox",
        role: "Utvecklingschef",
        tags: ["växjö", "thesis"],
        source: "gmail",
      })
      .select("id")
      .single();
    if (karinError) throw karinError;
    karinId = karin.id;

    // Nils: added by hand, no address, no mail.
    const { data: nils, error: nilsError } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Nils", source: "manual" })
      .select("id")
      .single();
    if (nilsError) throw nilsError;
    nilsId = nils.id;

    // Both rows spell out is_primary: when one insert carries several rows,
    // a column one row leaves out is sent as null, not as its default.
    const { error: emailsError } = await aliceClient.from("contact_emails").insert([
      { user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true },
      { user_id: alice.id, contact_id: karinId, email: "karin.l@gmail.com", is_primary: false },
    ]);
    if (emailsError) throw emailsError;

    const base = { user_id: alice.id, cc_emails: [], has_list_unsubscribe: false };
    const { error: messagesError } = await aliceClient.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "work-in",
        thread_id: "t1",
        internal_date: "2026-09-01T09:00:00Z",
        from_email: "karin@fortnox.se",
        from_name: "Karin Lindqvist",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Examensarbete",
      },
      {
        ...base,
        gmail_message_id: "gmail-out",
        thread_id: "t2",
        internal_date: "2026-09-05T09:00:00Z",
        from_email: "alice@example.se",
        from_name: null,
        to_emails: ["karin.l@gmail.com"],
        direction: "outbound",
        subject: "Hej igen",
      },
    ]);
    if (messagesError) throw messagesError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("gives each contact its addresses and activity across all of them", async () => {
    const { data, error } = await aliceClient
      .from("contact_list")
      .select("id, first_name, company, primary_email, emails, message_count, last_contact_at")
      .order("last_contact_at", { ascending: false, nullsFirst: false });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);

    const [karin, nils] = data!;

    expect(karin).toMatchObject({
      id: karinId,
      first_name: "Karin",
      company: "Fortnox",
      primary_email: "karin@fortnox.se",
      emails: ["karin@fortnox.se", "karin.l@gmail.com"],
      message_count: 2,
    });
    expect(new Date(karin.last_contact_at).toISOString()).toBe("2026-09-05T09:00:00.000Z");

    // Most recent contact first, a contact never written to last.
    expect(nils).toMatchObject({
      id: nilsId,
      primary_email: null,
      emails: [],
      message_count: 0,
      last_contact_at: null,
    });
  });

  it("puts name, company, role, tags and every address into one lowercase search text", async () => {
    const { data } = await aliceClient
      .from("contact_list")
      .select("search_text")
      .eq("id", karinId)
      .single();

    expect(data!.search_text).toBe(
      "karin lindqvist fortnox utvecklingschef växjö thesis karin@fortnox.se karin.l@gmail.com",
    );
  });

  it("finds a contact by any part of it, whatever case is typed", async () => {
    expect(await search("LINDQVIST")).toEqual([karinId]);
    expect(await search("karin lind")).toEqual([karinId]);
    expect(await search("fortnox")).toEqual([karinId]);
    expect(await search("gmail.com")).toEqual([karinId]);
    expect(await search("Växjö")).toEqual([karinId]);
    expect(await search("nils")).toEqual([nilsId]);
  });

  it("treats % and _ in a search as the characters themselves", async () => {
    expect(await search("%")).toEqual([]);
    expect(await search("_")).toEqual([]);
  });

  it("does not show a user someone else's contacts", async () => {
    const { data: all, error } = await bobClient.from("contact_list").select("*");
    expect(error).toBeNull();
    expect(all).toEqual([]);

    const { data: targeted } = await bobClient
      .from("contact_list")
      .select("id")
      .eq("user_id", alice.id);
    expect(targeted).toEqual([]);
  });

  it("does not let a signed-out visitor read anything", async () => {
    const { data } = await anonClient().from("contact_list").select("*");
    expect(data ?? []).toEqual([]);
  });
});
