import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Slice 2's tables and the tier view, with two real users.
 *
 * Neither may read, change, delete or forge the other's contacts, addresses or
 * dismissals — including hanging an address off someone else's contact. And
 * person_tiers must sort Alice's mail into contact / seen once, leaving out her
 * own addresses and anyone she dismissed.
 *
 * Fails until supabase/migrations/0004_contacts.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

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
    email: `rls-${label}-${randomUUID()}@example.com`,
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

describe("RLS: contacts, contact emails, dismissals and person tiers", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let aliceContactId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);
  });

  afterAll(async () => {
    // Deleting the users cascades to every row in every table.
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  describe("contacts", () => {
    it("lets a user create and read their own contact", async () => {
      const { data, error } = await aliceClient
        .from("contacts")
        .insert({ user_id: alice.id, first_name: "Karin", last_name: "Lindqvist", source: "gmail" })
        .select("id")
        .single();

      expect(error).toBeNull();
      aliceContactId = data!.id;

      const { data: rows } = await aliceClient.from("contacts").select("first_name");
      expect(rows).toEqual([{ first_name: "Karin" }]);
    });

    it("only accepts gmail or manual as the source", async () => {
      const { error } = await aliceClient
        .from("contacts")
        .insert({ user_id: alice.id, first_name: "X", source: "linkedin" });

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("does not let a user read someone else's contacts", async () => {
      const { data, error } = await bobClient.from("contacts").select("*");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("does not let a user change someone else's contact", async () => {
      const { data } = await bobClient
        .from("contacts")
        .update({ notes: "attacker" })
        .eq("id", aliceContactId)
        .select();
      expect(data).toEqual([]);

      const { data: row } = await aliceClient
        .from("contacts")
        .select("notes")
        .eq("id", aliceContactId)
        .single();
      expect(row!.notes).toBeNull();
    });

    it("does not let a user hand their own contact to someone else", async () => {
      const { data: own } = await bobClient
        .from("contacts")
        .insert({ user_id: bob.id, first_name: "Bob's", source: "manual" })
        .select("id")
        .single();

      const { error } = await bobClient
        .from("contacts")
        .update({ user_id: alice.id })
        .eq("id", own!.id);

      // WITH CHECK refuses the new owner.
      expect(error).not.toBeNull();
    });

    it("does not let a user delete someone else's contact", async () => {
      await bobClient.from("contacts").delete().eq("id", aliceContactId);

      const { data } = await aliceClient.from("contacts").select("id").eq("id", aliceContactId);
      expect(data).toHaveLength(1);
    });

    it("does not let a user create a contact owned by someone else", async () => {
      const { error } = await bobClient
        .from("contacts")
        .insert({ user_id: alice.id, first_name: "Forged", source: "manual" });

      expect(error).not.toBeNull();
    });
  });

  describe("contact_emails", () => {
    it("lets a user add a primary address to their own contact", async () => {
      const { error } = await aliceClient.from("contact_emails").insert({
        user_id: alice.id,
        contact_id: aliceContactId,
        email: "karin@example.se",
        is_primary: true,
      });

      expect(error).toBeNull();
    });

    it("stores addresses lowercased only", async () => {
      const { error } = await aliceClient.from("contact_emails").insert({
        user_id: alice.id,
        contact_id: aliceContactId,
        email: "Karin.Work@Example.se",
      });

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("allows only one primary address per contact", async () => {
      const { error } = await aliceClient.from("contact_emails").insert({
        user_id: alice.id,
        contact_id: aliceContactId,
        email: "karin.work@example.se",
        is_primary: true,
      });

      expect(error?.code).toBe(UNIQUE_VIOLATION);
    });

    it("gives an address to at most one of a user's contacts", async () => {
      const { data: other } = await aliceClient
        .from("contacts")
        .insert({ user_id: alice.id, first_name: "Other", source: "manual" })
        .select("id")
        .single();

      const { error } = await aliceClient.from("contact_emails").insert({
        user_id: alice.id,
        contact_id: other!.id,
        email: "karin@example.se",
      });

      expect(error?.code).toBe(UNIQUE_VIOLATION);
    });

    it("lets two users each have the same address in their own CRM", async () => {
      const { data: bobsKarin } = await bobClient
        .from("contacts")
        .insert({ user_id: bob.id, first_name: "Karin", source: "manual" })
        .select("id")
        .single();

      const { error } = await bobClient.from("contact_emails").insert({
        user_id: bob.id,
        contact_id: bobsKarin!.id,
        email: "karin@example.se",
      });

      expect(error).toBeNull();
    });

    it("does not let a user hang their address off someone else's contact", async () => {
      // Bob's own user_id passes the policy — the foreign key on
      // (contact_id, user_id) is what refuses it.
      const { error } = await bobClient.from("contact_emails").insert({
        user_id: bob.id,
        contact_id: aliceContactId,
        email: "attacker@example.se",
      });

      expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("does not let a user read someone else's addresses", async () => {
      const { data } = await bobClient
        .from("contact_emails")
        .select("email")
        .eq("contact_id", aliceContactId);

      expect(data).toEqual([]);
    });

    it("does not let a user change or delete someone else's addresses", async () => {
      const { data: changed } = await bobClient
        .from("contact_emails")
        .update({ email: "attacker@example.se" })
        .eq("contact_id", aliceContactId)
        .select();
      expect(changed).toEqual([]);

      await bobClient.from("contact_emails").delete().eq("contact_id", aliceContactId);

      const { data } = await aliceClient
        .from("contact_emails")
        .select("email")
        .eq("contact_id", aliceContactId);
      expect(data).toEqual([{ email: "karin@example.se" }]);
    });
  });

  describe("seen_once_dismissals", () => {
    it("lets a user dismiss someone, and read their own dismissals", async () => {
      const { error } = await aliceClient
        .from("seen_once_dismissals")
        .insert({ user_id: alice.id, email: "sara@example.se" });
      expect(error).toBeNull();

      const { data } = await aliceClient.from("seen_once_dismissals").select("email");
      expect(data).toEqual([{ email: "sara@example.se" }]);
    });

    it("does not let anyone change a dismissal — there is no update policy", async () => {
      const { data } = await aliceClient
        .from("seen_once_dismissals")
        .update({ email: "someone.else@example.se" })
        .eq("email", "sara@example.se")
        .select();

      expect(data).toEqual([]);
    });

    it("does not let a user read, forge or undo someone else's dismissals", async () => {
      const { data: read } = await bobClient.from("seen_once_dismissals").select("*");
      expect(read).toEqual([]);

      const { error: forged } = await bobClient
        .from("seen_once_dismissals")
        .insert({ user_id: alice.id, email: "forged@example.se" });
      expect(forged).not.toBeNull();

      await bobClient.from("seen_once_dismissals").delete().eq("user_id", alice.id);
      const { data } = await aliceClient.from("seen_once_dismissals").select("email");
      expect(data).toHaveLength(1);
    });
  });

  describe("person_tiers", () => {
    beforeAll(async () => {
      const base = { user_id: alice.id, cc_emails: [] as string[], has_list_unsubscribe: false };

      const { error } = await aliceClient.from("gmail_messages").insert([
        // Karin: both ways → contact (she already has a contact record).
        {
          ...base,
          gmail_message_id: "k1",
          thread_id: "tk",
          internal_date: "2026-09-01T09:00:00Z",
          from_email: "karin@example.se",
          from_name: "Karin Lindqvist",
          to_emails: ["alice@example.se"],
          direction: "inbound",
          subject: "Examensarbete",
        },
        {
          ...base,
          gmail_message_id: "k2",
          thread_id: "tk",
          internal_date: "2026-09-02T09:00:00Z",
          from_email: "alice@example.se",
          to_emails: ["karin@example.se"],
          direction: "outbound",
          subject: "Re: Examensarbete",
        },
        // Johan: only wrote to Alice → seen once.
        {
          ...base,
          gmail_message_id: "j1",
          thread_id: "tj",
          internal_date: "2026-09-03T09:00:00Z",
          from_email: "johan@example.se",
          from_name: "Johan Ek",
          to_emails: ["alice@example.se"],
          direction: "inbound",
          subject: "Fråga om examensarbete",
        },
        // Elin: Alice wrote, no reply → seen once. Sent from Alice's alias.
        {
          ...base,
          gmail_message_id: "e1",
          thread_id: "te",
          internal_date: "2026-09-04T09:00:00Z",
          from_email: "alice.alias@example.se",
          to_emails: ["elin@example.se", "alice.alias@example.se"],
          direction: "outbound",
          subject: "Hej Elin",
        },
        // Sara: only wrote — but Alice dismissed her above → left out.
        {
          ...base,
          gmail_message_id: "s1",
          thread_id: "ts",
          internal_date: "2026-09-05T09:00:00Z",
          from_email: "sara@example.se",
          to_emails: ["alice@example.se"],
          direction: "inbound",
          subject: "Nyhetsbrev",
        },
      ]);
      if (error) throw error;
    });

    it("sorts people into tiers, and leaves out Alice's own addresses and dismissed people", async () => {
      const { data, error } = await aliceClient
        .from("person_tiers")
        .select("email, tier, contact_id, last_subject, last_thread_id")
        .order("email");

      expect(error).toBeNull();
      expect(data).toEqual([
        {
          email: "elin@example.se",
          tier: "seen_once",
          contact_id: null,
          last_subject: "Hej Elin",
          last_thread_id: "te",
        },
        {
          email: "johan@example.se",
          tier: "seen_once",
          contact_id: null,
          last_subject: "Fråga om examensarbete",
          last_thread_id: "tj",
        },
        {
          email: "karin@example.se",
          tier: "contact",
          contact_id: aliceContactId,
          last_subject: "Re: Examensarbete",
          last_thread_id: "tk",
        },
      ]);
    });

    it("does not show a user someone else's tiers", async () => {
      const { data: all } = await bobClient.from("person_tiers").select("*");
      expect(all).toEqual([]);

      const { data: targeted } = await bobClient
        .from("person_tiers")
        .select("email")
        .eq("user_id", alice.id);
      expect(targeted).toEqual([]);
    });

    it("does not let a signed-out visitor read anything", async () => {
      const anon = anonClient();
      for (const table of ["contacts", "contact_emails", "seen_once_dismissals", "person_tiers"]) {
        const { data } = await anon.from(table).select("*");
        expect(data ?? [], table).toEqual([]);
      }
    });
  });
});
