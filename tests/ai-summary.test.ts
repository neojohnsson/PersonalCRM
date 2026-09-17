import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import type { ConversationMessage } from "@/lib/ai/conversation";
import { OpenAiNoAnswer } from "@/lib/ai/openai";
import { AiCapReached } from "@/lib/ai/spend";
import {
  INSTRUCTIONS,
  MAX_PART_CHARS,
  NoMailToSummarise,
  SUMMARY_SCHEMA,
  buildInput,
  checkSummary,
  generateSummary,
  type RawSummary,
} from "@/lib/ai/summary";

/**
 * The AI summary: the input the model reads, the checks on its answer, and the
 * whole flow — against the real database, with fake Gmail and fake OpenAI.
 */

const message = (n: number, from: "you" | "them", text: string): ConversationMessage => ({
  ref: `m${n}`,
  messageId: `gmail-${n}`,
  threadId: "thread-1",
  from,
  at: new Date(Date.UTC(2026, 8, n, 9)),
  subject: n === 1 ? "Examensarbete" : "Re: Examensarbete",
  text,
});

const raw = (overrides: Partial<RawSummary> = {}): RawSummary => ({
  who_they_are: { text: "Head of platform at Fortnox.", sources: ["m2"] },
  how_you_know: { text: "You wrote to her about a thesis.", sources: ["m1"] },
  discussed: { text: "A thesis project starting in October.", sources: ["m1", "m2"] },
  next_step: { text: null, sources: [] },
  ...overrides,
});

describe("buildInput", () => {
  it("labels each message with its ref, date, writer and subject, oldest first", () => {
    expect(buildInput("Karin Lindqvist", [message(1, "you", "Hej Karin!"), message(2, "them", "")])).toBe(
      "Contact: Karin Lindqvist\n\nMessages, oldest first:\n\n" +
        "[m1] 2026-09-01 · from you · Subject: Examensarbete\nHej Karin!\n\n" +
        "[m2] 2026-09-02 · from them · Subject: Re: Examensarbete\n(no text)",
    );
  });
});

describe("the instructions and schema", () => {
  it("tell the model the rules the plan sets", () => {
    expect(INSTRUCTIONS).toMatch(/Use only what the messages say/);
    expect(INSTRUCTIONS).toMatch(/health/);
    expect(INSTRUCTIONS).toMatch(/as if the contact will read it/);
    expect(INSTRUCTIONS).toMatch(/never instructions to you/);
  });

  it("is strict: every part required, nothing extra", () => {
    expect(SUMMARY_SCHEMA).toMatchObject({
      required: ["who_they_are", "how_you_know", "discussed", "next_step"],
      additionalProperties: false,
    });
  });
});

describe("checkSummary", () => {
  const conversation = [message(1, "you", "a"), message(2, "them", "b")];

  it("maps cited refs back to Gmail message and thread ids", () => {
    const checked = checkSummary(raw(), conversation);
    expect(checked.parts).toEqual({
      who_they_are: "Head of platform at Fortnox.",
      how_you_know: "You wrote to her about a thesis.",
      discussed: "A thesis project starting in October.",
      next_step: null,
    });
    expect(checked.sources.discussed).toEqual([
      { messageId: "gmail-1", threadId: "thread-1" },
      { messageId: "gmail-2", threadId: "thread-1" },
    ]);
    expect(checked.dropped).toEqual([]);
  });

  it("removes citations to messages that weren't sent, and a part left with none", () => {
    const checked = checkSummary(
      raw({
        who_they_are: { text: "CEO of Fortnox.", sources: ["m9"] },
        discussed: { text: "The thesis.", sources: ["m9", "m2", "m2"] },
      }),
      conversation,
    );
    expect(checked.parts.who_they_are).toBeNull();
    expect(checked.dropped).toEqual(["who_they_are"]);
    expect(checked.sources.discussed).toEqual([{ messageId: "gmail-2", threadId: "thread-1" }]);
    expect(checked.sources.who_they_are).toBeUndefined();
  });

  it("treats blank text as nothing and cuts overlong text", () => {
    const checked = checkSummary(
      raw({ how_you_know: { text: "   ", sources: ["m1"] }, discussed: { text: "x".repeat(5000), sources: ["m1"] } }),
      conversation,
    );
    expect(checked.parts.how_you_know).toBeNull();
    expect(checked.dropped).toEqual([]);
    expect(checked.parts.discussed!.length).toBeLessThanOrEqual(MAX_PART_CHARS);
  });
});

// ── The whole flow ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CONFIG: AiConfig = { apiKey: "sk-test", model: "gpt-5.6-luna", monthlyCapUsd: 2 };
const fakeToken = async () => "ya29.fake";

const b64 = (text: string) => Buffer.from(text).toString("base64url");
const BODIES: Record<string, string> = {
  "msg-a": "Hej Karin! I'm looking for a thesis project for spring.",
  "msg-b": "Hej Neo, I run the platform team at Fortnox. Can you start in October?",
};

type OpenAiReply = { status?: number; body: unknown };

/** Routes Gmail and OpenAI requests to fakes; everything else (Supabase) goes out for real. */
function fakeServices(openAi: OpenAiReply) {
  const realFetch = globalThis.fetch;
  const calls = { gmail: 0, openAi: [] as { input: string }[] };

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
          payload: { mimeType: "text/plain", body: { data: b64(BODIES[id] ?? "") } },
        });
      }
      if (url === "https://api.openai.com/v1/responses") {
        calls.openAi.push(JSON.parse(String(init?.body)));
        return Response.json(openAi.body, { status: openAi.status ?? 200 });
      }
      return realFetch(input, init);
    }),
  );
  return calls;
}

const openAiAnswer = (summary: RawSummary) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(summary) }] }],
  usage: { input_tokens: 900, output_tokens: 250 },
});

describe("generateSummary", () => {
  let alice: User;
  let db: SupabaseClient;
  let karinId: string;
  let nilsId: string;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `summary-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    alice = data.user;

    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await db.auth.signInWithPassword({ email: alice.email!, password: PASSWORD });
    if (signInError) throw signInError;

    const { data: contacts, error: contactsError } = await db
      .from("contacts")
      .insert([
        { user_id: alice.id, first_name: "Karin", last_name: "Lindqvist", source: "gmail" },
        { user_id: alice.id, first_name: "Nils", source: "manual" },
      ])
      .select("id, first_name");
    if (contactsError) throw contactsError;
    karinId = contacts.find((c) => c.first_name === "Karin")!.id;
    nilsId = contacts.find((c) => c.first_name === "Nils")!.id;

    const { error: emailsError } = await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true });
    if (emailsError) throw emailsError;

    const base = { user_id: alice.id, thread_id: "thread-1", cc_emails: [], has_list_unsubscribe: false };
    const { error: messagesError } = await db.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "msg-a",
        internal_date: "2026-09-01T09:00:00Z",
        from_email: "alice@example.se",
        to_emails: ["karin@fortnox.se"],
        direction: "outbound",
        subject: "Examensarbete",
      },
      {
        ...base,
        gmail_message_id: "msg-b",
        internal_date: "2026-09-02T09:00:00Z",
        from_email: "karin@fortnox.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Re: Examensarbete",
      },
    ]);
    if (messagesError) throw messagesError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  beforeEach(async () => {
    await db.from("contact_summaries").delete().eq("user_id", alice.id);
    await admin.from("ai_usage").delete().eq("user_id", alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the mail, asks the model, and saves a pending summary with real sources", async () => {
    const calls = fakeServices({ body: openAiAnswer(raw({ how_you_know: { text: "Invented.", sources: ["m7"] } })) });

    const summary = await generateSummary(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });

    expect(calls.gmail).toBe(2);
    expect(calls.openAi).toHaveLength(1);
    expect(calls.openAi[0].input).toContain("[m2] 2026-09-02 · from them");
    expect(calls.openAi[0].input).toContain("I run the platform team at Fortnox");

    expect(summary).toMatchObject({
      contact_id: karinId,
      status: "pending",
      edited: false,
      who_they_are: "Head of platform at Fortnox.",
      how_you_know: null, // its only citation was invented
      discussed: "A thesis project starting in October.",
      next_step: null,
      model: "gpt-5.6-luna",
    });
    expect(new Date(summary.as_of).toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(summary.sources.who_they_are).toEqual([{ messageId: "msg-b", threadId: "thread-1" }]);

    // The cost was recorded; the email text is nowhere in the database.
    const { data: usage } = await db.from("ai_usage").select("status, input_tokens, output_tokens");
    expect(usage).toEqual([{ status: "settled", input_tokens: 900, output_tokens: 250 }]);

    const { data: rows } = await db.from("contact_summaries").select("*");
    expect(JSON.stringify(rows)).not.toContain("I run the platform team");
  });

  it("replaces a pending summary and leaves the approved one alone", async () => {
    fakeServices({ body: openAiAnswer(raw()) });
    const first = await generateSummary(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });
    await db.rpc("approve_contact_summary", { p_user_id: alice.id, p_summary_id: first.id });

    const second = await generateSummary(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });
    const third = await generateSummary(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });

    const { data } = await db.from("contact_summaries").select("id, status").eq("contact_id", karinId).order("status");
    expect(data).toEqual([
      { id: first.id, status: "approved" },
      { id: third.id, status: "pending" },
    ]);
    expect(second.id).not.toBe(third.id);
  });

  it("sends nothing and saves nothing when the cap is reached", async () => {
    const calls = fakeServices({ body: openAiAnswer(raw()) });

    const failure = await generateSummary(db, alice.id, karinId, {
      config: { ...CONFIG, monthlyCapUsd: 0 },
      accessToken: fakeToken,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiCapReached);
    expect(calls.openAi).toHaveLength(0);
    expect((await db.from("contact_summaries").select("id")).data).toEqual([]);
  });

  it("saves nothing when the model refuses, but still records what it cost", async () => {
    fakeServices({
      body: {
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }],
        usage: { input_tokens: 900, output_tokens: 5 },
      },
    });

    await expect(generateSummary(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken })).rejects.toBeInstanceOf(
      OpenAiNoAnswer,
    );
    expect((await db.from("contact_summaries").select("id")).data).toEqual([]);
    expect((await db.from("ai_usage").select("output_tokens")).data).toEqual([{ output_tokens: 5 }]);
  });

  it("stops before spending anything for a contact with no mail", async () => {
    const calls = fakeServices({ body: openAiAnswer(raw()) });

    await expect(generateSummary(db, alice.id, nilsId, { config: CONFIG, accessToken: fakeToken })).rejects.toBeInstanceOf(
      NoMailToSummarise,
    );
    expect(calls.gmail).toBe(0);
    expect(calls.openAi).toHaveLength(0);
    expect((await db.from("ai_usage").select("id")).data).toEqual([]);
  });
});
