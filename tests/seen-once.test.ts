import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importContacts } from "@/lib/sync/import-contacts";

/**
 * The Seen once queue's two buttons (migration 0007), as a signed-in user:
 *
 *   add_seen_once_contacts — people in Seen once become contacts
 *   dismiss_seen_once      — they're remembered as dismissed, and the mail
 *                            they sent is deleted; mail sent to them is kept
 *
 * Both only ever act on people who are in Seen once right now.
 *
 * Fails until supabase/migrations/0007_seen_once_actions.sql has been run.
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
    email: `seen-${label}-${randomUUID()}@example.com`,
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
  fields: { from: string; fromName?: string | null; to: string[]; outbound?: boolean; day: number },
) {
  return {
    user_id: userId,
    gmail_message_id: id,
    thread_id: `t-${id}`,
    internal_date: `2026-09-${String(fields.day).padStart(2, "0")}T09:00:00Z`,
    from_email: fields.from,
    from_name: fields.fromName ?? null,
    to_emails: fields.to,
    cc_emails: [],
    direction: fields.outbound ? "outbound" : "inbound",
    has_list_unsubscribe: false,
    subject: `Subject ${id}`,
  };
}

describe("Seen once: add and dismiss", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  async function rpc(client: SupabaseClient, fn: string, emails: string[], userId = alice.id) {
    const { data, error } = await client.rpc(fn, { p_user_id: userId, p_emails: emails });
    if (error) throw error;
    return data as number;
  }

  async function seenOnce(): Promise<string[]> {
    const { data, error } = await aliceClient
      .from("person_tiers")
      .select("email")
      .eq("tier", "seen_once")
      .is("contact_id", null)
      .order("email");
    if (error) throw error;
    return data.map((row) => row.email);
  }

  async function messageIds(): Promise<string[]> {
    const { data, error } = await aliceClient
      .from("gmail_messages")
      .select("gmail_message_id")
      .order("gmail_message_id");
    if (error) throw error;
    return data.map((row) => row.gmail_message_id);
  }

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { error } = await aliceClient.from("gmail_messages").insert([
      // Karin: both ways → a contact once imported.
      message(alice.id, "karin-in", { from: "karin@example.se", fromName: "Karin Lindqvist", to: [ALICE_ADDRESS], day: 1 }),
      message(alice.id, "karin-out", { from: ALICE_ADDRESS, to: ["karin@example.se"], outbound: true, day: 2 }),
      // Johan: wrote twice, never answered → Seen once.
      message(alice.id, "johan-1", { from: "johan@example.se", fromName: "Johan Ek", to: [ALICE_ADDRESS], day: 3 }),
      message(alice.id, "johan-2", { from: "Johan@Example.se", fromName: "Johan Ek", to: [ALICE_ADDRESS], day: 4 }),
      // Sara: wrote once → Seen once.
      message(alice.id, "sara-1", { from: "sara@example.se", fromName: "Sara Berg", to: [ALICE_ADDRESS], day: 5 }),
      // Elin: Alice wrote, no reply → Seen once. The message also went to Karin.
      message(alice.id, "elin-out", {
        from: ALICE_ADDRESS,
        to: ["elin@example.se", "karin@example.se"],
        outbound: true,
        day: 6,
      }),
      // Mikael: wrote once → Seen once.
      message(alice.id, "mikael-1", { from: "mikael@example.se", fromName: "Lund, Mikael", to: [ALICE_ADDRESS], day: 7 }),
    ]);
    if (error) throw error;

    expect(await importContacts(aliceClient, alice.id)).toBe(1);
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("starts with everyone one-way in Seen once", async () => {
    expect(await seenOnce()).toEqual([
      "elin@example.se",
      "johan@example.se",
      "mikael@example.se",
      "sara@example.se",
    ]);
  });

  describe("add_seen_once_contacts", () => {
    it("does nothing when someone else asks for Alice", async () => {
      expect(await rpc(bobClient, "add_seen_once_contacts", ["johan@example.se"])).toBe(0);

      const { data } = await aliceClient.from("contacts").select("id");
      expect(data).toHaveLength(1);
    });

    it("makes the chosen people contacts, with their name split and their address primary", async () => {
      expect(
        await rpc(aliceClient, "add_seen_once_contacts", ["johan@example.se", "mikael@example.se"]),
      ).toBe(2);

      const { data: emails } = await aliceClient
        .from("contact_emails")
        .select("email, is_primary, contacts(first_name, last_name, source)")
        .in("email", ["johan@example.se", "mikael@example.se"])
        .order("email");

      expect(emails).toEqual([
        {
          email: "johan@example.se",
          is_primary: true,
          contacts: { first_name: "Johan", last_name: "Ek", source: "gmail" },
        },
        {
          email: "mikael@example.se",
          is_primary: true,
          contacts: { first_name: "Mikael", last_name: "Lund", source: "gmail" },
        },
      ]);

      expect(await seenOnce()).toEqual(["elin@example.se", "sara@example.se"]);
    });

    it("leaves alone addresses that aren't in Seen once", async () => {
      // Karin is already a contact; nobody@ has never written.
      expect(
        await rpc(aliceClient, "add_seen_once_contacts", ["karin@example.se", "nobody@example.se"]),
      ).toBe(0);

      const { data } = await aliceClient.from("contacts").select("id");
      expect(data).toHaveLength(3);
    });
  });

  describe("dismiss_seen_once", () => {
    it("does nothing when someone else asks for Alice", async () => {
      expect(await rpc(bobClient, "dismiss_seen_once", ["sara@example.se"])).toBe(0);

      expect(await seenOnce()).toContain("sara@example.se");
      expect(await messageIds()).toContain("sara-1");
    });

    it("remembers the dismissal, deletes what they sent, and keeps what Alice sent them", async () => {
      expect(await rpc(aliceClient, "dismiss_seen_once", ["sara@example.se", "elin@example.se"])).toBe(2);

      const { data: dismissals } = await aliceClient
        .from("seen_once_dismissals")
        .select("email")
        .order("email");
      expect(dismissals).toEqual([{ email: "elin@example.se" }, { email: "sara@example.se" }]);

      const ids = await messageIds();
      expect(ids).not.toContain("sara-1");
      expect(ids).toContain("elin-out");

      expect(await seenOnce()).toEqual([]);
    });

    it("never touches a contact — not their dismissal, not their mail", async () => {
      expect(
        await rpc(aliceClient, "dismiss_seen_once", ["karin@example.se", "johan@example.se"]),
      ).toBe(0);

      const ids = await messageIds();
      expect(ids).toEqual(expect.arrayContaining(["karin-in", "johan-1", "johan-2"]));

      const { data: dismissals } = await aliceClient.from("seen_once_dismissals").select("email");
      expect(dismissals!.map((row) => row.email)).not.toContain("karin@example.se");
    });

    it("dismissing the same person again changes nothing", async () => {
      expect(await rpc(aliceClient, "dismiss_seen_once", ["sara@example.se"])).toBe(0);
    });
  });

  it("still imports two-way people through the shared body", async () => {
    const { error } = await aliceClient.from("gmail_messages").insert([
      message(alice.id, "nils-in", { from: "nils@example.se", fromName: "Nils Holm", to: [ALICE_ADDRESS], day: 10 }),
      message(alice.id, "nils-out", { from: ALICE_ADDRESS, to: ["nils@example.se"], outbound: true, day: 11 }),
    ]);
    if (error) throw error;

    expect(await importContacts(aliceClient, alice.id)).toBe(1);

    const { data } = await aliceClient
      .from("contact_emails")
      .select("contacts(first_name, last_name)")
      .eq("email", "nils@example.se")
      .single();
    expect(data!.contacts).toEqual({ first_name: "Nils", last_name: "Holm" });
  });

  it("can't be run by a signed-out visitor", async () => {
    for (const fn of ["add_seen_once_contacts", "dismiss_seen_once"]) {
      const { error } = await anonClient().rpc(fn, {
        p_user_id: alice.id,
        p_emails: ["johan@example.se"],
      });
      expect(error, fn).not.toBeNull();
    }
  });
});
