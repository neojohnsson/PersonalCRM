import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * settled_threads and contacts.never_chase (migration 0018): the two things a
 * person can tell the app, and nothing of anyone else's.
 *
 * Two users throughout, because that is what the policies are for: Alice says a
 * thread is finished, and Bob must not be able to see it, change it, undo it,
 * or settle anything of hers.
 *
 * Fails until supabase/migrations/0018_settled_threads.sql has been run.
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
    email: `settled-${label}-${randomUUID()}@example.com`,
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

describe("settled_threads", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let michailId: string;
  let bobsContactId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: michail, error: michailError } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Michail", last_name: "Hjelm", source: "gmail" })
      .select("id")
      .single();
    if (michailError) throw michailError;
    michailId = michail.id;

    const { data: bobs, error: bobsError } = await bobClient
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Someone", source: "manual" })
      .select("id")
      .single();
    if (bobsError) throw bobsError;
    bobsContactId = bobs.id;

    const { error: settleError } = await aliceClient
      .from("settled_threads")
      .insert({ user_id: alice.id, contact_id: michailId, thread_id: "t-handover" });
    if (settleError) throw settleError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("gives the settle back to the person who made it, with when", async () => {
    const { data, error } = await aliceClient
      .from("settled_threads")
      .select("contact_id, thread_id, settled_at");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].contact_id).toBe(michailId);
    expect(data![0].thread_id).toBe("t-handover");
    // The moment it was said is what lets a newer message re-open the thread.
    expect(new Date(data![0].settled_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("shows another user only their own", async () => {
    const empty = await bobClient.from("settled_threads").select("contact_id, thread_id");
    expect(empty.error).toBeNull();
    expect(empty.data).toEqual([]);

    // Bob settles a thread of his own: he sees his, and still none of hers.
    const { error } = await bobClient
      .from("settled_threads")
      .insert({ user_id: bob.id, contact_id: bobsContactId, thread_id: "t-bobs" });
    expect(error).toBeNull();

    const { data } = await bobClient.from("settled_threads").select("contact_id, thread_id");
    expect(data).toEqual([{ contact_id: bobsContactId, thread_id: "t-bobs" }]);
  });

  it("won't let another user settle a thread for a contact that isn't theirs", async () => {
    // With his own user_id: the composite foreign key has no such contact of his.
    const asHimself = await bobClient
      .from("settled_threads")
      .insert({ user_id: bob.id, contact_id: michailId, thread_id: "t-handover" });
    expect(asHimself.error).not.toBeNull();

    // Claiming to be her: the insert policy's check rejects it.
    const asAlice = await bobClient
      .from("settled_threads")
      .insert({ user_id: alice.id, contact_id: michailId, thread_id: "t-sneaky" });
    expect(asAlice.error).not.toBeNull();

    const { data } = await aliceClient.from("settled_threads").select("thread_id");
    expect(data).toHaveLength(1);
  });

  it("won't let another user undo or move a settle", async () => {
    const deleted = await bobClient.from("settled_threads").delete().eq("contact_id", michailId);
    expect(deleted.error).toBeNull(); // The rows simply aren't visible to delete.

    const moved = await bobClient
      .from("settled_threads")
      .update({ thread_id: "t-moved" })
      .eq("contact_id", michailId);
    expect(moved.error).toBeNull();

    const { data } = await aliceClient.from("settled_threads").select("thread_id");
    expect(data).toEqual([{ thread_id: "t-handover" }]);
  });

  it("settles a thread once: saying it twice is not two rows", async () => {
    const again = await aliceClient
      .from("settled_threads")
      .upsert(
        { user_id: alice.id, contact_id: michailId, thread_id: "t-handover" },
        { onConflict: "user_id,contact_id,thread_id" },
      );
    expect(again.error).toBeNull();

    const { data } = await aliceClient.from("settled_threads").select("thread_id");
    expect(data).toHaveLength(1);
  });

  it("lets the person undo their own settle", async () => {
    const { error } = await aliceClient
      .from("settled_threads")
      .delete()
      .eq("contact_id", michailId)
      .eq("thread_id", "t-handover");
    expect(error).toBeNull();

    const { data } = await aliceClient.from("settled_threads").select("thread_id");
    expect(data).toEqual([]);

    // Put it back for nothing in particular: the row is gone, the contact isn't.
    const { data: contact } = await aliceClient.from("contacts").select("id").eq("id", michailId);
    expect(contact).toHaveLength(1);
  });

  it("goes when the contact goes", async () => {
    await aliceClient
      .from("settled_threads")
      .insert({ user_id: alice.id, contact_id: michailId, thread_id: "t-gone" });

    const { error } = await aliceClient.from("contacts").delete().eq("id", michailId);
    expect(error).toBeNull();

    const { data } = await aliceClient.from("settled_threads").select("thread_id");
    expect(data).toEqual([]);
  });
});

describe("contacts.never_chase", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let lindaId: string;

  beforeAll(async () => {
    alice = await createUser("chase-alice");
    bob = await createUser("chase-bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data, error } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Linda", last_name: "Johnsson", source: "gmail" })
      .select("id, never_chase")
      .single();
    if (error) throw error;
    lindaId = data.id;
    // Every contact that already exists is unchanged by the migration.
    expect(data.never_chase).toBe(false);
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("is set by the person, and shows in the contact list", async () => {
    const { error } = await aliceClient
      .from("contacts")
      .update({ never_chase: true })
      .eq("id", lindaId);
    expect(error).toBeNull();

    const { data } = await aliceClient
      .from("contact_list")
      .select("id, first_name, never_chase")
      .eq("id", lindaId)
      .single();

    // Still in the list: this hides prompts, not the person.
    expect(data).toMatchObject({ first_name: "Linda", never_chase: true });
  });

  it("can't be changed by anyone else", async () => {
    const { error } = await bobClient
      .from("contacts")
      .update({ never_chase: false })
      .eq("id", lindaId);
    expect(error).toBeNull(); // Nothing of hers is visible to update.

    const { data } = await aliceClient
      .from("contacts")
      .select("never_chase")
      .eq("id", lindaId)
      .single();
    expect(data!.never_chase).toBe(true);
  });
});
