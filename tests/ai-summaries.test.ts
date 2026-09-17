import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * AI summaries and AI spending in the database (migration 0010): summaries
 * arrive pending, approval swaps them atomically, spending rows can't be
 * written by users, and the monthly cap holds — also for requests at the same
 * moment. Two users throughout: neither can see or change the other's.
 *
 * Fails until supabase/migrations/0010_ai_summaries.sql has been run.
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
    email: `ai-${label}-${randomUUID()}@example.com`,
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

async function createContact(client: SupabaseClient, userId: string, name: string): Promise<string> {
  const { data, error } = await client
    .from("contacts")
    .insert({ user_id: userId, first_name: name, source: "manual" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const summary = (userId: string, contactId: string, discussed = "The thesis timeline.") => ({
  user_id: userId,
  contact_id: contactId,
  who_they_are: "Runs the platform team.",
  how_you_know: null,
  discussed,
  next_step: "Answer the question about October.",
  sources: { discussed: [{ messageId: "m1", threadId: "t1" }] },
  as_of: "2026-09-12T10:00:00Z",
  model: "test-model",
});

describe("AI summaries and spending", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;
  let bobsContactId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);
    karinId = await createContact(aliceClient, alice.id, "Karin");
    bobsContactId = await createContact(bobClient, bob.id, "Nils");
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  describe("contact_summaries", () => {
    beforeEach(async () => {
      await aliceClient.from("contact_summaries").delete().eq("user_id", alice.id);
    });

    async function insertPending(discussed?: string): Promise<string> {
      const { data, error } = await aliceClient
        .from("contact_summaries")
        .insert(summary(alice.id, karinId, discussed))
        .select("id, status, edited")
        .single();
      if (error) throw error;
      expect(data).toMatchObject({ status: "pending", edited: false });
      return data.id;
    }

    it("can only be created as pending — never straight into the record", async () => {
      await insertPending();

      for (const sneaky of [{ status: "approved" }, { edited: true }, { approved_at: "2026-09-12T10:00:00Z" }]) {
        await aliceClient.from("contact_summaries").delete().eq("user_id", alice.id);
        const { error } = await aliceClient
          .from("contact_summaries")
          .insert({ ...summary(alice.id, karinId), ...sneaky });
        expect(error).not.toBeNull();
      }
    });

    it("keeps one pending per contact", async () => {
      await insertPending();
      const { error } = await aliceClient.from("contact_summaries").insert(summary(alice.id, karinId));
      expect(error?.code).toBe(UNIQUE_VIOLATION);
    });

    it("approves: the pending one replaces the approved one, in one step", async () => {
      const first = await insertPending("First version.");
      const { error: approveFirst } = await aliceClient.rpc("approve_contact_summary", {
        p_user_id: alice.id,
        p_summary_id: first,
      });
      expect(approveFirst).toBeNull();

      // A regenerated version waits beside it.
      const second = await insertPending("Second version.");
      const { data: both } = await aliceClient
        .from("contact_summaries")
        .select("id, status")
        .eq("contact_id", karinId)
        .order("created_at");
      expect(both).toEqual([
        { id: first, status: "approved" },
        { id: second, status: "pending" },
      ]);

      const { error: approveSecond } = await aliceClient.rpc("approve_contact_summary", {
        p_user_id: alice.id,
        p_summary_id: second,
      });
      expect(approveSecond).toBeNull();

      const { data: after } = await aliceClient
        .from("contact_summaries")
        .select("id, status, discussed, approved_at")
        .eq("contact_id", karinId);
      expect(after).toHaveLength(1);
      expect(after![0]).toMatchObject({ id: second, status: "approved", discussed: "Second version." });
      expect(after![0].approved_at).not.toBeNull();
    });

    it("can't approve something that isn't pending", async () => {
      const id = await insertPending();
      await aliceClient.rpc("approve_contact_summary", { p_user_id: alice.id, p_summary_id: id });

      const { error } = await aliceClient.rpc("approve_contact_summary", { p_user_id: alice.id, p_summary_id: id });
      expect(error?.code).toBe("P0002");
    });

    it("lets its owner edit the words and mark them as theirs", async () => {
      const id = await insertPending();
      await aliceClient.rpc("approve_contact_summary", { p_user_id: alice.id, p_summary_id: id });

      const { data, error } = await aliceClient
        .from("contact_summaries")
        .update({ next_step: "Call her in October.", edited: true })
        .eq("id", id)
        .select("next_step, edited, status")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({ next_step: "Call her in October.", edited: true, status: "approved" });
    });

    it("is invisible and untouchable to someone else", async () => {
      const id = await insertPending("Private.");

      const { data: read } = await bobClient.from("contact_summaries").select("*");
      expect(read).toEqual([]);

      const { data: changed } = await bobClient
        .from("contact_summaries")
        .update({ discussed: "attacker" })
        .eq("id", id)
        .select();
      expect(changed).toEqual([]);

      await bobClient.from("contact_summaries").delete().eq("id", id);

      for (const userId of [bob.id, alice.id]) {
        const { error } = await bobClient.rpc("approve_contact_summary", { p_user_id: userId, p_summary_id: id });
        expect(error?.code).toBe("P0002");
      }

      const { data: still } = await aliceClient.from("contact_summaries").select("status, discussed").eq("id", id).single();
      expect(still).toEqual({ status: "pending", discussed: "Private." });

      expect((await anonClient().from("contact_summaries").select("*")).data ?? []).toEqual([]);
    });

    it("keeps suggestions for the contact on the summary, within the contact fields' limits (0011)", async () => {
      const { data, error } = await aliceClient
        .from("contact_summaries")
        .insert({
          ...summary(alice.id, karinId),
          suggested_company: "Fortnox",
          suggested_role: "Head of platform",
          suggested_touch_reason: "Ask about the thesis decision",
          suggested_touch_on: "2026-10-01",
          sources: { company: [{ messageId: "m1", threadId: "t1" }] },
        })
        .select("suggested_company, suggested_role, suggested_touch_reason, suggested_touch_on")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({
        suggested_company: "Fortnox",
        suggested_role: "Head of platform",
        suggested_touch_reason: "Ask about the thesis decision",
        suggested_touch_on: "2026-10-01",
      });

      expect((await bobClient.from("contact_summaries").select("suggested_company")).data).toEqual([]);

      await aliceClient.from("contact_summaries").delete().eq("user_id", alice.id);
      for (const tooMuch of [
        { suggested_company: "x".repeat(201) },
        { suggested_touch_reason: "x".repeat(301) },
        { suggested_touch_on: "2026-10-01" }, // a date with no reason
      ]) {
        const { error: refused } = await aliceClient
          .from("contact_summaries")
          .insert({ ...summary(alice.id, karinId), ...tooMuch });
        expect(refused).not.toBeNull();
      }
    });

    it("can't be hung off someone else's contact", async () => {
      const { error: ownId } = await bobClient.from("contact_summaries").insert(summary(bob.id, karinId));
      expect(ownId?.code).toBe(FOREIGN_KEY_VIOLATION);

      const { error: aliceId } = await bobClient.from("contact_summaries").insert(summary(alice.id, karinId));
      expect(aliceId).not.toBeNull();
    });
  });

  describe("ai_usage and the cap", () => {
    const reserve = (client: SupabaseClient, userId: string, estimate: number, cap: number, contactId: string | null = null) =>
      client.rpc("reserve_ai_spend", {
        p_user_id: userId,
        p_contact_id: contactId,
        p_purpose: "summary",
        p_model: "test-model",
        p_estimate: estimate,
        p_cap: cap,
      });

    const settle = (client: SupabaseClient, userId: string, usageId: string, cost: number) =>
      client.rpc("settle_ai_spend", {
        p_user_id: userId,
        p_usage_id: usageId,
        p_cost: cost,
        p_input_tokens: 1000,
        p_output_tokens: 200,
      });

    beforeEach(async () => {
      await admin.from("ai_usage").delete().in("user_id", [alice.id, bob.id]);
    });

    it("reserves under the cap and refuses past it", async () => {
      const first = await reserve(aliceClient, alice.id, 0.5, 2, karinId);
      expect(first.error).toBeNull();

      const second = await reserve(aliceClient, alice.id, 1.5, 2);
      expect(second.error).toBeNull();

      const third = await reserve(aliceClient, alice.id, 0.01, 2);
      expect(third.error?.message).toBe("ai_cap_reached");
      expect(Number(third.error?.details)).toBe(2);
    });

    it("counts a finished request at its real cost, not its reservation", async () => {
      const { data: id } = await reserve(aliceClient, alice.id, 1.9, 2);
      expect((await reserve(aliceClient, alice.id, 0.5, 2)).error?.message).toBe("ai_cap_reached");

      expect((await settle(aliceClient, alice.id, id, 0.004)).error).toBeNull();
      expect((await reserve(aliceClient, alice.id, 0.5, 2)).error).toBeNull();

      const { data: rows } = await aliceClient.from("ai_usage").select("status, cost_usd, input_tokens").eq("id", id);
      expect(rows).toEqual([{ status: "settled", cost_usd: 0.004, input_tokens: 1000 }]);
    });

    it("lets only one of many requests at the same moment slip under the cap", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => reserve(aliceClient, alice.id, 0.8, 1)));

      expect(results.filter((result) => result.error === null)).toHaveLength(1);
      expect(results.filter((result) => result.error?.message === "ai_cap_reached")).toHaveLength(5);
    });

    it("never lowers a recorded cost", async () => {
      const { data: id } = await reserve(aliceClient, alice.id, 0.5, 2);
      await settle(aliceClient, alice.id, id, 0.3);
      await settle(aliceClient, alice.id, id, 0);

      const { data } = await aliceClient.from("ai_usage").select("cost_usd").eq("id", id).single();
      expect(data).toEqual({ cost_usd: 0.3 });
    });

    it("can't be written, changed or deleted by the user directly", async () => {
      const { data: id } = await reserve(aliceClient, alice.id, 1, 2);

      const { error: insertError } = await aliceClient
        .from("ai_usage")
        .insert({ user_id: alice.id, purpose: "summary", model: "x", reserved_usd: 0.01 });
      expect(insertError).not.toBeNull();

      await aliceClient.from("ai_usage").update({ reserved_usd: 0.000001 }).eq("id", id);
      await aliceClient.from("ai_usage").delete().eq("id", id);

      const { data } = await aliceClient.from("ai_usage").select("reserved_usd, status").eq("id", id).single();
      expect(data).toEqual({ reserved_usd: 1, status: "reserved" });
    });

    it("refuses nonsense amounts", async () => {
      expect((await reserve(aliceClient, alice.id, 0, 2)).error).not.toBeNull();
      expect((await reserve(aliceClient, alice.id, -1, 2)).error).not.toBeNull();

      const { data: id } = await reserve(aliceClient, alice.id, 0.1, 2);
      expect((await settle(aliceClient, alice.id, id, -5)).error).not.toBeNull();
    });

    it("keeps each user's spending to themselves", async () => {
      const { data: aliceUsage } = await reserve(aliceClient, alice.id, 1.5, 2);

      // Bob can't see it, reserve in Alice's name, or settle her request.
      expect((await bobClient.from("ai_usage").select("*")).data).toEqual([]);
      expect((await reserve(bobClient, alice.id, 0.1, 100)).error?.code).toBe("42501");
      expect((await settle(bobClient, alice.id, aliceUsage, 0)).error?.code).toBe("42501");
      expect((await settle(bobClient, bob.id, aliceUsage, 0)).error?.code).toBe("P0002");

      // Nor tie his spending to her contact.
      expect((await reserve(bobClient, bob.id, 0.1, 2, karinId)).error?.code).toBe(FOREIGN_KEY_VIOLATION);

      // Alice's spending doesn't count against Bob's cap.
      expect((await reserve(bobClient, bob.id, 1.5, 2, bobsContactId)).error).toBeNull();

      // Signed out, nothing works.
      expect((await reserve(anonClient(), alice.id, 0.1, 2)).error).not.toBeNull();
      expect((await anonClient().from("ai_usage").select("*")).data ?? []).toEqual([]);
    });
  });
});
