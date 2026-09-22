import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/relationship/dates";
import {
  NextTouchNotFound,
  finishNextTouch,
  openNextTouch,
  setNextTouch,
  moveNextTouch,
  reopenNextTouch,
  NewerTouchExists,
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

  // Slice 9b, Part 3: Snooze moves a touch to a day you chose, instead of
  // adding seven days and telling nobody. Which day each choice means is
  // tests/snooze.test.ts; this is the write itself.
  describe("move", () => {
    it("puts the touch on the day given, and says which day it had", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 10), reason: null });

      const moved = await moveNextTouch(aliceClient, alice.id, touch.id, addDays(today, 17));

      expect(moved.touch.due_on).toBe(addDays(today, 17));
      // What Undo needs: the day it was on before the press.
      expect(moved.from).toBe(addDays(today, 10));
    });

    it("moves an overdue touch back to where it was, which is in the past", async () => {
      // Undo of a snooze is this same call with `from` as the day, and for an
      // overdue touch that day has already gone.
      const { data } = await aliceClient
        .from("next_touches")
        .insert({ user_id: alice.id, contact_id: karinId, due_on: addDays(today, -3) })
        .select("id")
        .single();

      await moveNextTouch(aliceClient, alice.id, data!.id, addDays(today, 7));
      const back = await moveNextTouch(aliceClient, alice.id, data!.id, addDays(today, -3));

      expect(back.touch.due_on).toBe(addDays(today, -3));
      expect(back.from).toBe(addDays(today, 7));
    });

    it("refuses anything that isn't a date", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: null });

      await expect(moveNextTouch(aliceClient, alice.id, touch.id, "next tuesday")).rejects.toThrow();
    });
  });

  // Slice 9b, Part 3: closing a touch was the one action with no way back.
  describe("reopen", () => {
    it("opens a skipped touch again, on the day it had", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, {
        dueOn: addDays(today, 4),
        reason: "ask about the thesis",
      });
      await finishNextTouch(aliceClient, alice.id, touch.id, "skipped");
      expect(await openNextTouch(aliceClient, alice.id, karinId)).toBeNull();

      const reopened = await reopenNextTouch(aliceClient, alice.id, touch.id);

      expect(reopened.status).toBe("open");
      expect(reopened.due_on).toBe(addDays(today, 4));
      expect(reopened.reason).toBe("ask about the thesis");
      const open = await openNextTouch(aliceClient, alice.id, karinId);
      expect(open!.id).toBe(touch.id);
    });

    it("opens a touch marked done again too, and won't do it twice", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: null });
      await finishNextTouch(aliceClient, alice.id, touch.id, "done");

      await reopenNextTouch(aliceClient, alice.id, touch.id);
      // Already open: there is nothing closed to reopen.
      await expect(reopenNextTouch(aliceClient, alice.id, touch.id)).rejects.toBeInstanceOf(NextTouchNotFound);
    });

    it("says so rather than failing quietly when a newer touch exists", async () => {
      // A contact may have one open touch (migration 0009), so undoing a skip
      // after planning something new cannot happen.
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: today, reason: "the old plan" });
      await finishNextTouch(aliceClient, alice.id, touch.id, "skipped");
      await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 20), reason: "the new plan" });

      await expect(reopenNextTouch(aliceClient, alice.id, touch.id)).rejects.toBeInstanceOf(NewerTouchExists);
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
      await expect(moveNextTouch(aliceClient, alice.id, touch.id, addDays(today, 7))).rejects.toBeInstanceOf(
        NextTouchNotFound,
      );
    });
  });

  describe("someone else", () => {
    it("can't read, move, finish, reopen, change or delete Alice's touch", async () => {
      const touch = await setNextTouch(aliceClient, alice.id, karinId, { dueOn: addDays(today, 5), reason: "mine" });

      const { data: read } = await bobClient.from("next_touches").select("*");
      expect(read).toEqual([]);

      for (const userId of [bob.id, alice.id]) {
        await expect(moveNextTouch(bobClient, userId, touch.id, addDays(today, 7))).rejects.toBeInstanceOf(
          NextTouchNotFound,
        );
        await expect(finishNextTouch(bobClient, userId, touch.id, "done")).rejects.toBeInstanceOf(NextTouchNotFound);
        await expect(reopenNextTouch(bobClient, userId, touch.id)).rejects.toBeInstanceOf(NextTouchNotFound);
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
