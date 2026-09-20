import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { HOLDING_TABLES } from "@/lib/privacy/holdings";

/**
 * Deletion that actually deletes (migration 0021; docs/slice-7-plan.md, Part 3).
 *
 * plan.md §3.12 asks for it in those words — "and it actually deletes" — so the
 * test is the literal claim: after deleting, no table anywhere holds a row with
 * that user's id. It is checked against the list the privacy page counts, so a
 * table added later is covered the day it appears.
 *
 * Fails until supabase/migrations/0021_deletion.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `delete-${label}-${randomUUID()}@example.com`,
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

/** A contact, an address, mail, a summary, a touch and a sync state. */
async function fillUp(db: SupabaseClient, userId: string): Promise<string> {
  const { data: contact, error } = await db
    .from("contacts")
    .insert({ user_id: userId, first_name: "Karin", source: "gmail" })
    .select("id")
    .single();
  if (error) throw error;

  const inserts = await Promise.all([
    db.from("contact_emails").insert({
      user_id: userId,
      contact_id: contact.id,
      email: `karin-${randomUUID()}@fortnox.se`,
      is_primary: true,
    }),
    db.from("gmail_messages").insert({
      user_id: userId,
      gmail_message_id: `msg-${randomUUID()}`,
      thread_id: "t1",
      internal_date: "2026-09-02T09:00:00Z",
      from_email: "karin@fortnox.se",
      to_emails: ["alice@example.se"],
      cc_emails: [],
      has_list_unsubscribe: false,
      direction: "inbound",
      subject: "Examensarbete",
    }),
    db.from("contact_summaries").insert({
      user_id: userId,
      contact_id: contact.id,
      who_they_are: "Runs the platform team.",
      sources: {},
      as_of: "2026-09-12T10:00:00Z",
      model: "test-model",
    }),
    db.from("next_touches").insert({
      user_id: userId,
      contact_id: contact.id,
      due_on: "2026-10-05",
      reason: "Ask about the thesis",
    }),
    db.from("gmail_sync_state").insert({ user_id: userId, status: "idle" }),
    db.from("profiles").insert({ user_id: userId, display_name: "Alice" }),
  ]);
  for (const result of inserts) if (result.error) throw result.error;

  return contact.id;
}

/** Every table with a row for this user — the privacy page's own list. */
async function tablesHolding(userId: string): Promise<string[]> {
  const found: string[] = [];
  for (const table of HOLDING_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    if ((count ?? 0) > 0) found.push(table);
  }
  return found;
}

describe("deleting", () => {
  const users: string[] = [];

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  beforeEach(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    users.push(alice.id, bob.id);
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);
    await fillUp(aliceClient, alice.id);
    await fillUp(bobClient, bob.id);
  });

  it("delete_all_contacts takes the people and the mail, and leaves the account", async () => {
    const { error } = await aliceClient.rpc("delete_all_contacts", { p_user_id: alice.id });
    expect(error).toBeNull();

    // Gone: the contact and everything hanging off it, and the stored mail.
    expect(await tablesHolding(alice.id)).toEqual(["profiles"]);

    // Still signed in, and the profile is untouched.
    const { data: profile } = await aliceClient
      .from("profiles")
      .select("display_name")
      .eq("user_id", alice.id)
      .single();
    expect(profile!.display_name).toBe("Alice");
  });

  it("delete_all_contacts leaves other people's data alone", async () => {
    await aliceClient.rpc("delete_all_contacts", { p_user_id: alice.id });

    expect(await tablesHolding(bob.id)).toContain("contacts");
    expect(await tablesHolding(bob.id)).toContain("gmail_messages");
  });

  it("won't let one user delete another's contacts", async () => {
    const { error } = await bobClient.rpc("delete_all_contacts", { p_user_id: alice.id });

    expect(error).not.toBeNull();
    expect(await tablesHolding(alice.id)).toContain("contacts");
  });

  it("delete_account leaves no row anywhere, and no login", async () => {
    const { error } = await aliceClient.rpc("delete_account", { p_user_id: alice.id });
    expect(error).toBeNull();

    // The literal claim of plan.md §3.12, checked table by table.
    expect(await tablesHolding(alice.id)).toEqual([]);

    // And the user itself is gone, so signing in again starts from nothing.
    const { data } = await admin.auth.admin.getUserById(alice.id);
    expect(data.user).toBeNull();

    // Bob is untouched by all of it.
    expect(await tablesHolding(bob.id)).toContain("contacts");
    const { data: stillThere } = await admin.auth.admin.getUserById(bob.id);
    expect(stillThere.user).not.toBeNull();
  });

  it("won't let one user delete another's account", async () => {
    const { error } = await bobClient.rpc("delete_account", { p_user_id: alice.id });

    expect(error).not.toBeNull();
    const { data } = await admin.auth.admin.getUserById(alice.id);
    expect(data.user).not.toBeNull();
  });
});
