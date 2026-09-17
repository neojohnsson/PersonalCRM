import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addressMatchesName,
  checkReferral,
  matchPeople,
  normaliseName,
  type ContactCandidate,
} from "@/lib/relationship/referral";

/**
 * The referral check: who "Niklas Hedlund" is in your mail, and whether you've
 * written to them since the referral. Matching on its own, then against the
 * real database with two users.
 */

const contact = (id: string, first: string | null, last: string | null, emails: string[]): ContactCandidate => ({
  id,
  first_name: first,
  last_name: last,
  primary_email: emails[0] ?? null,
  emails,
});

describe("matching a referral to people", () => {
  it("normalises names: case, accents and punctuation don't matter", () => {
    expect(normaliseName("Östen Å.-Berg")).toBe("ostenaberg");
    expect(normaliseName("NIKLAS  hedlund")).toBe("niklashedlund");
  });

  it("matches addresses built from the name, in either order, but not a first name alone", () => {
    for (const email of ["niklas.hedlund@combitech.com", "niklashedlund@x.se", "hedlund.niklas@x.se", "Niklas_Hedlund@x.se"]) {
      expect(addressMatchesName(email, "Niklas Hedlund")).toBe(true);
    }
    expect(addressMatchesName("niklas@combitech.com", "Niklas Hedlund")).toBe(false);
    expect(addressMatchesName("niklas@combitech.com", "Niklas")).toBe(false);
    expect(addressMatchesName("nhedlund@combitech.com", "Niklas Hedlund")).toBe(false);
    expect(addressMatchesName("asa.oberg@x.se", "Åsa Öberg")).toBe(true);
  });

  it("finds a contact with no name through their address — the real case", () => {
    const matches = matchPeople(
      { name: "Niklas Hedlund", email: null },
      [contact("c1", null, null, ["niklas.hedlund@combitech.com"]), contact("c2", "Martin", "Ryd", ["martin.ryd@combitech.com"])],
      [],
    );
    expect(matches).toEqual([{ contactId: "c1", label: "niklas.hedlund@combitech.com", emails: ["niklas.hedlund@combitech.com"] }]);
  });

  it("finds a contact by name, and counts all their addresses as one person", () => {
    const matches = matchPeople(
      { name: "niklas hedlund", email: null },
      [contact("c1", "Niklas", "Hedlund", ["nh@combitech.com", "niklas@gmail.com"])],
      [{ email: "nh@combitech.com", name: "Niklas Hedlund" }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ contactId: "c1", label: "Niklas Hedlund" });
  });

  it("finds someone who isn't a contact, by the name on their mail or the address given", () => {
    expect(
      matchPeople({ name: "Niklas Hedlund", email: null }, [], [{ email: "nh@combitech.com", name: "Niklas Hedlund" }]),
    ).toEqual([{ contactId: null, label: "Niklas Hedlund", emails: ["nh@combitech.com"] }]);

    expect(
      matchPeople({ name: "Niklas", email: "NH@Combitech.com" }, [], [{ email: "nh@combitech.com", name: null }]),
    ).toEqual([{ contactId: null, label: "nh@combitech.com", emails: ["nh@combitech.com"] }]);
  });

  it("returns every different person with the name, so the caller can refuse to guess", () => {
    const matches = matchPeople(
      { name: "Niklas Hedlund", email: null },
      [contact("c1", "Niklas", "Hedlund", ["niklas.hedlund@combitech.com"])],
      [{ email: "niklas.hedlund@saab.se", name: null }],
    );
    expect(matches).toHaveLength(2);
  });

  it("finds nobody when nothing matches", () => {
    expect(matchPeople({ name: "Niklas Hedlund", email: null }, [contact("c1", "Nils", "Hed", ["nils@x.se"])], [])).toEqual([]);
  });
});

// ── Against the database ────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signedInUser(label: string): Promise<{ user: User; db: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `referral-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

describe("checkReferral", () => {
  let alice: User;
  let bob: User;
  let aliceDb: SupabaseClient;
  let bobDb: SupabaseClient;
  let niklasId: string;

  const REFERRED_AT = "2026-09-11T10:00:00Z";
  const referral = { name: "Niklas Hedlund", email: null, since: REFERRED_AT };

  const outbound = (userId: string, id: string, date: string, to: string) => ({
    user_id: userId,
    gmail_message_id: id,
    thread_id: `t-${id}`,
    internal_date: date,
    from_email: "me@example.se",
    to_emails: [to],
    cc_emails: [],
    direction: "outbound",
    has_list_unsubscribe: false,
    subject: "Hej",
  });

  beforeAll(async () => {
    ({ user: alice, db: aliceDb } = await signedInUser("alice"));
    ({ user: bob, db: bobDb } = await signedInUser("bob"));

    const { data, error } = await aliceDb
      .from("contacts")
      .insert({ user_id: alice.id, source: "gmail" })
      .select("id")
      .single();
    if (error) throw error;
    niklasId = data.id;
    const { error: emailError } = await aliceDb
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: niklasId, email: "niklas.hedlund@combitech.com", is_primary: true });
    if (emailError) throw emailError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("is open when you only wrote to them before the referral, and nobody else's mail counts", async () => {
    await aliceDb.from("gmail_messages").insert(outbound(alice.id, "before", "2026-09-01T09:00:00Z", "niklas.hedlund@combitech.com"));
    // Bob writing to an address with the same name is Bob's business, not Alice's.
    await bobDb.from("gmail_messages").insert(outbound(bob.id, "bobs", "2026-09-12T09:00:00Z", "niklas.hedlund@combitech.com"));

    expect(await checkReferral(aliceDb, alice.id, referral)).toEqual({
      kind: "open",
      contactId: niklasId,
      label: "niklas.hedlund@combitech.com",
    });
  });

  it("is done once you've written to them after the referral, with the first date you did", async () => {
    await aliceDb
      .from("gmail_messages")
      .insert([
        outbound(alice.id, "after", "2026-09-12T08:30:00Z", "niklas.hedlund@combitech.com"),
        outbound(alice.id, "later", "2026-09-15T08:30:00Z", "niklas.hedlund@combitech.com"),
      ]);

    const status = await checkReferral(aliceDb, alice.id, referral);
    expect(status).toMatchObject({ kind: "done", contactId: niklasId });
    expect(new Date((status as { at: string }).at).toISOString()).toBe("2026-09-12T08:30:00.000Z");
  });

  it("refuses to guess between two people, and knows nobody it can't find", async () => {
    await aliceDb.from("gmail_messages").insert(outbound(alice.id, "other", "2026-09-02T09:00:00Z", "niklas.hedlund@saab.se"));

    expect(await checkReferral(aliceDb, alice.id, referral)).toEqual({ kind: "ambiguous", count: 2 });
    expect(await checkReferral(aliceDb, alice.id, { ...referral, name: "Ingrid Svensson" })).toEqual({ kind: "unknown" });
  });

  it("finds nothing of Alice's for Bob", async () => {
    expect(await checkReferral(bobDb, alice.id, referral)).toEqual({ kind: "unknown" });
  });
});
