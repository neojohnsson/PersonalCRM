import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CalendarNotConnected,
  CalendarReconnectRequired,
  calendarConnection,
  getCalendarAccessToken,
} from "@/lib/google/calendar-tokens";

/**
 * Slice 10: nobody can create an event on somebody else's calendar.
 *
 * Nothing about the Calendar API decides this — Google will do whatever the
 * token it is handed allows. What decides it is that the token lives in
 * `google_calendar`, one row per user, behind RLS: Bob asking for Alice's
 * token gets nothing, so there is no token to make the call with.
 *
 * So this is the same two-user test the rest of the app's tables get, aimed at
 * the one row that would matter most if it leaked. Real Supabase, real
 * policies, no Google at all.
 *
 * Fails until supabase/migrations/0022_calendar.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const CALENDAR_EVENTS_READONLY = "https://www.googleapis.com/auth/calendar.events.readonly";
const CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signedIn(): Promise<{ user: User; db: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `calwrite-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({
    email: data.user.email!,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { user: data.user, db };
}

describe("whose calendar can be written to", () => {
  let alice: User;
  let bob: User;
  let aliceDb: SupabaseClient;
  let bobDb: SupabaseClient;

  beforeAll(async () => {
    ({ user: alice, db: aliceDb } = await signedIn());
    ({ user: bob, db: bobDb } = await signedIn());

    const { error } = await aliceDb.from("google_calendar").insert({
      user_id: alice.id,
      email: "alice@example.se",
      refresh_token_encrypted: "pretend-this-is-encrypted",
      scopes: [CALENDAR_EVENTS_READONLY, CALENDAR_EVENTS],
    });
    if (error) throw error;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("gives Alice her own connection, write permission and all", async () => {
    const connection = await calendarConnection(aliceDb, alice.id);

    expect(connection?.email).toBe("alice@example.se");
    expect(connection?.scopes).toContain(CALENDAR_EVENTS);
  });

  it("tells Bob there is no calendar, whichever id he asks with", async () => {
    // His own: he has none. Alice's: RLS shows him nothing, and "not
    // connected" is the same answer as "not yours" on purpose.
    expect(await calendarConnection(bobDb, bob.id)).toBeNull();
    expect(await calendarConnection(bobDb, alice.id)).toBeNull();
  });

  it("hands Bob no token for Alice's calendar, so there is nothing to create with", async () => {
    // The whole write path starts here. No token, no event.
    await expect(getCalendarAccessToken(bobDb, alice.id)).rejects.toBeInstanceOf(CalendarNotConnected);
    await expect(getCalendarAccessToken(bobDb, bob.id)).rejects.toBeInstanceOf(CalendarNotConnected);
  });

  it("lets Bob read nothing of the row itself", async () => {
    const { data } = await bobDb.from("google_calendar").select("*");
    expect(data).toEqual([]);

    // And he cannot give himself one by writing hers.
    const { error } = await bobDb
      .from("google_calendar")
      .update({ email: "bob@example.se" })
      .eq("user_id", alice.id)
      .select("user_id");
    // Either refused outright, or silently nothing: what matters is that it
    // did not change.
    const { data: after } = await admin
      .from("google_calendar")
      .select("email")
      .eq("user_id", alice.id)
      .single();
    expect(error ?? null).not.toBeUndefined();
    expect(after!.email).toBe("alice@example.se");
  });

  it("refuses a token when the write permission was never granted", async () => {
    // Not a two-user case, but the same gate: a calendar connected before
    // slice 10 holds only the read scope.
    const { user: carol, db: carolDb } = await signedIn();
    try {
      await carolDb.from("google_calendar").insert({
        user_id: carol.id,
        email: "carol@example.se",
        refresh_token_encrypted: "pretend-this-is-encrypted",
        scopes: [],
      });

      await expect(getCalendarAccessToken(carolDb, carol.id)).rejects.toBeInstanceOf(
        CalendarReconnectRequired,
      );
    } finally {
      await admin.auth.admin.deleteUser(carol.id);
    }
  });
});
