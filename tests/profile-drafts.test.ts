import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Profiles, drafts, granted scopes and draft spending (migration 0014), as two
 * signed-in users: each sees and changes only their own.
 *
 * Fails until supabase/migrations/0014_profile_and_drafts.sql has been run.
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

const anonClient = () =>
  createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signedInUser(label: string): Promise<{ user: User; db: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `drafts-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

describe("profiles and drafts (0014)", () => {
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

  describe("profiles", () => {
    it("has sensible defaults, and one row per user", async () => {
      const { data, error } = await aliceDb
        .from("profiles")
        .insert({ user_id: alice.id, display_name: "Alice" })
        .select("display_name, tone, length, address_by, languages, never_write, links")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({
        display_name: "Alice",
        tone: "friendly",
        length: "medium",
        address_by: "first_name",
        languages: [],
        never_write: [],
        links: [],
      });

      const { error: second } = await aliceDb.from("profiles").insert({ user_id: alice.id });
      expect(second?.code).toBe(UNIQUE_VIOLATION);
    });

    it("refuses values outside the choices and limits", async () => {
      for (const bad of [
        { tone: "rude" },
        { length: "novel" },
        { address_by: "nickname" },
        { what_you_do: "x".repeat(501) },
        { never_write: Array.from({ length: 21 }, (_, i) => `phrase ${i}`) },
        { links: { label: "not a list" } },
      ]) {
        const { error } = await aliceDb.from("profiles").update(bad).eq("user_id", alice.id);
        expect(error, JSON.stringify(bad)).not.toBeNull();
      }
    });

    it("is invisible and untouchable to someone else, and to signed-out visitors", async () => {
      expect((await bobDb.from("profiles").select("*")).data).toEqual([]);

      const { data: changed } = await bobDb
        .from("profiles")
        .update({ display_name: "attacker" })
        .eq("user_id", alice.id)
        .select();
      expect(changed).toEqual([]);

      const { error: asAlice } = await bobDb.from("profiles").insert({ user_id: alice.id });
      expect(asAlice).not.toBeNull();

      expect((await anonClient().from("profiles").select("*")).data ?? []).toEqual([]);
      expect((await aliceDb.from("profiles").select("display_name").single()).data).toEqual({ display_name: "Alice" });
    });
  });

  describe("contact_drafts", () => {
    beforeEach(async () => {
      await aliceDb.from("contact_drafts").delete().eq("user_id", alice.id);
    });

    const pending = (userId: string, contactId: string, extra: Record<string, unknown> = {}) => ({
      user_id: userId,
      contact_id: contactId,
      thread_id: "thread-1",
      subject: "Re: Examensarbete",
      body: "Hej Karin, tack för ditt svar!",
      language: "Swedish",
      tone: "friendly",
      model: "gpt-5-mini",
      ...extra,
    });

    it("can only be created as pending, holding its text", async () => {
      const { error } = await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId));
      expect(error).toBeNull();

      await aliceDb.from("contact_drafts").delete().eq("user_id", alice.id);
      for (const sneaky of [
        { status: "saved", body: null, gmail_draft_id: "r-1", saved_at: new Date().toISOString() },
        { body: null },
        { gmail_draft_id: "r-1" },
      ]) {
        const { error: refused } = await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId, sneaky));
        expect(refused, JSON.stringify(sneaky)).not.toBeNull();
      }
    });

    it("keeps one pending draft per contact", async () => {
      await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId));
      const { error } = await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId));
      expect(error?.code).toBe(UNIQUE_VIOLATION);
    });

    it("becomes saved only with a Gmail draft id and without its text", async () => {
      const { data } = await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId)).select("id").single();

      const keepsText = await aliceDb
        .from("contact_drafts")
        .update({ status: "saved", gmail_draft_id: "r-1", saved_at: new Date().toISOString() })
        .eq("id", data!.id);
      expect(keepsText.error).not.toBeNull();

      const saved = await aliceDb
        .from("contact_drafts")
        .update({ status: "saved", body: null, gmail_draft_id: "r-1", saved_at: new Date().toISOString() })
        .eq("id", data!.id)
        .select("status, body, gmail_draft_id")
        .single();
      expect(saved.error).toBeNull();
      expect(saved.data).toEqual({ status: "saved", body: null, gmail_draft_id: "r-1" });
    });

    it("is invisible to someone else, who can't hang a draft off Alice's contact either", async () => {
      const { data } = await aliceDb.from("contact_drafts").insert(pending(alice.id, karinId)).select("id").single();

      expect((await bobDb.from("contact_drafts").select("*")).data).toEqual([]);
      const { data: changed } = await bobDb
        .from("contact_drafts")
        .update({ body: "attacker" })
        .eq("id", data!.id)
        .select();
      expect(changed).toEqual([]);
      await bobDb.from("contact_drafts").delete().eq("id", data!.id);
      expect((await aliceDb.from("contact_drafts").select("body").eq("id", data!.id).single()).data).toEqual({
        body: "Hej Karin, tack för ditt svar!",
      });

      // With Alice's pending draft gone, so the "one pending per contact" index
      // can't refuse first: this checks the foreign key itself.
      await aliceDb.from("contact_drafts").delete().eq("user_id", alice.id);
      const { error: ownId } = await bobDb.from("contact_drafts").insert(pending(bob.id, karinId));
      expect(ownId?.code).toBe(FOREIGN_KEY_VIOLATION);
      const { error: aliceId } = await bobDb.from("contact_drafts").insert(pending(alice.id, karinId));
      expect(aliceId).not.toBeNull();
    });
  });

  describe("scopes and draft spending", () => {
    it("records granted scopes on the Gmail connection, empty by default", async () => {
      const { data, error } = await aliceDb
        .from("google_accounts")
        .insert({ user_id: alice.id, email: "alice@example.com", refresh_token_encrypted: "x" })
        .select("scopes")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({ scopes: [] });
    });

    it("lets drafts reserve spending under the same cap", async () => {
      const { error } = await aliceDb.rpc("reserve_ai_spend", {
        p_user_id: alice.id,
        p_contact_id: karinId,
        p_purpose: "draft",
        p_model: "gpt-5-mini",
        p_estimate: 0.01,
        p_cap: 2,
      });
      expect(error).toBeNull();

      const { error: unknown } = await aliceDb.rpc("reserve_ai_spend", {
        p_user_id: alice.id,
        p_contact_id: karinId,
        p_purpose: "sending",
        p_model: "gpt-5-mini",
        p_estimate: 0.01,
        p_cap: 2,
      });
      expect(unknown).not.toBeNull();
    });
  });
});
