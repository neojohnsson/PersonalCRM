import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/relationship/dates";
import {
  NextTouchNotFound,
  finishNextTouch,
  openNextTouch,
  setNextTouch,
  snoozeNextTouch,
} from "@/lib/relationship/next-touch";

/**
 * Next touches (migration 0009): set, snooze, done and skip as a signed-in
 * user, one open touch per contact, and nobody touching anyone else's.
 *
 * Fails until supabase/migrations/0009_next_touches.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const UNIQUE_VIOLATION = "23505";
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
    email: `touch-${label}-${randomUUID()}@example.com`,
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

describe("next touches", () => {
  const today = todayIn();

  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data, error } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Karin", source: "manual" })
      .select("id")
      .single();
    if (error) throw error;
    karinId = data.id;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  beforeEach(async () => {
    await aliceClient.from("next_touches").delete().eq("user_id", alice.id);
  });

  describe("set", () => {
    it("creates the open touch, then changes that same touch", async () => {
      const first = await setNextTouch(aliceClient, alice.id, karinId, {
        dueOn: addDays(today, 4),
        reason: "said the budget lands in October",
      });
      expect(first).toMatchObject({ contact_id: karinId, due_on: addDays(today, 4), status: "open" });

      const second = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 30), reason: null });
      expect(second).toMatchObject({ id: first.id, due_on: addDays(today, 30), reason: null });

      expect(await openNextTouch(aliceClient, alice.id, karinId)).toEqual(second);
    });

    it("keeps to one open touch per contact, even when two saves race", async () => {
      const results = await Promise.all([
        setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 2), reason: "a" }),
        setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 3), reason: "b" }),
      ]);

      expect(results[0].id).toBe(results[1].id);

      const { data } = await aliceClient.from("next_touches").select("id").eq("status", "open");
      expect(data).toHaveLength(1);
    });

    it("is refused by the database as a second open touch", async () => {
      await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: null });

      const { error } = await aliceClient
        .from("next_touches")
        .insert({ user_id: alice.id, contact_id: karinId, due_on: today });

      expect(error?.code).toBe(UNIQUE_VIOLATION);
    });
  });

  describe("snooze", () => {
    it("moves a future touch a week after its date", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 10), reason: null });

      expect((await snoozeNextTouch(aliceClient, alice.id, touch.id, today)).due_on).toBe(addDays(today, 17));
    });

    it("moves an overdue touch a week after today, not a week after its old date", async () => {
      const { data } = await aliceClient
        .from("next_touches")
        .insert({ user_id: alice.id, contact_id: karinId, due_on: addDays(today, -3) })
        .select("id")
        .single();

      expect((await snoozeNextTouch(aliceClient, alice.id, data!.id, today)).due_on).toBe(addDays(today, 7));
    });
  });

  describe("done and skip", () => {
    it("closes the touch, keeps it as a record, and lets a new one be set", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: "follow up" });

      await finishNextTouch(aliceClient, alice.id, touch.id, "done");

      const { data: closed } = await aliceClient
        .from("next_touches")
        .select("status, completed_at")
        .eq("id", touch.id)
        .single();
      expect(closed!.status).toBe("done");
      expect(closed!.completed_at).not.toBeNull();
      expect(await openNextTouch(aliceClient, alice.id, karinId)).toBeNull();

      const next = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 14), reason: null });
      expect(next.id).not.toBe(touch.id);
    });

    it("skips, and can't close the same touch twice", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: null });

      await finishNextTouch(aliceClient, alice.id, touch.id, "skipped");
      await expect(finishNextTouch(aliceClient, alice.id, touch.id, "done")).rejects.toBeInstanceOf(NextTouchNotFound);
      await expect(snoozeNextTouch(aliceClient, alice.id, touch.id, today)).rejects.toBeInstanceOf(NextTouchNotFound);
    });
  });

  describe("someone else", () => {
    it("can't read, snooze, finish, change or delete Alice's touch", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 5), reason: "mine" });

      const { data: read } = await bobClient.from("next_touches").select("*");
      expect(read).toEqual([]);

      for (const userId of [bob.id, alice.id]) {
        await expect(snoozeNextTouch(bobClient, userId, touch.id, today)).rejects.toBeInstanceOf(NextTouchNotFound);
        await expect(finishNextTouch(bobClient, userId, touch.id, "done")).rejects.toBeInstanceOf(NextTouchNotFound);
      }

      const { data: changed } = await bobClient
        .from("next_touches")
        .update({ reason: "attacker" })
        .eq("id", touch.id)
        .select();
      expect(changed).toEqual([]);

      await bobClient.from("next_touches").delete().eq("id", touch.id);

      expect(await openNextTouch(aliceClient, alice.id, karinId)).toMatchObject({
        id: touch.id,
        due_on: addDays(today, 5),
        reason: "mine",
      });
    });

    it("can't hang a touch off Alice's contact, with either user id", async () => {
      const { error: ownId } = await bobClient
        .from("next_touches")
        .insert({ user_id: bob.id, contact_id: karinId, due_on: today });
      expect(ownId?.code).toBe(FOREIGN_KEY_VIOLATION);

      const { error: aliceId } = await bobClient
        .from("next_touches")
        .insert({ user_id: alice.id, contact_id: karinId, due_on: today });
      expect(aliceId).not.toBeNull();
    });

    it("sees nothing when signed out", async () => {
      await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: null });

      const { data } = await anonClient().from("next_touches").select("*");
      expect(data ?? []).toEqual([]);
    });
  });
});
