import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDismissals, undoDismissal } from "@/lib/contacts/dismissals";
import { importContacts } from "@/lib/sync/import-contacts";

/**
 * Dismissing a contact (migration 0012) and taking a dismissal back (the
 * delete policy of 0004), as signed-in users:
 *
 *   dismiss_contact — every address is remembered as dismissed, the mail they
 *                     sent is deleted, and the contact is deleted with
 *                     everything hanging off it. Mail Alice sent is kept.
 *   undoDismissal   — the row goes, and they're a Seen once person again
 *
 * Bob, signed in as himself, can do neither to Alice.
 *
 * Fails until supabase/migrations/0012_dismiss_contact.sql has been run.
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
    email: `dismiss-${label}-${randomUUID()}@example.com`,
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

function message(
  userId: string,
  id: string,
  fields: { from: string; to: string[]; outbound?: boolean; day: number },
) {
  return {
    user_id: userId,
    gmail_message_id: id,
    thread_id: `t-${id}`,
    internal_date: `2026-09-${String(fields.day).padStart(2, "0")}T09:00:00Z`,
    from_email: fields.from,
    from_name: null,
    to_emails: fields.to,
    cc_emails: [],
    direction: fields.outbound ? "outbound" : "inbound",
    has_list_unsubscribe: false,
    subject: `Subject ${id}`,
  };
}

describe("dismissing a contact, and undoing a dismissal", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;
  let nilsId: string;
  let olleId: string;

  async function dismiss(client: SupabaseClient, contactId: string, userId = alice.id) {
    return client.rpc("dismiss_contact", { p_user_id: userId, p_contact_id: contactId });
  }

  async function messageIds(): Promise<string[]> {
    const { data, error } = await aliceClient
      .from("gmail_messages")
      .select("gmail_message_id")
      .order("gmail_message_id");
    if (error) throw error;
    return data.map((row) => row.gmail_message_id);
  }

  async function contactIds(): Promise<string[]> {
    const { data, error } = await aliceClient.from("contacts").select("id");
    if (error) throw error;
    return data.map((row) => row.id);
  }

  async function contactIdFor(email: string): Promise<string> {
    const { data, error } = await aliceClient
      .from("contact_emails")
      .select("contact_id")
      .eq("email", email)
      .single();
    if (error) throw error;
    return data.contact_id;
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { error } = await aliceClient.from("gmail_messages").insert([
      // Karin: both ways, from two addresses.
      message(alice.id, "karin-in", { from: "karin@example.se", to: [ALICE_ADDRESS], day: 1 }),
      message(alice.id, "karin-out", { from: ALICE_ADDRESS, to: ["karin@example.se"], outbound: true, day: 2 }),
      message(alice.id, "karin-work-in", { from: "Karin@Work.example.se", to: [ALICE_ADDRESS], day: 3 }),
      // Nils: both ways. Never dismissed — he must be untouched throughout.
      message(alice.id, "nils-in", { from: "nils@example.se", to: [ALICE_ADDRESS], day: 4 }),
      message(alice.id, "nils-out", { from: ALICE_ADDRESS, to: ["nils@example.se"], outbound: true, day: 5 }),
    ]);
    if (error) throw error;

    expect(await importContacts(aliceClient, alice.id)).toBe(2);
    karinId = await contactIdFor("karin@example.se");
    nilsId = await contactIdFor("nils@example.se");

    // Karin's second address, and a next touch that should go with her.
    const extra = await aliceClient
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: karinId, email: "karin@work.example.se" });
    if (extra.error) throw extra.error;

    const touch = await aliceClient
      .from("next_touches")
      .insert({ user_id: alice.id, contact_id: karinId, due_on: "2026-10-01" });
    if (touch.error) throw touch.error;

    // Olle: added by hand, no address.
    const olle = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Olle", source: "manual" })
      .select("id")
      .single();
    if (olle.error) throw olle.error;
    olleId = olle.data.id;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  describe("dismiss_contact", () => {
    it("can't be run by a signed-out visitor", async () => {
      const { error } = await anonClient().rpc("dismiss_contact", {
        p_user_id: alice.id,
        p_contact_id: karinId,
      });
      expect(error).not.toBeNull();
      expect(await contactIds()).toContain(karinId);
    });

    it("says 'not found' when Bob asks for Alice's contact, and changes nothing", async () => {
      const { error } = await dismiss(bobClient, karinId);
      expect(error?.code).toBe("P0002");

      expect(await contactIds()).toContain(karinId);
      expect(await messageIds()).toContain("karin-in");
      expect(await listDismissals(aliceClient, alice.id)).toEqual([]);
    });

    it("says 'not found' when Bob passes his own user id with Alice's contact", async () => {
      const { error } = await dismiss(bobClient, karinId, bob.id);
      expect(error?.code).toBe("P0002");
      expect(await contactIds()).toContain(karinId);
    });

    it("refuses a contact with no address, and keeps them", async () => {
      const { error } = await dismiss(aliceClient, olleId);
      expect(error?.message).toBe("no_address");
      expect(await contactIds()).toContain(olleId);
    });

    it("remembers every address, deletes what they sent and the contact, keeps what Alice sent", async () => {
      const { data, error } = await dismiss(aliceClient, karinId);
      if (error) throw error;
      expect(data).toBe(2);

      const dismissed = await listDismissals(aliceClient, alice.id);
      expect(dismissed.map((row) => row.email).sort()).toEqual([
        "karin@example.se",
        "karin@work.example.se",
      ]);

      expect(await messageIds()).toEqual(["karin-out", "nils-in", "nils-out"]);

      expect(await contactIds()).not.toContain(karinId);
      const emails = await aliceClient.from("contact_emails").select("email").eq("contact_id", karinId);
      expect(emails.data).toEqual([]);
      const touches = await aliceClient.from("next_touches").select("id").eq("contact_id", karinId);
      expect(touches.data).toEqual([]);

      // Nils and Olle are untouched.
      expect(await contactIds()).toEqual(expect.arrayContaining([nilsId, olleId]));
    });

    it("doesn't bring her back as a new contact or into Seen once", async () => {
      expect(await importContacts(aliceClient, alice.id)).toBe(0);

      const { data } = await aliceClient
        .from("person_tiers")
        .select("email")
        .like("email", "karin%");
      expect(data).toEqual([]);
    });
  });

  describe("undoDismissal", () => {
    it("does nothing when Bob tries to undo Alice's dismissal", async () => {
      expect(await undoDismissal(bobClient, alice.id, "karin@example.se")).toBe(false);
      expect(await undoDismissal(bobClient, bob.id, "karin@example.se")).toBe(false);

      expect(await listDismissals(aliceClient, alice.id)).toHaveLength(2);
    });

    it("Bob sees none of Alice's dismissals", async () => {
      expect(await listDismissals(bobClient, alice.id)).toEqual([]);
    });

    it("deletes the row, and she's in Seen once again from the mail Alice sent her", async () => {
      expect(await undoDismissal(aliceClient, alice.id, " Karin@Example.se ")).toBe(true);

      const left = await listDismissals(aliceClient, alice.id);
      expect(left.map((row) => row.email)).toEqual(["karin@work.example.se"]);

      const { data } = await aliceClient
        .from("person_tiers")
        .select("email, tier, contact_id, sent_count, received_count")
        .eq("email", "karin@example.se")
        .single();
      expect(data).toEqual({
        email: "karin@example.se",
        tier: "seen_once",
        contact_id: null,
        sent_count: 1,
        received_count: 0,
      });
    });

    it("undoing twice is harmless", async () => {
      expect(await undoDismissal(aliceClient, alice.id, "karin@example.se")).toBe(false);
    });
  });
});
