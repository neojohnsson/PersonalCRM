import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * save_contact (migration 0008): the add and edit forms' save, as a signed-in
 * user — contact and addresses together, one transaction, only your own.
 *
 * Fails until supabase/migrations/0008_save_contact.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const NOT_FOUND = "P0002";

type ContactFields = Record<
  "first_name" | "last_name" | "company" | "role" | "one_liner" | "how_known" | "phone" | "notes",
  string | null
> & { tags: string[] };

// Typed, so tests can fill in text: written as plain nulls, TypeScript would
// decide every field can only ever be null.
const BLANK: ContactFields = {
  first_name: null,
  last_name: null,
  company: null,
  role: null,
  one_liner: null,
  how_known: null,
  phone: null,
  notes: null,
  tags: [],
};

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
    email: `save-${label}-${randomUUID()}@example.com`,
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

describe("save_contact", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;

  function save(
    client: SupabaseClient,
    args: {
      userId: string;
      contactId: string | null;
      contact?: Partial<typeof BLANK>;
      emails?: string[];
    },
  ) {
    return client.rpc("save_contact", {
      p_user_id: args.userId,
      p_contact_id: args.contactId,
      p_contact: { ...BLANK, ...args.contact },
      p_emails: args.emails ?? [],
    });
  }

  async function emailsOf(contactId: string) {
    const { data, error } = await aliceClient
      .from("contact_emails")
      .select("email, is_primary")
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false })
      .order("email");
    if (error) throw error;
    return data;
  }

  async function aliceContactCount(): Promise<number> {
    const { count, error } = await aliceClient
      .from("contacts")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("creates a contact added by hand, with the first address as primary", async () => {
    const { data, error } = await save(aliceClient, {
      userId: alice.id,
      contactId: null,
      contact: {
        first_name: "Karin",
        last_name: "Lindqvist",
        company: "Fortnox",
        role: "Utvecklingschef",
        tags: ["växjö", "thesis"],
        notes: "Met after the guest lecture at LNU.",
      },
      emails: ["karin@fortnox.se", "karin.l@gmail.com"],
    });

    expect(error).toBeNull();
    karinId = data as string;

    const { data: row } = await aliceClient.from("contacts").select("*").eq("id", karinId).single();
    expect(row).toMatchObject({
      user_id: alice.id,
      first_name: "Karin",
      last_name: "Lindqvist",
      company: "Fortnox",
      role: "Utvecklingschef",
      tags: ["växjö", "thesis"],
      notes: "Met after the guest lecture at LNU.",
      source: "manual",
    });

    expect(await emailsOf(karinId)).toEqual([
      { email: "karin@fortnox.se", is_primary: true },
      { email: "karin.l@gmail.com", is_primary: false },
    ]);
  });

  it("saves an edit: every field, a new primary, a removed address and an added one", async () => {
    const { data, error } = await save(aliceClient, {
      userId: alice.id,
      contactId: karinId,
      contact: { first_name: "Kaja", last_name: "Lindqvist", company: "Visma", tags: ["thesis"] },
      emails: ["karin.l@gmail.com", "karin@visma.se"],
    });

    expect(error).toBeNull();
    expect(data).toBe(karinId);

    const { data: row } = await aliceClient.from("contacts").select("*").eq("id", karinId).single();
    expect(row).toMatchObject({
      first_name: "Kaja",
      company: "Visma",
      role: null,
      notes: null,
      tags: ["thesis"],
      source: "manual",
    });
    expect(new Date(row!.updated_at).getTime()).toBeGreaterThan(new Date(row!.created_at).getTime());

    expect(await emailsOf(karinId)).toEqual([
      { email: "karin.l@gmail.com", is_primary: true },
      { email: "karin@visma.se", is_primary: false },
    ]);
  });

  it("refuses an address that belongs to another contact, says whose, and saves nothing", async () => {
    const before = await aliceContactCount();

    const { data, error } = await save(aliceClient, {
      userId: alice.id,
      contactId: null,
      contact: { first_name: "Nils" },
      emails: ["nils@example.se", "karin.l@gmail.com"],
    });

    expect(data).toBeNull();
    expect(error).toMatchObject({
      message: "address_taken",
      details: "karin.l@gmail.com",
      hint: "Kaja Lindqvist",
    });
    expect(await aliceContactCount()).toBe(before);
  });

  it("refuses the same when editing, and leaves the contact as it was", async () => {
    const { data: nils } = await save(aliceClient, {
      userId: alice.id,
      contactId: null,
      contact: { first_name: "Nils" },
      emails: ["nils@example.se"],
    });

    const { error } = await save(aliceClient, {
      userId: alice.id,
      contactId: nils as string,
      contact: { first_name: "Nils Renamed" },
      emails: ["karin@visma.se"],
    });

    expect(error?.message).toBe("address_taken");

    const { data: row } = await aliceClient.from("contacts").select("first_name").eq("id", nils).single();
    expect(row!.first_name).toBe("Nils");
    expect(await emailsOf(nils as string)).toEqual([{ email: "nils@example.se", is_primary: true }]);
  });

  it("lets a contact have no address at all", async () => {
    const { data, error } = await save(aliceClient, {
      userId: alice.id,
      contactId: null,
      contact: { first_name: "Met at an event", phone: "+46 70 123 45 67" },
      emails: [],
    });

    expect(error).toBeNull();
    expect(await emailsOf(data as string)).toEqual([]);
  });

  it("keeps an imported contact's source when it's edited", async () => {
    const { data: imported } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Johan", source: "gmail" })
      .select("id")
      .single();

    const { error } = await save(aliceClient, {
      userId: alice.id,
      contactId: imported!.id,
      contact: { first_name: "Johan", last_name: "Ek" },
    });
    expect(error).toBeNull();

    const { data: row } = await aliceClient.from("contacts").select("source, last_name").eq("id", imported!.id).single();
    expect(row).toEqual({ source: "gmail", last_name: "Ek" });
  });

  it("reports a contact that isn't the caller's as not found — whichever user id is sent", async () => {
    for (const userId of [bob.id, alice.id]) {
      const { error } = await save(bobClient, {
        userId,
        contactId: karinId,
        contact: { first_name: "Attacker" },
        emails: ["attacker@example.se"],
      });
      expect(error?.code, userId).toBe(NOT_FOUND);
    }

    const { data: row } = await aliceClient.from("contacts").select("first_name").eq("id", karinId).single();
    expect(row!.first_name).toBe("Kaja");
  });

  it("does not let someone create a contact in another user's account", async () => {
    const before = await aliceContactCount();

    const { error } = await save(bobClient, {
      userId: alice.id,
      contactId: null,
      contact: { first_name: "Forged" },
    });

    expect(error).not.toBeNull();
    expect(await aliceContactCount()).toBe(before);
  });

  it("reports an id that doesn't exist as not found", async () => {
    const { error } = await save(aliceClient, {
      userId: alice.id,
      contactId: randomUUID(),
      contact: { first_name: "Ghost" },
    });

    expect(error?.code).toBe(NOT_FOUND);
  });

  it("can't be run by a signed-out visitor", async () => {
    const { error } = await save(anonClient(), {
      userId: alice.id,
      contactId: null,
      contact: { first_name: "Anonymous" },
    });

    expect(error).not.toBeNull();
  });
});
