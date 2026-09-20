import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * promises (migration 0019): a sentence somebody said, waiting to be accepted
 * or rejected — and nothing of anyone else's.
 *
 * Two users throughout, because that is what the policies are for: Alice has a
 * promise from a contact of hers, and Bob must not be able to see it, record
 * one against her contact, decide hers, or delete it.
 *
 * Fails until supabase/migrations/0019_promises.sql has been run.
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
    email: `promises-${label}-${randomUUID()}@example.com`,
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

describe("promises", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let parId: string;
  let bobsContactId: string;

  /** A promise of Alice's, with whatever is being varied. */
  const promise = (extra: Record<string, unknown> = {}) => ({
    user_id: alice.id,
    contact_id: parId,
    thread_id: "t-thesis",
    message_id: "m-1",
    owed_by: "them",
    due_on: "2026-03-03",
    reason: "Said he'd watch for openings",
    ...extra,
  });

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: par, error: parError } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Pär", last_name: "Burman", source: "gmail" })
      .select("id, promises_scanned_at")
      .single();
    if (parError) throw parError;
    parId = par.id;
    // Never scanned yet: the scan has nothing to compare a message date against.
    expect(par.promises_scanned_at).toBeNull();

    const { data: bobs, error: bobsError } = await bobClient
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Someone", source: "manual" })
      .select("id")
      .single();
    if (bobsError) throw bobsError;
    bobsContactId = bobs.id;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("starts pending, undecided, and belongs to the person who found it", async () => {
    const { data, error } = await aliceClient
      .from("promises")
      .insert(promise())
      .select("status, decided_at, owed_by, due_on, next_touch_id")
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: "pending",
      decided_at: null,
      owed_by: "them",
      due_on: "2026-03-03",
      next_touch_id: null,
    });
  });

  it("offers one message once per direction, so dismissing sticks", async () => {
    // The same message, the same direction: a rescan must not offer it again.
    const again = await aliceClient.from("promises").insert(promise());
    expect(again.error?.code).toBe("23505");

    // The other direction is a different thing to remember, so it is allowed.
    const otherWay = await aliceClient
      .from("promises")
      .insert(promise({ owed_by: "you", reason: "You said you'd send the dates" }));
    expect(otherWay.error).toBeNull();
  });

  it("won't take a decision without the day it was made, or the other way round", async () => {
    const decidedWhenPending = await aliceClient
      .from("promises")
      .insert(promise({ message_id: "m-2", decided_at: new Date().toISOString() }));
    expect(decidedWhenPending.error?.code).toBe("23514");

    const acceptedWithoutDate = await aliceClient
      .from("promises")
      .insert(promise({ message_id: "m-3", status: "accepted" }));
    expect(acceptedWithoutDate.error?.code).toBe("23514");
  });

  it("only takes the three statuses and the two directions", async () => {
    const madeUpStatus = await aliceClient
      .from("promises")
      .insert(promise({ message_id: "m-4", status: "maybe", decided_at: new Date().toISOString() }));
    expect(madeUpStatus.error?.code).toBe("23514");

    const madeUpDirection = await aliceClient
      .from("promises")
      .insert(promise({ message_id: "m-5", owed_by: "someone else" }));
    expect(madeUpDirection.error?.code).toBe("23514");
  });

  it("links the next touch it became, and outlives it", async () => {
    const { data: touch, error: touchError } = await aliceClient
      .from("next_touches")
      .insert({
        user_id: alice.id,
        contact_id: parId,
        due_on: "2026-03-03",
        reason: "Pär said he'd watch for openings",
      })
      .select("id")
      .single();
    if (touchError) throw touchError;

    const accepted = await aliceClient
      .from("promises")
      .update({ status: "accepted", decided_at: new Date().toISOString(), next_touch_id: touch.id })
      .eq("user_id", alice.id)
      .eq("message_id", "m-1")
      .eq("owed_by", "them")
      .select("status, next_touch_id")
      .single();
    expect(accepted.error).toBeNull();
    expect(accepted.data).toMatchObject({ status: "accepted", next_touch_id: touch.id });

    // The touch goes; the promise stays, still saying you decided.
    const { error: deleteError } = await aliceClient.from("next_touches").delete().eq("id", touch.id);
    expect(deleteError).toBeNull();

    const { data: after } = await aliceClient
      .from("promises")
      .select("status, next_touch_id")
      .eq("message_id", "m-1")
      .eq("owed_by", "them")
      .single();
    expect(after).toMatchObject({ status: "accepted", next_touch_id: null });
  });

  it("shows another user nothing, and won't take their promises about your contacts", async () => {
    const seen = await bobClient.from("promises").select("id, reason");
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);

    // As himself: no such contact of his, so the composite key refuses it.
    const asHimself = await bobClient
      .from("promises")
      .insert({ ...promise({ message_id: "m-bob" }), user_id: bob.id });
    expect(asHimself.error).not.toBeNull();

    // Claiming to be her: the insert policy's check refuses it.
    const asAlice = await bobClient.from("promises").insert(promise({ message_id: "m-sneaky" }));
    expect(asAlice.error).not.toBeNull();

    // His own contact, his own promise: fine.
    const hisOwn = await bobClient.from("promises").insert({
      user_id: bob.id,
      contact_id: bobsContactId,
      thread_id: "t-bobs",
      message_id: "m-bobs",
      owed_by: "you",
      due_on: "2026-04-01",
      reason: "You said you'd call",
    });
    expect(hisOwn.error).toBeNull();
  });

  it("won't let another user decide or delete a promise of yours", async () => {
    const decided = await bobClient
      .from("promises")
      .update({ status: "dismissed", decided_at: new Date().toISOString() })
      .eq("contact_id", parId);
    expect(decided.error).toBeNull(); // Nothing of hers is visible to update.

    const deleted = await bobClient.from("promises").delete().eq("contact_id", parId);
    expect(deleted.error).toBeNull();

    const { data } = await aliceClient.from("promises").select("status").eq("message_id", "m-1");
    expect(data).toEqual([{ status: "accepted" }]);
  });

  it("goes when the contact goes", async () => {
    const { error } = await aliceClient.from("contacts").delete().eq("id", parId);
    expect(error).toBeNull();

    const { data } = await aliceClient.from("promises").select("id");
    expect(data).toEqual([]);
  });
});
