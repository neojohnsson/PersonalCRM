import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The test that matters: two real users, and one must not be able to read,
 * change or delete the other's row.
 *
 * This is written before the feature it protects. It fails until
 * supabase/migrations/0001_google_accounts.sql exists and has been run.
 *
 * It also pins the shape the table has to have: a `user_id` column that
 * references auth.users, an `email`, and the encrypted refresh token.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const TABLE = "google_accounts";
const PASSWORD = "test-password-that-is-long-enough";

/** Bypasses every RLS policy. Used only to create and delete the test users. */
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A client carrying one user's session — exactly what the browser gets. */
async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

describe("RLS: google_accounts", () => {
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
    // Deleting the users cascades to their rows, so no other cleanup needed.
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("lets a user insert their own row", async () => {
    const { error } = await aliceClient.from(TABLE).insert({
      user_id: alice.id,
      email: alice.email,
      refresh_token_encrypted: "v1.fake.fake.fake",
    });

    expect(error).toBeNull();
  });

  it("lets a user read their own row", async () => {
    const { data, error } = await aliceClient.from(TABLE).select("user_id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].user_id).toBe(alice.id);
  });

  it("does not let a user read someone else's row", async () => {
    const { data, error } = await bobClient.from(TABLE).select("*");

    // RLS filters rows rather than raising: Bob gets an empty list, not a 403.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not leak the encrypted token through a targeted query", async () => {
    const { data } = await bobClient
      .from(TABLE)
      .select("refresh_token_encrypted")
      .eq("user_id", alice.id);

    expect(data).toEqual([]);
  });

  it("does not let a user update someone else's row", async () => {
    const { data } = await bobClient
      .from(TABLE)
      .update({ refresh_token_encrypted: "v1.attacker.attacker.attacker" })
      .eq("user_id", alice.id)
      .select();

    expect(data).toEqual([]);

    // And Alice's row is untouched.
    const { data: aliceRow } = await aliceClient
      .from(TABLE)
      .select("refresh_token_encrypted")
      .single();

    expect(aliceRow!.refresh_token_encrypted).toBe("v1.fake.fake.fake");
  });

  it("does not let a user delete someone else's row", async () => {
    await bobClient.from(TABLE).delete().eq("user_id", alice.id);

    const { data } = await aliceClient.from(TABLE).select("user_id");
    expect(data).toHaveLength(1);
  });

  it("does not let a user insert a row owned by someone else", async () => {
    const { error } = await bobClient.from(TABLE).insert({
      user_id: alice.id,
      email: "attacker@example.com",
      refresh_token_encrypted: "v1.attacker.attacker.attacker",
    });

    // This one must raise: WITH CHECK rejects the write outright.
    expect(error).not.toBeNull();
  });

  it("does not let a signed-out visitor read anything", async () => {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await anon.from(TABLE).select("*");
    expect(data ?? []).toEqual([]);
  });
});
