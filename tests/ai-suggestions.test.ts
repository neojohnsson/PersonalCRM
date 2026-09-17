import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applySuggestedField } from "@/lib/ai/suggestions";

/**
 * Taking a company or role from a summary: one field, only over what the page
 * showed, and never someone else's contact.
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
    email: `suggest-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

describe("applySuggestedField", () => {
  let alice: User;
  let bob: User;
  let aliceDb: SupabaseClient;
  let bobDb: SupabaseClient;
  let karinId: string;
  let summaryId: string;

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

    const { data: summary, error: summaryError } = await aliceDb
      .from("contact_summaries")
      .insert({
        user_id: alice.id,
        contact_id: karinId,
        discussed: "The thesis.",
        suggested_company: "Fortnox",
        suggested_role: null,
        as_of: "2026-09-12T10:00:00Z",
        model: "gpt-5.6-luna",
      })
      .select("id")
      .single();
    if (summaryError) throw summaryError;
    summaryId = summary.id;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  const setCompany = async (company: string | null) => {
    const { error } = await aliceDb.from("contacts").update({ company, role: "Keep me" }).eq("id", karinId);
    if (error) throw error;
  };

  const contact = async () =>
    (await aliceDb.from("contacts").select("company, role").eq("id", karinId).single()).data;

  beforeEach(async () => {
    await setCompany(null);
  });

  it("sets an empty company, and only the company", async () => {
    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "company", null)).toBe("applied");
    expect(await contact()).toEqual({ company: "Fortnox", role: "Keep me" });
  });

  it("also counts an empty string as empty", async () => {
    await setCompany("");
    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "company", "")).toBe("applied");
    expect((await contact())?.company).toBe("Fortnox");
  });

  it("replaces a company only when it's still the one the page showed", async () => {
    await setCompany("Fortnox AB");

    // The page showed an empty field, but it has a company now: nothing written.
    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "company", null)).toBe("changed");
    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "company", "Visma")).toBe("changed");
    expect((await contact())?.company).toBe("Fortnox AB");

    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "company", "Fortnox AB")).toBe("applied");
    expect((await contact())?.company).toBe("Fortnox");
  });

  it("does nothing when there's no suggestion for that field", async () => {
    expect(await applySuggestedField(aliceDb, alice.id, summaryId, "role", "Keep me")).toBe("not_found");
    expect((await contact())?.role).toBe("Keep me");
  });

  it("lets nobody else apply a suggestion to Alice's contact", async () => {
    for (const userId of [bob.id, alice.id]) {
      expect(await applySuggestedField(bobDb, userId, summaryId, "company", null)).toBe("not_found");
    }
    expect((await contact())?.company).toBeNull();
  });
});
