import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The tables the sync writes to, and the view the people list reads from.
 *
 * Same shape as rls-google-accounts.test.ts: two real users, and neither may
 * read, change or delete the other's mail metadata.
 *
 * Written before the policies. It fails until
 * supabase/migrations/0002_gmail_sync.sql has been run AND its policies are
 * written.
 *
 * The `people` view has no policies of its own — it's created with
 * security_invoker, so it is exactly as private as gmail_messages. The view
 * tests are the proof.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

/** Postgres error codes the schema is expected to raise. */
const CHECK_VIOLATION = "23514";

/** Bypasses every RLS policy. Used only to create and delete the test users. */
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client carrying one user's session — exactly what the browser gets. */
async function signInAs(email: string): Promise<SupabaseClient> {
  const client = anonClient();

  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;

  return client;
}

async function createUser(label: string): Promise<User> {
  const email = `rls-${label}-${randomUUID()}@example.com`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  return data.user;
}

type MessageRow = {
  user_id: string;
  gmail_message_id: string;
  thread_id: string;
  internal_date: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  direction: string;
};

/**
 * Alice's mailbox: Karin writes, Alice answers with Johan on Cc, then Alice
 * follows up with Karin in both To and Cc in a different letter case.
 */
function aliceMessages(alice: User): MessageRow[] {
  const aliceEmail = alice.email!;
  const base = { user_id: alice.id, thread_id: "t1" };

  return [
    {
      ...base,
      gmail_message_id: "m1",
      internal_date: "2026-09-01T09:00:00Z",
      from_email: "karin@example.com",
      from_name: "Karin Lindqvist",
      to_emails: [aliceEmail],
      cc_emails: [],
      direction: "inbound",
    },
    {
      ...base,
      gmail_message_id: "m2",
      internal_date: "2026-09-03T09:00:00Z",
      from_email: aliceEmail,
      from_name: "Alice",
      to_emails: ["karin@example.com"],
      cc_emails: ["johan@example.com"],
      direction: "outbound",
    },
    {
      ...base,
      gmail_message_id: "m3",
      internal_date: "2026-09-05T09:00:00Z",
      from_email: aliceEmail,
      from_name: "Alice",
      to_emails: ["KARIN@example.com"],
      cc_emails: ["karin@example.com"],
      direction: "outbound",
    },
  ];
}

describe("RLS: gmail sync tables and the people view", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  beforeAll(async () => {
    for (const [name, value] of Object.entries({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: SECRET_KEY,
    })) {
      if (!value) throw new Error(`${name} is not set in .env.local`);
    }

    alice = await createUser("alice");
    bob = await createUser("bob");

    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);
  });

  afterAll(async () => {
    // Deleting the users cascades to every row in both tables.
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  describe("gmail_messages", () => {
    const TABLE = "gmail_messages";

    it("lets a user insert their own messages", async () => {
      const { error } = await aliceClient.from(TABLE).insert(aliceMessages(alice));

      expect(error).toBeNull();
    });

    it("lets a user read their own messages", async () => {
      const { data, error } = await aliceClient.from(TABLE).select("gmail_message_id");

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
    });

    it("makes saving the same message again an update, not a duplicate", async () => {
      // This is what makes a retried sync step safe. The upsert needs the
      // select, insert and update policies all in place.
      const { error } = await aliceClient
        .from(TABLE)
        .upsert(aliceMessages(alice)[0], { onConflict: "user_id,gmail_message_id" });

      expect(error).toBeNull();

      const { data } = await aliceClient.from(TABLE).select("gmail_message_id");
      expect(data).toHaveLength(3);
    });

    it("rejects a direction other than inbound or outbound", async () => {
      const { error } = await aliceClient
        .from(TABLE)
        .insert({ ...aliceMessages(alice)[0], gmail_message_id: "m-bad", direction: "sideways" });

      // The check constraint, specifically — not RLS refusing the insert.
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("does not let a user read someone else's messages", async () => {
      const { data, error } = await bobClient.from(TABLE).select("*");

      // RLS filters rows rather than raising: Bob gets an empty list, not a 403.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("does not leak messages through a targeted query", async () => {
      const { data } = await bobClient.from(TABLE).select("from_email").eq("user_id", alice.id);

      expect(data).toEqual([]);
    });

    it("does not let a user update someone else's messages", async () => {
      const { data } = await bobClient
        .from(TABLE)
        .update({ from_name: "Attacker" })
        .eq("user_id", alice.id)
        .select();

      expect(data).toEqual([]);

      const { data: m1 } = await aliceClient
        .from(TABLE)
        .select("from_name")
        .eq("gmail_message_id", "m1")
        .single();

      expect(m1!.from_name).toBe("Karin Lindqvist");
    });

    it("does not let a user delete someone else's messages", async () => {
      await bobClient.from(TABLE).delete().eq("user_id", alice.id);

      const { data } = await aliceClient.from(TABLE).select("gmail_message_id");
      expect(data).toHaveLength(3);
    });

    it("does not let a user insert a message owned by someone else", async () => {
      const { error } = await bobClient
        .from(TABLE)
        .insert({ ...aliceMessages(alice)[0], gmail_message_id: "m-forged" });

      // This one must raise: WITH CHECK rejects the write outright.
      expect(error).not.toBeNull();
    });

    it("does not let a signed-out visitor read anything", async () => {
      const { data } = await anonClient().from(TABLE).select("*");

      expect(data ?? []).toEqual([]);
    });
  });

  describe("gmail_sync_state", () => {
    const TABLE = "gmail_sync_state";

    it("lets a user create their own sync state", async () => {
      const { error } = await aliceClient
        .from(TABLE)
        .insert({ user_id: alice.id, status: "backfilling", history_id: "123456" });

      expect(error).toBeNull();
    });

    it("lets a user read their own sync state", async () => {
      const { data, error } = await aliceClient.from(TABLE).select("status").single();

      expect(error).toBeNull();
      expect(data!.status).toBe("backfilling");
    });

    it("rejects a status the state machine doesn't have", async () => {
      const { error } = await aliceClient
        .from(TABLE)
        .update({ status: "paused" })
        .eq("user_id", alice.id);

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("does not let a user read someone else's sync state", async () => {
      const { data, error } = await bobClient.from(TABLE).select("*");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("does not let a user update someone else's sync state", async () => {
      const { data } = await bobClient
        .from(TABLE)
        .update({ status: "error", last_error: "attacker" })
        .eq("user_id", alice.id)
        .select();

      expect(data).toEqual([]);

      const { data: aliceRow } = await aliceClient.from(TABLE).select("status").single();
      expect(aliceRow!.status).toBe("backfilling");
    });

    it("does not let a user delete someone else's sync state", async () => {
      await bobClient.from(TABLE).delete().eq("user_id", alice.id);

      const { data } = await aliceClient.from(TABLE).select("user_id");
      expect(data).toHaveLength(1);
    });

    it("does not let a user create sync state owned by someone else", async () => {
      const { error } = await bobClient.from(TABLE).insert({ user_id: alice.id });

      expect(error).not.toBeNull();
    });

    it("does not let a signed-out visitor read anything", async () => {
      const { data } = await anonClient().from(TABLE).select("*");

      expect(data ?? []).toEqual([]);
    });
  });

  describe("people view", () => {
    const VIEW = "people";

    it("groups a user's mail into people: sender on received mail, To and Cc on sent mail", async () => {
      const { data, error } = await aliceClient
        .from(VIEW)
        .select("email, name, message_count, sent_count, received_count, last_contact_at")
        .order("last_contact_at", { ascending: false });

      expect(error).toBeNull();
      expect(data).toHaveLength(2);

      const [karin, johan] = data!;

      // Karin: wrote once, was written to twice. In both To and Cc of m3 in
      // different letter case, and still counted once for it.
      expect(karin).toMatchObject({
        email: "karin@example.com",
        name: "Karin Lindqvist",
        message_count: 3,
        sent_count: 2,
        received_count: 1,
      });
      expect(new Date(karin.last_contact_at).toISOString()).toBe("2026-09-05T09:00:00.000Z");

      // Johan: only ever on Cc of mail Alice sent. No name seen yet.
      expect(johan).toMatchObject({
        email: "johan@example.com",
        name: null,
        message_count: 1,
        sent_count: 1,
        received_count: 0,
      });
    });

    it("does not show a user someone else's people", async () => {
      const { data, error } = await bobClient.from(VIEW).select("*");

      // If the view were created without security_invoker, this is the test
      // that catches it: Bob would see Karin and Johan.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("does not leak people through a targeted query", async () => {
      const { data } = await bobClient.from(VIEW).select("email").eq("user_id", alice.id);

      expect(data).toEqual([]);
    });

    it("does not let a signed-out visitor read anything", async () => {
      const { data } = await anonClient().from(VIEW).select("*");

      expect(data ?? []).toEqual([]);
    });
  });
});
