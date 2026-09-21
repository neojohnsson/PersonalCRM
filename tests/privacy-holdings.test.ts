import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { headline, isEmpty, loadHoldings } from "@/lib/privacy/holdings";

/**
 * The privacy page counts what is really stored (docs/slice-7-plan.md, Part 1).
 *
 * Two users, because a page that says "21 contacts" while counting somebody
 * else's would be worse than no page at all.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `privacy-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe("what the app holds", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;

  const countOf = (holdings: Awaited<ReturnType<typeof loadHoldings>>, table: string) =>
    holdings.find((holding) => holding.table === table)!.count;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: contacts, error } = await aliceClient
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Karin", source: "gmail" },
        { user_id: alice.id, first_name: "Pär", source: "manual" },
      ])
      .select("id");
    if (error) throw error;

    const { error: emailError } = await aliceClient.from("contact_emails").insert({
      user_id: alice.id,
      contact_id: contacts[0].id,
      email: "karin@fortnox.se",
      is_primary: true,
    });
    if (emailError) throw emailError;

    const { error: touchError } = await aliceClient.from("next_touches").insert({
      user_id: alice.id,
      contact_id: contacts[0].id,
      due_on: "2026-10-05",
      reason: "Ask about the thesis",
    });
    if (touchError) throw touchError;

    // Bob's own contact, which must never appear in Alice's numbers.
    const { error: bobError } = await bobClient
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Someone", source: "manual" });
    if (bobError) throw bobError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("counts every table the app has", async () => {
    const holdings = await loadHoldings(aliceClient, alice.id);

    // If a migration adds a table and nobody adds it here, the page quietly
    // stops telling the whole truth. This is the check against that.
    expect(holdings.map((holding) => holding.table).sort()).toEqual([
      "ai_usage",
      "calendar_meetings",
      "contact_drafts",
      "contact_emails",
      "contact_summaries",
      "contacts",
      "duplicate_dismissals",
      "gmail_messages",
      "gmail_sync_state",
      "google_accounts",
      "google_calendar",
      "next_touches",
      "profiles",
      "promises",
      "seen_once_dismissals",
      "settled_threads",
    ]);
  });

  it("counts what is really there, and nothing of anybody else's", async () => {
    const hers = await loadHoldings(aliceClient, alice.id);

    expect(countOf(hers, "contacts")).toBe(2);
    expect(countOf(hers, "contact_emails")).toBe(1);
    expect(countOf(hers, "next_touches")).toBe(1);
    expect(countOf(hers, "gmail_messages")).toBe(0);

    const his = await loadHoldings(bobClient, bob.id);
    expect(countOf(his, "contacts")).toBe(1);
    expect(countOf(his, "next_touches")).toBe(0);
  });

  it("says in one line what is held, and that bodies are not", async () => {
    const holdings = await loadHoldings(aliceClient, alice.id);

    expect(headline(holdings)).toBe("2 contacts, 0 message details, 0 AI summaries. No message bodies.");
    expect(isEmpty(holdings)).toBe(false);
  });

  it("says nothing is held when nothing is", async () => {
    const nobody = await createUser("empty");
    const theirClient = await signInAs(nobody.email!);
    try {
      const holdings = await loadHoldings(theirClient, nobody.id);

      expect(isEmpty(holdings)).toBe(true);
      expect(headline(holdings)).toBe("0 contacts, 0 message details, 0 AI summaries. No message bodies.");
    } finally {
      await admin.auth.admin.deleteUser(nobody.id);
    }
  });

  it("says the same thing about meeting titles as the calendar page does", async () => {
    const holdings = await loadHoldings(aliceClient, alice.id);
    const meetings = holdings.find((holding) => holding.table === "calendar_meetings")!;

    // Slice 8b started reading titles to draw the week three commits after
    // this line promised the app never asked for them. It now says what the
    // code does: read for the page, never written down.
    expect(meetings.what).toContain("never written down");
    expect(meetings.what).not.toContain("never asks Google for them");
  });

  it("describes every line in words a person in the list could read", async () => {
    const holdings = await loadHoldings(aliceClient, alice.id);

    for (const holding of holdings) {
      expect(holding.what.length, holding.table).toBeGreaterThan(30);
      expect(holding.what.trim().endsWith("."), holding.table).toBe(true);
      // No table names on the page: the words are for people, not developers.
      expect(holding.what).not.toContain("_");
    }
  });
});
