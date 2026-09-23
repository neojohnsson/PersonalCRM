import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiNoAnswer } from "@/lib/ai/openai";
import { AiCapReached, spentThisMonth, withSpendCap } from "@/lib/ai/spend";

/**
 * withSpendCap against the real database: at the cap the request is never
 * run, and whatever happens, the real cost is recorded.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MODEL = "gpt-5.6-luna";
const USAGE = { inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 1_000 };
// 10,000 × $0.25/M + 1,000 × $0.75/M (prices re-checked 2026-09-23)
const USAGE_COST = 0.00325;

describe("withSpendCap", () => {
  let alice: User;
  let db: SupabaseClient;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `spend-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    alice = data.user;

    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await db.auth.signInWithPassword({ email: alice.email!, password: PASSWORD });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
  });

  beforeEach(async () => {
    await admin.from("ai_usage").delete().eq("user_id", alice.id);
  });

  const request = (estimateUsd: number, capUsd: number) => ({
    contactId: null,
    purpose: "summary" as const,
    model: MODEL,
    estimateUsd,
    capUsd,
  });

  async function rows() {
    const { data } = await db.from("ai_usage").select("status, reserved_usd, cost_usd, input_tokens, output_tokens");
    return data;
  }

  it("runs the request under the cap and records its real cost", async () => {
    const result = await withSpendCap(db, alice.id, request(0.01, 2), async () => ({ result: "summary", usage: USAGE }));

    expect(result).toBe("summary");
    expect(await rows()).toEqual([
      { status: "settled", reserved_usd: 0.01, cost_usd: USAGE_COST, input_tokens: 10_000, output_tokens: 1_000 },
    ]);
    expect(await spentThisMonth(db, alice.id)).toBeCloseTo(USAGE_COST, 6);
  });

  it("never runs the request when the cap would be passed", async () => {
    await withSpendCap(db, alice.id, request(0.01, 2), async () => ({ result: 1, usage: USAGE }));

    const work = vi.fn(async () => ({ result: 2, usage: USAGE }));
    const failure = await withSpendCap(db, alice.id, request(0.01, 0.01), work).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiCapReached);
    expect((failure as AiCapReached).spentUsd).toBeCloseTo(USAGE_COST, 6);
    expect(work).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });

  it("records the tokens a refusal used, and passes the failure on", async () => {
    const failure = await withSpendCap(db, alice.id, request(0.01, 2), async () => {
      throw new OpenAiNoAnswer("declined", USAGE);
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OpenAiNoAnswer);
    expect(await rows()).toEqual([
      { status: "settled", reserved_usd: 0.01, cost_usd: USAGE_COST, input_tokens: 10_000, output_tokens: 1_000 },
    ]);
  });

  it("records nothing spent when the request failed before OpenAI answered", async () => {
    await expect(
      withSpendCap(db, alice.id, request(0.01, 2), async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");

    expect(await rows()).toEqual([
      { status: "settled", reserved_usd: 0.01, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    ]);
  });
});
