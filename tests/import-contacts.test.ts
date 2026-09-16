import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importContacts } from "@/lib/sync/import-contacts";

/**
 * Turning two-way people into contacts (migration 0005), as a signed-in user —
 * the same way the sync does it.
 *
 * Fails until supabase/migrations/0005_import_contacts.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const ALICE_ADDRESS = "alice@example.se";

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
    email: `import-${label}-${randomUUID()}@example.com`,
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

/** One message from `email` (with `name`) and one reply to them. */
function exchange(userId: string, email: string, name: string | null, thread: string, day: number) {
  const base = { user_id: userId, thread_id: thread, cc_emails: [], has_list_unsubscribe: false };
  return [
    {
      ...base,
      gmail_message_id: `${thread}-in`,
      internal_date: `2026-09-${String(day).padStart(2, "0")}T09:00:00Z`,
      from_email: email,
      from_name: name,
      to_emails: [ALICE_ADDRESS],
      direction: "inbound",
      subject: "Hej",
    },
    {
      ...base,
      gmail_message_id: `${thread}-out`,
      internal_date: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`,
      from_email: ALICE_ADDRESS,
      from_name: null,
      to_emails: [email],
      direction: "outbound",
      subject: "Re: Hej",
    },
  ];
}

describe("import_contacts", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  async function aliceContacts() {
    const [{ data: contacts, error: contactsError }, { data: emails, error: emailsError }] =
      await Promise.all([
        aliceClient.from("contacts").select("id, first_name, last_name, source, source_thread_id, notes"),
        aliceClient.from("contact_emails").select("contact_id, email, is_primary"),
      ]);
    if (contactsError) throw contactsError;
    if (emailsError) throw emailsError;

    return {
      contacts: contacts!,
      emails: emails!,
      byEmail: Object.fromEntries(
        emails!.map((row) => [row.email, contacts!.find((contact) => contact.id === row.contact_id)]),
      ),
    };
  }

  async function removeAliceContacts() {
    const { error } = await aliceClient.from("contacts").delete().eq("user_id", alice.id);
    if (error) throw error;
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { error } = await aliceClient.from("gmail_messages").insert([
      ...exchange(alice.id, "karin@example.se", "Karin Lindqvist", "t-karin", 1),
      ...exchange(alice.id, "anna@example.se", "Anna Maria Ek", "t-anna", 2),
      ...exchange(alice.id, "pelle@example.se", "Lindqvist, Pelle", "t-pelle", 3),
      ...exchange(alice.id, "kim@example.se", "Kim", "t-kim", 4),
      ...exchange(alice.id, "noname@example.se", null, "t-noname", 5),
      // Johan only wrote — Seen once, never a contact.
      {
        user_id: alice.id,
        gmail_message_id: "t-johan-in",
        thread_id: "t-johan",
        internal_date: "2026-09-06T09:00:00Z",
        from_email: "johan@example.se",
        from_name: "Johan Ek",
        to_emails: [ALICE_ADDRESS],
        cc_emails: [],
        direction: "inbound",
        has_list_unsubscribe: false,
        subject: "Fråga",
      },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("creates a contact for everyone with mail both ways, and nobody else", async () => {
    expect(await importContacts(aliceClient, alice.id)).toBe(5);

    const { emails, byEmail } = await aliceContacts();

    expect(emails.map((row) => row.email).sort()).toEqual([
      "anna@example.se",
      "karin@example.se",
      "kim@example.se",
      "noname@example.se",
      "pelle@example.se",
    ]);
    expect(emails.every((row) => row.is_primary)).toBe(true);

    expect(byEmail["karin@example.se"]).toMatchObject({
      first_name: "Karin",
      last_name: "Lindqvist",
      source: "gmail",
      source_thread_id: "t-karin",
    });
  });

  it("splits names the way people write them in email", async () => {
    const { byEmail } = await aliceContacts();

    expect(byEmail["anna@example.se"]).toMatchObject({ first_name: "Anna Maria", last_name: "Ek" });
    expect(byEmail["pelle@example.se"]).toMatchObject({ first_name: "Pelle", last_name: "Lindqvist" });
    expect(byEmail["kim@example.se"]).toMatchObject({ first_name: "Kim", last_name: null });
    expect(byEmail["noname@example.se"]).toMatchObject({ first_name: null, last_name: null });
  });

  it("links each imported person to their contact in person_tiers", async () => {
    const { data } = await aliceClient
      .from("person_tiers")
      .select("email, tier, contact_id")
      .order("email");

    for (const row of data!) {
      if (row.tier === "contact") expect(row.contact_id, row.email).not.toBeNull();
    }
    expect(data!.find((row) => row.email === "johan@example.se")).toMatchObject({
      tier: "seen_once",
      contact_id: null,
    });
  });

  it("creates nothing the second time", async () => {
    expect(await importContacts(aliceClient, alice.id)).toBe(0);

    const { contacts } = await aliceContacts();
    expect(contacts).toHaveLength(5);
  });

  it("never changes a contact the user has edited, even when newer mail says otherwise", async () => {
    const { byEmail } = await aliceContacts();
    const karinId = byEmail["karin@example.se"]!.id;

    await aliceClient
      .from("contacts")
      .update({ first_name: "Kaja", notes: "Met after the guest lecture at LNU" })
      .eq("id", karinId);

    const { error } = await aliceClient
      .from("gmail_messages")
      .insert(exchange(alice.id, "karin@example.se", "Karin L", "t-karin-2", 20));
    if (error) throw error;

    expect(await importContacts(aliceClient, alice.id)).toBe(0);

    const { data: karin } = await aliceClient
      .from("contacts")
      .select("first_name, last_name, notes, source_thread_id")
      .eq("id", karinId)
      .single();
    expect(karin).toEqual({
      first_name: "Kaja",
      last_name: "Lindqvist",
      notes: "Met after the guest lecture at LNU",
      source_thread_id: "t-karin",
    });
  });

  it("creates each contact once, with its address, when two imports run at the same time", async () => {
    await removeAliceContacts();

    const counts = await Promise.all([
      importContacts(aliceClient, alice.id),
      importContacts(aliceClient, alice.id),
    ]);

    expect(counts[0] + counts[1]).toBe(5);

    const { contacts, emails } = await aliceContacts();
    expect(contacts).toHaveLength(5);
    expect(emails).toHaveLength(5);
  });

  it("creates nothing when someone else runs it for Alice", async () => {
    await removeAliceContacts();

    // Bob can see none of Alice's people, so there's nothing for him to import.
    expect(await importContacts(bobClient, alice.id)).toBe(0);

    const { contacts } = await aliceContacts();
    expect(contacts).toEqual([]);

    const { data: bobsOwn } = await bobClient.from("contacts").select("id");
    expect(bobsOwn).toEqual([]);
  });

  it("can't be run by a signed-out visitor", async () => {
    await expect(importContacts(anonClient(), alice.id)).rejects.toBeTruthy();
  });
});
