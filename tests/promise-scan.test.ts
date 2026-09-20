import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import { planScan, scanForPromises } from "@/lib/ai/promise-scan";
import type { RawPromises } from "@/lib/ai/promises";

/**
 * Scanning a mailbox for promises (migration 0019; docs/slice-6d-plan.md).
 *
 * The expensive part of this app, so most of what is tested here is what it
 * refuses to read: a contact with no open thread, one you settled, one you
 * never chase, one you already have a date for, and — the rule that matters
 * after the first scan — one with nothing new since it was last read.
 *
 * Gmail and OpenAI are faked; Supabase is real, as everywhere else.
 *
 * Fails until supabase/migrations/0019_promises.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";
const CONFIG: AiConfig = { apiKey: "sk-test", model: "gpt-5.6-luna", draftModel: "gpt-5-mini", monthlyCapUsd: 2 };
const fakeToken = async () => "ya29.fake";

const NOW = new Date("2026-09-20T10:00:00Z");
const PROMISE = "I'll check with the team and come back to you in October";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const b64 = (text: string) => Buffer.from(text).toString("base64url");

/** Every message says the same thing; which contact it belongs to is the point. */
const BODY = `Hej Neo! ${PROMISE}. Hälsningar, Pär`;

type OpenAiReply = { status?: number; body: unknown };

/** Routes Gmail and OpenAI to fakes; Supabase still goes out for real. */
function fakeServices(reply: OpenAiReply) {
  const realFetch = globalThis.fetch;
  const calls = { gmail: 0, openAi: 0 };

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://gmail.googleapis.com/")) {
        calls.gmail++;
        const id = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
        return Response.json({
          id,
          threadId: "thread-1",
          internalDate: "0",
          payload: { mimeType: "text/plain", body: { data: b64(BODY) } },
        });
      }
      if (url === "https://api.openai.com/v1/responses") {
        calls.openAi++;
        return Response.json(reply.body, { status: reply.status ?? 200 });
      }
      return realFetch(input, init);
    }),
  );
  return calls;
}

const answer = (promises: RawPromises) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(promises) }] }],
  usage: { input_tokens: 1200, output_tokens: 120 },
});

const onePromise: RawPromises = {
  promises: [
    {
      source: "m1",
      owed_by: "them",
      sentence: PROMISE,
      reason: "Pär said he'd come back about the team",
      date: "2026-10-01",
    },
  ],
};

describe("scanning for promises", () => {
  let alice: User;
  let db: SupabaseClient;
  let parId: string;
  let mutedId: string;
  let settledId: string;
  let plannedId: string;
  let noMailId: string;

  /** A contact of Alice's with one inbound message in a thread of its own. */
  async function contactWithMail(name: string, address: string, thread: string, at: string): Promise<string> {
    const { data, error } = await db
      .from("contacts")
      .insert({ user_id: alice.id, first_name: name, source: "gmail" })
      .select("id")
      .single();
    if (error) throw error;

    const { error: emailError } = await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: data.id, email: address, is_primary: true });
    if (emailError) throw emailError;

    const { error: messageError } = await db.from("gmail_messages").insert({
      user_id: alice.id,
      gmail_message_id: `msg-${thread}`,
      thread_id: thread,
      internal_date: at,
      from_email: address,
      to_emails: ["alice@example.se"],
      cc_emails: [],
      has_list_unsubscribe: false,
      direction: "inbound",
      subject: "Examensarbete",
    });
    if (messageError) throw messageError;

    return data.id;
  }

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `scan-${randomUUID()}@example.com`,
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

    // The one worth reading, and four that are not.
    parId = await contactWithMail("Pär", "par@vaxjo.se", "thread-1", "2026-09-18T09:00:00Z");
    mutedId = await contactWithMail("Linda", "linda@example.se", "thread-2", "2026-09-18T09:00:00Z");
    settledId = await contactWithMail("Michail", "michail@example.se", "thread-3", "2026-09-18T09:00:00Z");
    plannedId = await contactWithMail("Johan", "johan@example.se", "thread-4", "2026-09-18T09:00:00Z");

    const { data: nils, error: nilsError } = await db
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Nils", source: "manual" })
      .select("id")
      .single();
    if (nilsError) throw nilsError;
    noMailId = nils.id;

    await db.from("contacts").update({ never_chase: true }).eq("id", mutedId);
    await db.from("settled_threads").insert({
      user_id: alice.id,
      contact_id: settledId,
      thread_id: "thread-3",
      settled_at: "2026-09-19T09:00:00Z",
    });
    await db.from("next_touches").insert({
      user_id: alice.id,
      contact_id: plannedId,
      due_on: "2026-10-05",
      reason: "Already planned",
    });
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  beforeEach(async () => {
    await db.from("promises").delete().eq("user_id", alice.id);
    await db.from("contacts").update({ promises_scanned_at: null }).eq("user_id", alice.id);
    await admin.from("ai_usage").delete().eq("user_id", alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads only the contacts there is a reason to read", async () => {
    const plan = await planScan(db, alice.id, { config: CONFIG, now: NOW });
    const read = plan.contacts.map((c) => c.contactId);

    // No mail, never chased, and a conversation you settled: all left alone.
    expect(read).not.toContain(noMailId);
    expect(read).not.toContain(mutedId);
    expect(read).not.toContain(settledId);
    expect(plan.estimateUsd).toBeGreaterThan(0);

    // A contact you already have a date for IS read — only a promise due
    // before that day is worth offering, and the candidate carries the day.
    expect(read).toContain(parId);
    expect(read).toContain(plannedId);
    expect(plan.contacts.find((c) => c.contactId === plannedId)!.plannedOn).toBe("2026-10-05");
    expect(plan.contacts.find((c) => c.contactId === parId)!.plannedOn).toBeNull();
  });

  it("offers a promise that falls before the day you already chose, and not one after", async () => {
    fakeServices({ body: answer(onePromise) });

    // The plan for Johan is 5 October; the promise in his mail is 1 October.
    await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    const { data } = await db
      .from("promises")
      .select("contact_id, due_on")
      .eq("contact_id", plannedId);
    expect(data).toEqual([{ contact_id: plannedId, due_on: "2026-10-01" }]);

    // Now move his plan earlier than the promise: it stops being news.
    await db.from("promises").delete().eq("user_id", alice.id);
    await db.from("contacts").update({ promises_scanned_at: null }).eq("id", plannedId);
    await db
      .from("next_touches")
      .update({ due_on: "2026-09-25" })
      .eq("user_id", alice.id)
      .eq("contact_id", plannedId);

    const result = await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    const { data: after } = await db.from("promises").select("id").eq("contact_id", plannedId);
    expect(after).toEqual([]);
    expect(result.dropped.later_than_plan).toBeGreaterThan(0);

    // Put his plan back: the tests below share this contact.
    await db
      .from("next_touches")
      .update({ due_on: "2026-10-05" })
      .eq("user_id", alice.id)
      .eq("contact_id", plannedId);
  });

  it("writes what it finds as pending, and says it has read the contact", async () => {
    const calls = fakeServices({ body: answer(onePromise) });

    const result = await scanForPromises(db, alice.id, {
      config: CONFIG,
      accessToken: fakeToken,
      now: NOW,
    });

    // Pär and Johan are both read; each has the same promise in their mail.
    expect(result).toMatchObject({ read: 2, found: 2, stoppedAtCap: false, failed: 0, remaining: 0 });
    // One request per contact read, and no more.
    expect(calls.openAi).toBe(2);

    const { data: promises } = await db
      .from("promises")
      .select("contact_id, owed_by, due_on, reason, status, message_id, thread_id")
      .eq("contact_id", parId);
    expect(promises).toEqual([
      {
        contact_id: parId,
        owed_by: "them",
        due_on: "2026-10-01",
        reason: "Pär said he'd come back about the team",
        status: "pending",
        message_id: "msg-thread-1",
        thread_id: "thread-1",
      },
    ]);

    const { data: contact } = await db
      .from("contacts")
      .select("promises_scanned_at")
      .eq("id", parId)
      .single();
    expect(contact!.promises_scanned_at).not.toBeNull();
  });

  it("reads a batch at a time, and says how many are left", async () => {
    // A press is bounded by the platform's timeout, not by what is waiting.
    const plan = await planScan(db, alice.id, { config: CONFIG, now: NOW, limit: 0 });

    expect(plan.contacts).toEqual([]);
    expect(plan.remaining).toBe(2);
  });

  it("reads nobody a second time, which is what makes pressing it again cheap", async () => {
    fakeServices({ body: answer(onePromise) });
    await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    const plan = await planScan(db, alice.id, { config: CONFIG, now: NOW });
    expect(plan.contacts).toEqual([]);
    expect(plan.estimateUsd).toBe(0);
  });

  it("reads the contact again once they write something new", async () => {
    fakeServices({ body: answer(onePromise) });
    await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    const { error } = await db.from("gmail_messages").insert({
      user_id: alice.id,
      gmail_message_id: "msg-thread-1-again",
      thread_id: "thread-1",
      internal_date: "2026-09-21T09:00:00Z",
      from_email: "par@vaxjo.se",
      to_emails: ["alice@example.se"],
      cc_emails: [],
      has_list_unsubscribe: false,
      direction: "inbound",
      subject: "Re: Examensarbete",
    });
    if (error) throw error;

    const plan = await planScan(db, alice.id, {
      config: CONFIG,
      now: new Date("2026-09-22T10:00:00Z"),
    });
    expect(plan.contacts.map((c) => c.contactId)).toEqual([parId]);
  });

  it("offers the same message once, however often it is scanned", async () => {
    fakeServices({ body: answer(onePromise) });
    await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    // Forget that it was read, so the second scan really does ask again.
    await db.from("contacts").update({ promises_scanned_at: null }).eq("id", parId);
    const second = await scanForPromises(db, alice.id, { config: CONFIG, accessToken: fakeToken, now: NOW });

    expect(second.read).toBe(1);
    expect(second.found).toBe(0);

    const { data } = await db.from("promises").select("id").eq("contact_id", parId);
    expect(data).toHaveLength(1);
  });

  it("stops at the monthly cap, without writing anything", async () => {
    const calls = fakeServices({ body: answer(onePromise) });

    const result = await scanForPromises(db, alice.id, {
      config: { ...CONFIG, monthlyCapUsd: 0 },
      accessToken: fakeToken,
      now: NOW,
    });

    expect(result).toMatchObject({ read: 0, found: 0, stoppedAtCap: true });
    expect(calls.openAi).toBe(0);

    const { data } = await db.from("promises").select("id");
    expect(data).toEqual([]);
  });

  it("steps over a contact whose mail can't be read", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith("https://gmail.googleapis.com/")) {
          return Response.json({ error: { message: "gone" } }, { status: 500 });
        }
        if (url === "https://api.openai.com/v1/responses") throw new Error("should not be asked");
        return realFetch(input, init);
      }),
    );

    const result = await scanForPromises(db, alice.id, {
      config: CONFIG,
      accessToken: fakeToken,
      now: NOW,
    });

    expect(result).toMatchObject({ read: 0, stoppedAtCap: false });
    expect(result.failed).toBeGreaterThan(0);

    // It keeps no scanned_at, so the next scan tries again.
    const { data } = await db.from("contacts").select("promises_scanned_at").eq("id", parId).single();
    expect(data!.promises_scanned_at).toBeNull();
  });
});
