import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Merging two contacts that are the same person (migration 0017): addresses
 * move, empty fields fill, what you wrote is never overwritten, and nobody
 * merges anyone else's contacts.
 *
 * Fails until supabase/migrations/0017_merge_contacts.sql has been run.
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
    email: `merge-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

describe("merge_contacts", () => {
  let alice: User;
  let bob: User;
  let db: SupabaseClient;
  let bobDb: SupabaseClient;

  beforeAll(async () => {
    ({ user: alice, db } = await signedInUser("alice"));
    ({ user: bob, db: bobDb } = await signedInUser("bob"));
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  beforeEach(async () => {
    await db.from("contacts").delete().eq("user_id", alice.id);
  });

  /** The real case: a named contact holding his reply, an unnamed one holding your mail. */
  async function twoCarls(): Promise<{ keep: string; merge: string }> {
    const { data, error } = await db
      .from("contacts")
      .insert([
        {
          user_id: alice.id,
          first_name: "Carl-Johan",
          last_name: "Hultenheim",
          source: "gmail",
          notes: "Met at the Atea stand.",
          tags: ["atea"],
        },
        { user_id: alice.id, source: "gmail", company: "Atea", phone: "+46 70 111 22 33", notes: "Answers fast.", tags: ["växjö"] },
      ])
      .select("id, first_name");
    if (error) throw error;
    const keep = data.find((row) => row.first_name === "Carl-Johan")!.id;
    const merge = data.find((row) => row.first_name === null)!.id;

    const { error: emailError } = await db.from("contact_emails").insert([
      { user_id: alice.id, contact_id: keep, email: "carl-johan.hultenheim@atea.com", is_primary: true },
      { user_id: alice.id, contact_id: merge, email: "carl-johan.hultenheim@atea.se", is_primary: true },
    ]);
    if (emailError) throw emailError;
    return { keep, merge };
  }

  const merge = (client: SupabaseClient, userId: string, keep: string, other: string) =>
    client.rpc("merge_contacts", { p_user_id: userId, p_keep_id: keep, p_merge_id: other });

  it("moves the addresses, fills what's empty, and keeps what you wrote", async () => {
    const { keep, merge: other } = await twoCarls();

    const { error } = await merge(db, alice.id, keep, other);
    expect(error).toBeNull();

    // contact_list has no notes or phone; those live on the contact itself.
    const { data: contacts, error: readError } = await db
      .from("contacts")
      .select("id, first_name, company, phone, notes, tags")
      .eq("user_id", alice.id);
    expect(readError).toBeNull();
    expect(contacts).toHaveLength(1);
    expect(contacts![0]).toMatchObject({
      id: keep,
      first_name: "Carl-Johan",
      // Empty on the kept contact, filled from the other.
      company: "Atea",
      phone: "+46 70 111 22 33",
    });

    const { data: list } = await db.from("contact_list").select("emails").eq("id", keep).single();
    expect([...list!.emails].sort()).toEqual([
      "carl-johan.hultenheim@atea.com",
      "carl-johan.hultenheim@atea.se",
    ]);
    // Your own notes are kept, the other's appended and marked.
    expect(contacts![0].notes).toContain("Met at the Atea stand.");
    expect(contacts![0].notes).toContain("merged from the duplicate");
    expect(contacts![0].notes).toContain("Answers fast.");
    expect([...contacts![0].tags].sort()).toEqual(["atea", "växjö"]);
  });

  it("never overwrites a field the kept contact already has", async () => {
    const { keep, merge: other } = await twoCarls();
    await db.from("contacts").update({ company: "Atea Sverige" }).eq("id", keep);

    await merge(db, alice.id, keep, other);

    const { data } = await db.from("contacts").select("company").eq("id", keep).single();
    expect(data).toEqual({ company: "Atea Sverige" });
  });

  it("takes the other's summary and next touch only when the kept one has none", async () => {
    const { keep, merge: other } = await twoCarls();

    await db.from("contact_summaries").insert({
      user_id: alice.id,
      contact_id: other,
      discussed: "From the duplicate.",
      as_of: "2026-09-10T09:00:00Z",
      model: "gpt-5.6-luna",
    });
    await db.from("next_touches").insert([
      { user_id: alice.id, contact_id: keep, due_on: "2026-10-01", reason: "Mine" },
      { user_id: alice.id, contact_id: other, due_on: "2026-09-25", reason: "The duplicate's" },
    ]);

    await merge(db, alice.id, keep, other);

    // No summary of its own, so the other's moves over.
    const { data: summaries } = await db.from("contact_summaries").select("contact_id, discussed");
    expect(summaries).toEqual([{ contact_id: keep, discussed: "From the duplicate." }]);

    // It had a next touch, so that one stays and the duplicate's goes.
    const { data: touches } = await db.from("next_touches").select("contact_id, reason");
    expect(touches).toEqual([{ contact_id: keep, reason: "Mine" }]);
  });

  it("refuses a contact that isn't yours, in either place, and merging one with itself", async () => {
    const { keep, merge: other } = await twoCarls();
    const { data: bobs } = await bobDb
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Bobs", source: "manual" })
      .select("id")
      .single();

    expect((await merge(db, alice.id, keep, bobs!.id)).error?.code).toBe("P0002");
    expect((await merge(bobDb, bob.id, bobs!.id, keep)).error?.code).toBe("P0002");
    expect((await merge(bobDb, alice.id, keep, other)).error?.code).toBe("42501");
    expect((await merge(db, alice.id, keep, keep)).error?.code).toBe("22023");

    // Everything is still where it was.
    const { data } = await db.from("contacts").select("id").eq("user_id", alice.id);
    expect(data).toHaveLength(2);
  });

  it("remembers a pair you said isn't the same person, and only for you", async () => {
    const { keep, merge: other } = await twoCarls();
    const [a, b] = [keep, other].sort();

    const { error } = await db.from("duplicate_dismissals").insert({ user_id: alice.id, contact_a: a, contact_b: b });
    expect(error).toBeNull();

    expect((await bobDb.from("duplicate_dismissals").select("*")).data).toEqual([]);
    // The pair is stored one way round, so it reads the same next time.
    const { error: wrongWayRound } = await db
      .from("duplicate_dismissals")
      .insert({ user_id: alice.id, contact_a: b, contact_b: a });
    expect(wrongWayRound).not.toBeNull();
  });
});
