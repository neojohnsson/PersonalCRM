import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SummaryNotFound,
  approveSummary,
  discardSummary,
  editSummary,
  parseSummaryForm,
  summariesFor,
} from "@/lib/ai/summary-record";
import { MAX_PART_CHARS } from "@/lib/ai/summary";

/**
 * Approve, discard and edit, as signed-in users against the real database —
 * and nobody doing any of it to someone else's summary.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signedInUser(label: string): Promise<{ user: User; db: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `record-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

const SOURCE = { messageId: "msg-1", threadId: "t1" };

describe("summary record", () => {
  let alice: User;
  let bob: User;
  let aliceDb: SupabaseClient;
  let bobDb: SupabaseClient;
  let karinId: string;

  beforeAll(async () => {
    ({ user: alice, db: aliceDb } = await signedInUser("alice"));
    ({ user: bob, db: bobDb } = await signedInUser("bob"));

    const { data, error } = await aliceDb
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Karin", source: "gmail" })
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
    await aliceDb.from("contact_summaries").delete().eq("user_id", alice.id);
  });

  async function pending(discussed = "The thesis."): Promise<string> {
    const { data, error } = await aliceDb
      .from("contact_summaries")
      .insert({
        user_id: alice.id,
        contact_id: karinId,
        who_they_are: "Runs the platform team.",
        discussed,
        sources: { who_they_are: [SOURCE], discussed: [SOURCE] },
        as_of: "2026-09-12T10:00:00Z",
        model: "gpt-5.6-luna",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  it("shows the approved summary and the pending one beside it", async () => {
    expect(await summariesFor(aliceDb, alice.id, karinId)).toEqual({ approved: null, pending: null });

    const first = await pending("First.");
    await approveSummary(aliceDb, alice.id, first);
    const second = await pending("Second.");

    const { approved, pending: waiting } = await summariesFor(aliceDb, alice.id, karinId);
    expect(approved).toMatchObject({ id: first, discussed: "First.", status: "approved" });
    expect(waiting).toMatchObject({ id: second, discussed: "Second.", status: "pending" });
  });

  it("discards only a pending summary", async () => {
    const id = await pending();
    await discardSummary(aliceDb, alice.id, id);
    expect((await summariesFor(aliceDb, alice.id, karinId)).pending).toBeNull();

    const approvedId = await pending();
    await approveSummary(aliceDb, alice.id, approvedId);
    await expect(discardSummary(aliceDb, alice.id, approvedId)).rejects.toBeInstanceOf(SummaryNotFound);
    expect((await summariesFor(aliceDb, alice.id, karinId)).approved).not.toBeNull();
  });

  it("edits the approved summary, marks it yours, and drops sources of emptied parts", async () => {
    const id = await pending();
    await approveSummary(aliceDb, alice.id, id);

    const edited = await editSummary(aliceDb, alice.id, id, {
      who_they_are: "Head of platform, Fortnox Växjö.",
      how_you_know: "Met at the LNU guest lecture.",
      discussed: null,
      next_step: null,
    });

    expect(edited).toMatchObject({
      status: "approved",
      edited: true,
      who_they_are: "Head of platform, Fortnox Växjö.",
      how_you_know: "Met at the LNU guest lecture.",
      discussed: null,
      sources: { who_they_are: [SOURCE] },
    });
  });

  it("won't edit a summary that's still pending", async () => {
    const id = await pending();
    await expect(
      editSummary(aliceDb, alice.id, id, { who_they_are: "x", how_you_know: null, discussed: null, next_step: null }),
    ).rejects.toBeInstanceOf(SummaryNotFound);
  });

  it("lets nobody else approve, discard or edit it", async () => {
    const id = await pending("Private.");

    for (const userId of [bob.id, alice.id]) {
      await expect(approveSummary(bobDb, userId, id)).rejects.toBeInstanceOf(SummaryNotFound);
      await expect(discardSummary(bobDb, userId, id)).rejects.toBeInstanceOf(SummaryNotFound);
    }

    await approveSummary(aliceDb, alice.id, id);
    for (const userId of [bob.id, alice.id]) {
      await expect(
        editSummary(bobDb, userId, id, { who_they_are: "attacker", how_you_know: null, discussed: null, next_step: null }),
      ).rejects.toBeInstanceOf(SummaryNotFound);
    }
    expect(await summariesFor(bobDb, bob.id, karinId)).toEqual({ approved: null, pending: null });

    const { approved } = await summariesFor(aliceDb, alice.id, karinId);
    expect(approved).toMatchObject({ discussed: "Private.", edited: false });
  });
});

describe("parseSummaryForm", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("trims each part, and treats empty as nothing", () => {
    expect(parseSummaryForm(form({ who_they_are: "  Runs a team. ", how_you_know: "   ", discussed: "A\r\nB" }))).toEqual({
      ok: true,
      parts: { who_they_are: "Runs a team.", how_you_know: null, discussed: "A\nB", next_step: null },
    });
  });

  it("refuses an overlong part and hands back what was typed", () => {
    const long = "x".repeat(MAX_PART_CHARS + 1);
    const parsed = parseSummaryForm(form({ discussed: long, next_step: "Call." }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual({ discussed: "Keep it under 2,000 characters." });
    expect(parsed.values).toEqual({ who_they_are: "", how_you_know: "", discussed: long, next_step: "Call." });
  });
});
