import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * google_calendar and calendar_meetings (migration 0022;
 * docs/slice-8-plan.md, Parts 1 and 2).
 *
 * Two users, as for every table: Alice connects her calendar and records a
 * meeting, and Bob must not be able to see either, record a meeting against her
 * contact, or read her token.
 *
 * Fails until supabase/migrations/0022_calendar.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `calendar-${label}-${randomUUID()}@example.com`,
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

describe("the calendar connection and its meetings", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;
  let bobsContactId: string;

  const meeting = (extra: Record<string, unknown> = {}) => ({
    user_id: alice.id,
    contact_id: karinId,
    event_id: "evt-coffee",
    started_at: "2026-09-22T09:00:00Z",
    ended_at: "2026-09-22T10:00:00Z",
    ...extra,
  });

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: karin, error } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Karin", source: "gmail" })
      .select("id")
      .single();
    if (error) throw error;
    karinId = karin.id;

    const { data: bobs, error: bobsError } = await bobClient
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Someone", source: "manual" })
      .select("id")
      .single();
    if (bobsError) throw bobsError;
    bobsContactId = bobs.id;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("keeps the calendar connection apart from Gmail's", async () => {
    const { data, error } = await aliceClient
      .from("google_calendar")
      .insert({
        user_id: alice.id,
        email: "alice@example.se",
        refresh_token_encrypted: "pretend-this-is-encrypted",
        scopes: [CALENDAR_SCOPE],
      })
      .select("scopes, synced_through")
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({ scopes: [CALENDAR_SCOPE], synced_through: null });

    // Connecting the calendar didn't invent a Gmail connection.
    const { data: gmail } = await aliceClient.from("google_accounts").select("id");
    expect(gmail).toEqual([]);
  });

  it("won't show another user the connection, or its token", async () => {
    const { data, error } = await bobClient.from("google_calendar").select("email, refresh_token_encrypted");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("records a meeting once, however many times the event is read", async () => {
    const first = await aliceClient.from("calendar_meetings").insert(meeting());
    expect(first.error).toBeNull();

    const again = await aliceClient.from("calendar_meetings").insert(meeting());
    expect(again.error?.code).toBe("23505");

    // Upserting is how a re-read updates a moved meeting rather than doubling it.
    const moved = await aliceClient.from("calendar_meetings").upsert(
      meeting({ started_at: "2026-09-22T11:00:00Z", ended_at: "2026-09-22T12:00:00Z" }),
      { onConflict: "user_id,contact_id,event_id" },
    );
    expect(moved.error).toBeNull();

    const { data } = await aliceClient.from("calendar_meetings").select("started_at, accepted");
    expect(data).toHaveLength(1);
    expect(data![0].accepted).toBe(true);
  });

  it("counts the same event once per contact in it", async () => {
    const { data: johan, error } = await aliceClient
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Johan", source: "gmail" })
      .select("id")
      .single();
    if (error) throw error;

    // The same meeting, two contacts: a fact about each of them.
    const both = await aliceClient.from("calendar_meetings").insert(meeting({ contact_id: johan.id }));
    expect(both.error).toBeNull();

    const { data } = await aliceClient.from("calendar_meetings").select("contact_id").eq("event_id", "evt-coffee");
    expect(data).toHaveLength(2);
  });

  it("refuses a meeting that ends before it starts", async () => {
    const { error } = await aliceClient
      .from("calendar_meetings")
      .insert(meeting({ event_id: "evt-backwards", ended_at: "2026-09-22T08:00:00Z" }));

    expect(error?.code).toBe("23514");
  });

  it("won't let another user record or read a meeting of yours", async () => {
    const seen = await bobClient.from("calendar_meetings").select("event_id");
    expect(seen.data).toEqual([]);

    // With his own id: no such contact of his, so the composite key refuses it.
    const asHimself = await bobClient
      .from("calendar_meetings")
      .insert({ ...meeting({ event_id: "evt-bob" }), user_id: bob.id });
    expect(asHimself.error).not.toBeNull();

    // Claiming to be her: the insert policy's check refuses it.
    const asAlice = await bobClient.from("calendar_meetings").insert(meeting({ event_id: "evt-sneaky" }));
    expect(asAlice.error).not.toBeNull();

    // His own contact and his own meeting: fine.
    const hisOwn = await bobClient.from("calendar_meetings").insert({
      user_id: bob.id,
      contact_id: bobsContactId,
      event_id: "evt-his",
      started_at: "2026-09-23T09:00:00Z",
      ended_at: "2026-09-23T09:30:00Z",
    });
    expect(hisOwn.error).toBeNull();
  });

  it("forgets the meetings when the contact goes", async () => {
    const { error } = await aliceClient.from("contacts").delete().eq("id", karinId);
    expect(error).toBeNull();

    const { data } = await aliceClient.from("calendar_meetings").select("contact_id").eq("event_id", "evt-coffee");
    // Johan was in that meeting too, and he is still a contact.
    expect(data).toHaveLength(1);
  });

  it("delete_all_contacts forgets where the calendar read got to", async () => {
    await aliceClient
      .from("google_calendar")
      .update({ synced_through: "2026-09-20T00:00:00Z" })
      .eq("user_id", alice.id);

    const { error } = await aliceClient.rpc("delete_all_contacts", { p_user_id: alice.id });
    expect(error).toBeNull();

    const { data } = await aliceClient
      .from("google_calendar")
      .select("synced_through, email")
      .eq("user_id", alice.id)
      .single();

    // The connection stays; the read position is reset so nothing is skipped.
    expect(data).toEqual({ synced_through: null, email: "alice@example.se" });

    const { data: meetings } = await aliceClient.from("calendar_meetings").select("event_id");
    expect(meetings).toEqual([]);
  });
});
