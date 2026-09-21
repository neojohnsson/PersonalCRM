import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCalendar } from "@/lib/calendar/read";
import type { GoogleEvent } from "@/lib/google/calendar";

/**
 * Reading the calendar end to end (docs/slice-8-plan.md, Part 2).
 *
 * Google is faked; Supabase is real. The test that matters most is the first
 * one: it reads the URL the app sends and fails if a description or a title was
 * ever asked for. That is the difference between a promise about privacy and a
 * fact about the request.
 *
 * Fails until supabase/migrations/0022_calendar.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const NOW = new Date("2026-09-21T10:00:00Z");
const fakeToken = async () => "ya29.calendar-fake";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Routes Google Calendar to a fake; Supabase still goes out for real. */
function fakeGoogle(pages: { items: GoogleEvent[]; nextPageToken?: string }[]) {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  let page = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://www.googleapis.com/calendar/v3/")) {
        calls.push(url);
        return Response.json(pages[Math.min(page++, pages.length - 1)] ?? { items: [] });
      }
      return realFetch(input, init);
    }),
  );

  return calls;
}

describe("reading the calendar", () => {
  let alice: User;
  let db: SupabaseClient;
  let karinId: string;
  let johanId: string;

  const meeting = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
    id: "evt-coffee",
    status: "confirmed",
    start: { dateTime: "2026-09-22T09:00:00Z" },
    end: { dateTime: "2026-09-22T10:00:00Z" },
    attendees: [
      { email: "alice@example.se", self: true, responseStatus: "accepted" },
      { email: "karin@fortnox.se", responseStatus: "accepted" },
    ],
    ...over,
  });

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `calread-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    alice = data.user;

    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await db.auth.signInWithPassword({
      email: alice.email!,
      password: PASSWORD,
    });
    if (signInError) throw signInError;

    const { data: contacts, error: contactsError } = await db
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Karin", source: "gmail" },
        { user_id: alice.id, first_name: "Johan", source: "gmail" },
      ])
      .select("id, first_name");
    if (contactsError) throw contactsError;
    karinId = contacts.find((c) => c.first_name === "Karin")!.id;
    johanId = contacts.find((c) => c.first_name === "Johan")!.id;

    const { error: emailError } = await db.from("contact_emails").insert([
      { user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true },
      { user_id: alice.id, contact_id: johanId, email: "johan@atea.se", is_primary: true },
    ]);
    if (emailError) throw emailError;

    const { error: calendarError } = await db.from("google_calendar").insert({
      user_id: alice.id,
      email: "alice@example.se",
      refresh_token_encrypted: "pretend-this-is-encrypted",
      scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });
    if (calendarError) throw calendarError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  beforeEach(async () => {
    await db.from("calendar_meetings").delete().eq("user_id", alice.id);
    await db.from("google_calendar").update({ synced_through: null }).eq("user_id", alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never asks Google for a title, a description or anything else private", async () => {
    const calls = fakeGoogle([{ items: [meeting()] }]);

    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    expect(calls).toHaveLength(1);
    const fields = new URL(calls[0]).searchParams.get("fields") ?? "";

    expect(fields).not.toContain("description");
    expect(fields).not.toContain("summary");
    expect(fields).not.toContain("location");
    expect(fields).not.toContain("attachments");
    expect(fields).not.toContain("conference");
    // What it does ask for: the times, the guests and their answers.
    expect(fields).toContain("attendees(email,self,responseStatus)");
  });

  it("asks for a window around today, expanding repeating meetings", async () => {
    const calls = fakeGoogle([{ items: [] }]);

    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    const params = new URL(calls[0]).searchParams;
    expect(params.get("singleEvents")).toBe("true");
    expect(new Date(params.get("timeMin")!) < NOW).toBe(true);
    expect(new Date(params.get("timeMax")!) > NOW).toBe(true);
  });

  it("stores a meeting, one row per contact in it", async () => {
    fakeGoogle([
      {
        items: [
          meeting(),
          meeting({
            id: "evt-both",
            attendees: [
              { email: "alice@example.se", self: true },
              { email: "karin@fortnox.se" },
              { email: "johan@atea.se" },
            ],
          }),
        ],
      },
    ]);

    const result = await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    expect(result).toMatchObject({ events: 2, meetings: 2, rows: 3, removed: 0 });

    const { data } = await db
      .from("calendar_meetings")
      .select("event_id, contact_id, accepted")
      .order("event_id");
    expect(data).toHaveLength(3);
    expect(data!.filter((row) => row.event_id === "evt-both")).toHaveLength(2);
  });

  it("follows Google's paging", async () => {
    const calls = fakeGoogle([
      { items: [meeting()], nextPageToken: "page-2" },
      { items: [meeting({ id: "evt-second" })] },
    ]);

    const result = await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]).searchParams.get("pageToken")).toBe("page-2");
    expect(result.meetings).toBe(2);
  });

  it("forgets a meeting that was cancelled, instead of warming a contact for ever", async () => {
    fakeGoogle([{ items: [meeting()] }]);
    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });
    vi.unstubAllGlobals();

    // Read again, and Google no longer reports it.
    fakeGoogle([{ items: [] }]);
    const second = await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    expect(second.removed).toBe(1);
    const { data } = await db.from("calendar_meetings").select("event_id");
    expect(data).toEqual([]);
  });

  it("moves a meeting rather than storing it twice", async () => {
    fakeGoogle([{ items: [meeting()] }]);
    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });
    vi.unstubAllGlobals();

    fakeGoogle([
      {
        items: [
          meeting({
            start: { dateTime: "2026-09-23T14:00:00Z" },
            end: { dateTime: "2026-09-23T15:00:00Z" },
          }),
        ],
      },
    ]);
    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    const { data } = await db.from("calendar_meetings").select("event_id, started_at");
    expect(data).toHaveLength(1);
    expect(new Date(data![0].started_at).toISOString()).toBe("2026-09-23T14:00:00.000Z");
  });

  it("records how far it read, so the page can say", async () => {
    fakeGoogle([{ items: [] }]);

    await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    const { data } = await db
      .from("google_calendar")
      .select("synced_through")
      .eq("user_id", alice.id)
      .single();
    expect(new Date(data!.synced_through!) > NOW).toBe(true);
  });

  it("counts what it skipped, so an empty result can be explained", async () => {
    fakeGoogle([
      {
        items: [
          meeting({ id: "evt-cancelled", status: "cancelled" }),
          meeting({ id: "evt-holiday", start: { date: "2026-09-24" }, end: { date: "2026-09-25" } }),
          meeting({
            id: "evt-strangers",
            attendees: [{ email: "alice@example.se", self: true }, { email: "nobody@example.com" }],
          }),
        ],
      },
    ]);

    const result = await readCalendar(db, alice.id, { now: NOW, accessToken: fakeToken });

    expect(result.meetings).toBe(0);
    expect(result.skipped).toEqual({ cancelled: 1, all_day: 1, nobody_you_know: 1 });
  });
});
