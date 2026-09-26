import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0025, with two users (docs/slice-11-plan.md; AGENTS.md: "RLS
 * policies get tested with two users").
 *
 *   entitlements        you can read yours, and nobody can write any — not
 *                       even their own, which is the whole point of a premium
 *                       flag living outside `profiles`
 *   assistant_actions   yours only, about your contacts only, and never
 *                       deleted one line at a time
 *   ai_usage            the Assistant draws from its own budget line, and a
 *                       summary cannot be starved by it
 *
 * Fails until supabase/migrations/0025_assistant.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; contactId: string };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `assistant-${name}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;

  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ user_id: data.user.id, first_name: name === "alice" ? "Karin" : "Johan", source: "manual" })
    .select("id")
    .single();
  if (contactError) throw contactError;

  return { user: data.user, db, contactId: contact.id };
}

const action = (who: Person, over: Record<string, unknown> = {}) => ({
  user_id: who.user.id,
  contact_id: who.contactId,
  kind: "note",
  summary: "Added a note",
  before: { notes: null },
  after: { notes: "Wants to know the thesis period." },
  ...over,
});

let alice: Person;
let bob: Person;

beforeAll(async () => {
  alice = await person("alice");
  bob = await person("bob");
  // Only the owner can write an entitlement -- exactly what the tests check.
  const { error } = await admin.from("entitlements").insert({ user_id: alice.user.id, plan: "pro" });
  if (error) throw error;
});

afterAll(async () => {
  for (const who of [alice, bob]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("the premium flag", () => {
  it("can be read by its owner", async () => {
    const { data } = await alice.db.from("entitlements").select("plan").eq("user_id", alice.user.id).single();
    expect(data?.plan).toBe("pro");
  });

  it("cannot be switched on by the user it belongs to", async () => {
    // The reason it is not a column on `profiles`: there, "update your own
    // row" would include this. Here nobody holds the privilege to write.
    const { error: insertError } = await bob.db.from("entitlements").insert({ user_id: bob.user.id, plan: "pro" });
    expect(insertError).not.toBeNull();

    await alice.db.from("entitlements").update({ plan: "free" }).eq("user_id", alice.user.id);
    const { data: stillOn } = await admin.from("entitlements").select("plan").eq("user_id", alice.user.id).single();
    expect(stillOn?.plan).toBe("pro");

    await alice.db.from("entitlements").delete().eq("user_id", alice.user.id);
    const { data: stillThere } = await admin.from("entitlements").select("user_id").eq("user_id", alice.user.id);
    expect(stillThere).toHaveLength(1);
  });

  it("cannot be seen by anybody else", async () => {
    const { data } = await bob.db.from("entitlements").select("*");
    expect(data).toEqual([]);
  });
});

describe("what the Assistant did", () => {
  it("is recorded for your own contact", async () => {
    const { error } = await alice.db.from("assistant_actions").insert(action(alice));
    expect(error).toBeNull();
  });

  it("cannot be recorded about somebody else's contact, or in their name", async () => {
    // Bob naming himself but Alice's contact: the composite foreign key.
    const { error: theirContact } = await bob.db
      .from("assistant_actions")
      .insert(action(bob, { contact_id: alice.contactId }));
    expect(theirContact).not.toBeNull();

    // Bob naming Alice: the insert policy.
    const { error: theirName } = await bob.db.from("assistant_actions").insert(action(alice));
    expect(theirName).not.toBeNull();
  });

  it("cannot be read, undone or erased by anybody else", async () => {
    const { data } = await bob.db.from("assistant_actions").select("*");
    expect(data).toEqual([]);

    await bob.db.from("assistant_actions").update({ undone_at: new Date().toISOString() }).eq("user_id", alice.user.id);
    const { data: untouched } = await admin
      .from("assistant_actions")
      .select("undone_at")
      .eq("user_id", alice.user.id);
    expect(untouched!.every((row) => row.undone_at === null)).toBe(true);
  });

  it("can be marked undone by its owner, and never deleted a line at a time", async () => {
    const { data: row } = await alice.db
      .from("assistant_actions")
      .insert(action(alice, { summary: "Moved a next touch" }))
      .select("id")
      .single();

    const { error: undoError } = await alice.db
      .from("assistant_actions")
      .update({ undone_at: new Date().toISOString() })
      .eq("id", row!.id);
    expect(undoError).toBeNull();

    // No delete policy: a record of what an AI did that could be quietly
    // erased would not be much of a record.
    await alice.db.from("assistant_actions").delete().eq("id", row!.id);
    const { data: kept } = await admin.from("assistant_actions").select("id").eq("id", row!.id);
    expect(kept).toHaveLength(1);
  });

  it("refuses a kind the Assistant is not allowed to do", async () => {
    // contact_creation: let in by an unmerged branch's migration, put back
    // out by 0029_contact_creation_dropped.sql (fails until that is run).
    for (const kind of ["delete_contact", "merge", "send", "draft", "event", "contact_creation"]) {
      const { error } = await alice.db.from("assistant_actions").insert(action(alice, { kind }));
      expect(error, kind).not.toBeNull();
    }
  });

  it("goes with the contact", async () => {
    const { data: contact } = await alice.db
      .from("contacts")
      .insert({ user_id: alice.user.id, first_name: "Temporary", source: "manual" })
      .select("id")
      .single();
    await alice.db.from("assistant_actions").insert(action(alice, { contact_id: contact!.id }));

    await admin.from("contacts").delete().eq("id", contact!.id);

    const { data } = await admin.from("assistant_actions").select("id").eq("contact_id", contact!.id);
    expect(data).toEqual([]);
  });
});

describe("the Assistant's own budget line", () => {
  const reserve = (who: Person, purpose: string, estimate: number, cap: number) =>
    who.db.rpc("reserve_ai_spend", {
      p_user_id: who.user.id,
      p_contact_id: null,
      p_purpose: purpose,
      p_model: "gpt-5.4-mini",
      p_estimate: estimate,
      p_cap: cap,
    });

  it("does not let a long conversation starve a summary", async () => {
    // Spend the Assistant's line right up to its cap...
    const { error: bigStep } = await reserve(bob, "assistant", 9.5, 10);
    expect(bigStep).toBeNull();
    const { error: overTheTop } = await reserve(bob, "assistant", 1, 10);
    expect(overTheTop?.message).toBe("ai_cap_reached");

    // ...and a summary still has its whole $2, because it counts only its own.
    const { error: summary } = await reserve(bob, "summary", 1.5, 2);
    expect(summary).toBeNull();
  });

  it("does not let summaries eat the Assistant's budget either", async () => {
    const { user } = alice;
    const { error: summaries } = await alice.db.rpc("reserve_ai_spend", {
      p_user_id: user.id,
      p_contact_id: null,
      p_purpose: "summary",
      p_model: "gpt-5.6-luna",
      p_estimate: 1.9,
      p_cap: 2,
    });
    expect(summaries).toBeNull();

    const { error: assistant } = await reserve(alice, "assistant", 5, 10);
    expect(assistant).toBeNull();
  });

  it("still refuses to reserve in somebody else's name", async () => {
    const { error } = await bob.db.rpc("reserve_ai_spend", {
      p_user_id: alice.user.id,
      p_contact_id: null,
      p_purpose: "assistant",
      p_model: "gpt-5.4-mini",
      p_estimate: 0.1,
      p_cap: 10,
    });
    expect(error?.message).toBe("not_allowed");
  });
});
