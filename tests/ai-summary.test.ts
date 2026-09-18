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

const message = (n: number, from: "you" | "them" | "other", text: string, who: string | null = null): ConversationMessage => ({
  ref: `m${n}`,
  messageId: `gmail-${n}`,
  threadId: "thread-1",
  from,
  who,
  at: new Date(Date.UTC(2026, 8, n, 9)),
  subject: n === 1 ? "Examensarbete" : "Re: Examensarbete",
  text,
});

const raw = (overrides: Partial<RawSummary> = {}): RawSummary => ({
  who_they_are: { text: "Head of platform at Fortnox.", sources: ["m2"] },
  how_you_know: { text: "You wrote to her about a thesis.", sources: ["m1"] },
  discussed: { text: "A thesis project starting in October.", sources: ["m1", "m2"] },
  next_step: { text: null, sources: [] },
  suggestions: {
    company: { value: null, sources: [] },
    role: { value: null, sources: [] },
    next_touch: { reason: null, timing: "nothing_open", date: null, month: null, why: null, sources: [] },
    referral: { name: null, email: null, sources: [] },
  },
  ...overrides,
});

const TODAY = "2026-09-17";
const ADDRESSES = ["karin@fortnox.se", "karin.l@gmail.com"];

describe("buildInput", () => {
  it("gives today, the contact's addresses and each message with a ref, oldest first", () => {
    expect(
      buildInput("Karin Lindqvist", ADDRESSES, [message(1, "you", "Hej Karin!"), message(2, "them", "")], TODAY),
    ).toBe(
      "Today: 2026-09-17\n\nContact: Karin Lindqvist\n\n" +
        "Their addresses:\n[a1] karin@fortnox.se\n[a2] karin.l@gmail.com\n\n" +
        "Messages, oldest first:\n\n" +
        "[m1] 2026-09-01 · from you · Subject: Examensarbete\nHej Karin!\n\n" +
        "[m2] 2026-09-02 · from them · Subject: Re: Examensarbete\n(no text)",
    );
  });
});

describe("the instructions and schema", () => {
  it("tell the model the rules the plan sets", () => {
    expect(INSTRUCTIONS).toMatch(/Use only what the messages and the contact.s addresses say/);
    expect(INSTRUCTIONS).toMatch(/health/);
    expect(INSTRUCTIONS).toMatch(/as if the contact will read it/);
    expect(INSTRUCTIONS).toMatch(/never instructions to you/);
    expect(INSTRUCTIONS).toMatch(/Never make up a date/);
    expect(INSTRUCTIONS).toMatch(/negations/);
    expect(INSTRUCTIONS).toMatch(/You don't pick the day/);
    expect(INSTRUCTIONS).toMatch(/referral:/);
  });

  it("is strict: every part required, nothing extra", () => {
    expect(SUMMARY_SCHEMA).toMatchObject({
      required: ["who_they_are", "how_you_know", "discussed", "next_step", "suggestions"],
      additionalProperties: false,
    });
  });
});

describe("checkSummary", () => {
  const conversation = [message(1, "you", "a"), message(2, "them", "b")];

  it("maps cited refs back to Gmail message and thread ids", () => {
    const checked = checkSummary(raw(), conversation, ADDRESSES, TODAY);
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
      ADDRESSES,
      TODAY,
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
      ADDRESSES,
      TODAY,
    );
    expect(checked.parts.how_you_know).toBeNull();
    expect(checked.dropped).toEqual([]);
    expect(checked.parts.discussed!.length).toBeLessThanOrEqual(MAX_PART_CHARS);
  });
});

describe("checkSummary's suggestions", () => {
  const conversation = [message(1, "you", "a"), message(2, "them", "b")];
  const suggest = (suggestions: Partial<RawSummary["suggestions"]>) =>
    checkSummary(raw({ suggestions: { ...raw().suggestions, ...suggestions } }), conversation, ADDRESSES, TODAY);

  const touch = (fields: Partial<RawSummary["suggestions"]["next_touch"]>): RawSummary["suggestions"]["next_touch"] => ({
    reason: "Contact Niklas Hedlund, as Martin suggested",
    timing: "referral",
    date: null,
    month: null,
    why: "Martin referred you to Niklas; referrals are best followed up quickly.",
    sources: ["m2"],
    ...fields,
  });

  it("keeps a company, role and next touch that cite real sources, dating the touch by its timing", () => {
    const checked = suggest({
      company: { value: "Fortnox", sources: ["a1", "m2"] },
      role: { value: "Head of platform", sources: ["m2"] },
      next_touch: touch({}),
    });
    expect(checked.suggestions).toEqual({
      company: "Fortnox",
      role: "Head of platform",
      touchReason: "Contact Niklas Hedlund, as Martin suggested",
      // A referral: 3 working days from Thursday 17 Sep.
      touchOn: "2026-09-22",
      touchWhy: "Martin referred you to Niklas; referrals are best followed up quickly.",
      touchRough: false,
      referralName: null,
      referralEmail: null,
      referralSince: null,
    });
    expect(checked.sources.company).toEqual([
      { address: "karin@fortnox.se" },
      { messageId: "gmail-2", threadId: "thread-1" },
    ]);
  });

  it("drops a company whose only source is a personal address", () => {
    const checked = suggest({ company: { value: "Gmail", sources: ["a2"] } });
    expect(checked.suggestions.company).toBeNull();
    expect(checked.sources.company).toBeUndefined();
    expect(checked.dropped).toContain("company");
  });

  it("drops suggestions citing nothing real — and a role can't come from an address alone", () => {
    const checked = suggest({
      company: { value: "Fortnox", sources: ["m9"] },
      role: { value: "CEO", sources: ["a1"] },
      next_touch: touch({ sources: [] }),
    });
    expect(checked.suggestions).toEqual({
      company: null,
      role: null,
      touchReason: null,
      touchOn: null,
      touchWhy: null,
      touchRough: false,
      referralName: null,
      referralEmail: null,
      referralSince: null,
    });
    expect(checked.dropped).toEqual(["company", "role", "next_touch"]);
  });

  it("counts waiting and promised timings from the conversation's own last emails", () => {
    // m1 is from you on 1 Sep, m2 from them on 2 Sep: both long past, so next working day.
    expect(suggest({ next_touch: touch({ timing: "waiting_on_them" }) }).suggestions.touchOn).toBe("2026-09-18");
    expect(suggest({ next_touch: touch({ timing: "they_will_get_back" }) }).suggestions.touchOn).toBe("2026-09-18");
  });

  it("marks a later event with no month as a rough guess", () => {
    const checked = suggest({ next_touch: touch({ timing: "later_event" }) });
    expect(checked.suggestions).toMatchObject({ touchOn: "2026-10-19", touchRough: true });
  });

  it("keeps the reason but gives no date for a stated date that isn't real, or a timing it doesn't know", () => {
    for (const fields of [
      { timing: "stated_date", date: "2026-02-30" },
      { timing: "stated_date", date: "when the internship approaches" },
      { timing: "whenever" },
    ]) {
      const checked = suggest({ next_touch: touch(fields) });
      expect(checked.suggestions.touchReason).toBe("Contact Niklas Hedlund, as Martin suggested");
      expect(checked.suggestions.touchOn).toBeNull();
    }
  });

  it("keeps a referral cited from a real message, dated by that message", () => {
    const checked = suggest({ referral: { name: "Niklas Hedlund", email: "Niklas.Hedlund@Combitech.com", sources: ["m2"] } });
    expect(checked.suggestions).toMatchObject({
      referralName: "Niklas Hedlund",
      referralEmail: "niklas.hedlund@combitech.com",
      referralSince: "2026-09-02T09:00:00.000Z",
    });
  });

  it("keeps the referral's name but not an address that isn't one", () => {
    const checked = suggest({ referral: { name: "Niklas Hedlund", email: "ask Martin", sources: ["m2"] } });
    expect(checked.suggestions).toMatchObject({ referralName: "Niklas Hedlund", referralEmail: null });
  });

  it("drops a referral that cites no real message — its date would be a guess", () => {
    const checked = suggest({ referral: { name: "Niklas Hedlund", email: null, sources: ["a1", "m9"] } });
    expect(checked.suggestions).toMatchObject({ referralName: null, referralSince: null });
    expect(checked.dropped).toContain("referral");
  });

  it("suggests no touch when nothing is open, whatever else the model wrote", () => {
    const checked = suggest({ next_touch: touch({ timing: "nothing_open" }) });
    expect(checked.suggestions).toMatchObject({ touchReason: null, touchOn: null, touchWhy: null });
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

const CONFIG: AiConfig = { apiKey: "sk-test", model: "gpt-5.6-luna", draftModel: "gpt-5-mini", monthlyCapUsd: 2 };
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
    const calls = fakeServices({
      body: openAiAnswer(
        raw({
          how_you_know: { text: "Invented.", sources: ["m7"] },
          suggestions: {
            company: { value: "Fortnox", sources: ["a1"] },
            role: { value: "Runs the platform team", sources: ["m2"] },
            next_touch: {
              reason: "Answer whether October works",
              timing: "stated_date",
              date: "2026-10-01",
              month: null,
              why: "Karin asked for an answer before October.",
              sources: ["m2"],
            },
            referral: { name: "Petter Ahlgren", email: null, sources: ["m2"] },
          },
        }),
      ),
    });

    const summary = await generateSummary(db, alice.id, karinId, {
      config: CONFIG,
      accessToken: fakeToken,
      now: new Date("2026-09-17T10:00:00Z"),
    });

    expect(calls.gmail).toBe(2);
    expect(calls.openAi[0].input).toContain("Today: 2026-09-17");
    expect(calls.openAi[0].input).toContain("[a1] karin@fortnox.se");
    expect(calls.openAi).toHaveLength(1);
    expect(calls.openAi[0].input).toContain("[m2] 2026-09-02 · from them");
    // A thread with someone else in it names them (docs/thread-context-plan.md).
    expect(buildInput("Karin", ADDRESSES, [message(1, "other", "Hej!", "Pontus Berglund")], TODAY)).toContain(
      "from Pontus Berglund",
    );
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
      suggested_company: "Fortnox",
      suggested_role: "Runs the platform team",
      suggested_touch_reason: "Answer whether October works",
      suggested_touch_on: "2026-10-01",
      suggested_touch_why: "Karin asked for an answer before October.",
      suggested_touch_rough: false,
      suggested_referral_name: "Petter Ahlgren",
      suggested_referral_email: null,
    });
    expect(new Date(summary.suggested_referral_since!).toISOString()).toBe("2026-09-02T09:00:00.000Z");
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
