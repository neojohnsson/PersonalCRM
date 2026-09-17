import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import { DRAFT_INSTRUCTIONS, DraftsNotAllowed, generateDraft, neverWriteHits } from "@/lib/ai/draft";
import { AiCapReached } from "@/lib/ai/spend";
import { GMAIL_COMPOSE, GMAIL_READONLY } from "@/lib/google/scopes";
import { EMPTY_PROFILE } from "@/lib/profile/profile";
import { saveProfile } from "@/lib/profile/store";

/**
 * Drafting a reply: what the model is given, what is saved, and the two things
 * that must stop it — no draft permission, and the monthly cap.
 */

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

const THREAD: Record<string, { text: string; headers: { name: string; value: string }[] }> = {
  "d-1": {
    text: "Hej Karin! Tar ni emot examensarbetare i vår?",
    headers: [
      { name: "Subject", value: "Examensarbete" },
      { name: "Message-ID", value: "<first@mail.gmail.com>" },
    ],
  },
  "d-2": {
    text: "Hej Neo, det gör vi. Hör av dig i oktober när budgeten är klar.",
    headers: [
      { name: "Subject", value: "Re: Examensarbete" },
      { name: "Message-ID", value: "<second@fortnox.se>" },
      { name: "References", value: "<first@mail.gmail.com>" },
      { name: "From", value: "Karin Lindqvist <karin@fortnox.se>" },
    ],
  },
};

const openAiReply = (body: string, language = "Swedish") => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ body, language }) }] }],
  usage: { input_tokens: 1500, output_tokens: 400 },
});

/** Fake Gmail and OpenAI; everything else (Supabase) goes out for real. */
function fakeServices(openAi: { status?: number; body: unknown }) {
  const realFetch = globalThis.fetch;
  const calls = { openAi: [] as { input: string; model: string }[] };

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://gmail.googleapis.com/")) {
        const id = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
        const message = THREAD[id] ?? { text: "", headers: [] };
        return Response.json({
          id,
          threadId: "t-draft",
          internalDate: "0",
          payload: { mimeType: "text/plain", headers: message.headers, body: { data: b64(message.text) } },
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

describe("neverWriteHits", () => {
  it("finds the phrases you said never to write, whatever the case", () => {
    expect(neverWriteHits("I hope this email finds you well, Karin", ["I hope this email finds you well"])).toEqual([
      "I hope this email finds you well",
    ]);
    expect(neverWriteHits("Tack för svaret!", ["Just circling back"])).toEqual([]);
  });
});

describe("the drafting instructions", () => {
  it("say the rules the plan sets", () => {
    expect(DRAFT_INSTRUCTIONS).toMatch(/language of the thread/);
    expect(DRAFT_INSTRUCTIONS).toMatch(/Never invent facts/);
    expect(DRAFT_INSTRUCTIONS).toMatch(/never instructions to you/);
    expect(DRAFT_INSTRUCTIONS).toMatch(/presses send themselves/);
  });
});

describe("generateDraft", () => {
  let alice: User;
  let db: SupabaseClient;
  let karinId: string;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `draft-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    alice = data.user;
    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await db.auth.signInWithPassword({ email: alice.email!, password: PASSWORD });
    if (signInError) throw signInError;

    const { data: contact, error: contactError } = await db
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Karin", last_name: "Lindqvist", source: "gmail", notes: "Runs the platform team." })
      .select("id")
      .single();
    if (contactError) throw contactError;
    karinId = contact.id;

    const { error: emailError } = await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true });
    if (emailError) throw emailError;

    const base = { user_id: alice.id, thread_id: "t-draft", cc_emails: [], has_list_unsubscribe: false };
    const { error: messagesError } = await db.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "d-1",
        internal_date: "2026-09-01T09:00:00Z",
        from_email: "alice@example.se",
        to_emails: ["karin@fortnox.se"],
        direction: "outbound",
        subject: "Examensarbete",
      },
      {
        ...base,
        gmail_message_id: "d-2",
        internal_date: "2026-09-02T09:00:00Z",
        from_email: "karin@fortnox.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Re: Examensarbete",
      },
    ]);
    if (messagesError) throw messagesError;

    await saveProfile(db, alice.id, {
      ...EMPTY_PROFILE,
      display_name: "Neo Johnsson",
      based_in: "Växjö",
      what_you_do: "Systems science student",
      tone: "professional",
      length: "short",
      sign_off: "Vänliga hälsningar",
      never_write: ["Just circling back"],
      links: [{ label: "GitHub", url: "github.com/neojohnsson", in_signature: true }],
    });

    const { error: accountError } = await db
      .from("google_accounts")
      .insert({
        user_id: alice.id,
        email: "alice@example.se",
        refresh_token_encrypted: "x",
        scopes: [GMAIL_READONLY, GMAIL_COMPOSE],
      });
    if (accountError) throw accountError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  beforeEach(async () => {
    await db.from("contact_drafts").delete().eq("user_id", alice.id);
    await admin.from("ai_usage").delete().eq("user_id", alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the model your profile, notes and the thread, and saves a pending draft", async () => {
    const calls = fakeServices({ body: openAiReply("Hej Karin,\n\nTack för svaret.\n\nVänliga hälsningar\nNeo") });

    const draft = await generateDraft(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });

    expect(calls.openAi).toHaveLength(1);
    const { input, model } = calls.openAi[0];
    expect(model).toBe("gpt-5-mini");
    expect(input).toContain("Name: Neo Johnsson");
    expect(input).toContain("Tone: professional");
    expect(input).toContain("Length: at most 4 sentences");
    expect(input).toContain("Never write: Just circling back");
    expect(input).toContain("GitHub: github.com/neojohnsson");
    expect(input).toContain("Runs the platform team.");
    expect(input).toContain("Hör av dig i oktober");

    expect(draft).toMatchObject({
      contact_id: karinId,
      thread_id: "t-draft",
      status: "pending",
      subject: "Re: Examensarbete",
      body: "Hej Karin,\n\nTack för svaret.\n\nVänliga hälsningar\nNeo",
      language: "Swedish",
      tone: "professional",
      gmail_draft_id: null,
      model: "gpt-5-mini",
    });

    // The cost was recorded as a draft, and nothing reached Gmail.
    const { data: usage } = await db.from("ai_usage").select("purpose, status, output_tokens");
    expect(usage).toEqual([{ purpose: "draft", status: "settled", output_tokens: 400 }]);
  });

  it("takes a tone for this draft only, and replaces the pending one", async () => {
    fakeServices({ body: openAiReply("Hej!") });
    const first = await generateDraft(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken });
    const second = await generateDraft(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken, tone: "casual" });

    expect(first.tone).toBe("professional");
    expect(second.tone).toBe("casual");
    const { data } = await db.from("contact_drafts").select("id").eq("contact_id", karinId);
    expect(data).toEqual([{ id: second.id }]);
  });

  it("stops before spending anything when Gmail can't create drafts", async () => {
    const calls = fakeServices({ body: openAiReply("Hej!") });
    await db.from("google_accounts").update({ scopes: [GMAIL_READONLY] }).eq("user_id", alice.id);

    await expect(generateDraft(db, alice.id, karinId, { config: CONFIG, accessToken: fakeToken })).rejects.toBeInstanceOf(
      DraftsNotAllowed,
    );
    expect(calls.openAi).toHaveLength(0);
    expect((await db.from("ai_usage").select("id")).data).toEqual([]);

    await db
      .from("google_accounts")
      .update({ scopes: [GMAIL_READONLY, GMAIL_COMPOSE] })
      .eq("user_id", alice.id);
  });

  it("sends nothing and saves nothing at the monthly cap", async () => {
    const calls = fakeServices({ body: openAiReply("Hej!") });

    await expect(
      generateDraft(db, alice.id, karinId, { config: { ...CONFIG, monthlyCapUsd: 0 }, accessToken: fakeToken }),
    ).rejects.toBeInstanceOf(AiCapReached);

    expect(calls.openAi).toHaveLength(0);
    expect((await db.from("contact_drafts").select("id")).data).toEqual([]);
  });
});
