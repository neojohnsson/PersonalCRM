import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolStep } from "@/lib/ai/openai-tools";
import {
  AiAllowanceUsed,
  AiCapReached,
  limitMessage,
  nextMonthInStockholm,
  withSpendCap,
  type SpendRequest,
} from "@/lib/ai/spend";
import { converse } from "@/lib/assistant/converse";
import { PLANS, limitsOf, type AiPurpose } from "@/lib/plans/plans";

/**
 * Free's monthly allowance and the plans' budgets (slice 13, commit 3;
 * docs/slice-13-plan.md §2), against the real database: migration 0028's
 * reserve_ai_use counts the uses inside the same lock as the dollars.
 *
 * Fails until supabase/migrations/0028_allowance.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const MODEL = "gpt-5.6-luna";
const USAGE = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 };

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `allowance-${name}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

const request = (purpose: AiPurpose, over: Partial<SpendRequest> = {}): SpendRequest => ({
  contactId: null,
  purpose,
  model: MODEL,
  estimateUsd: 0.001,
  ceilingUsd: 100,
  ...over,
});

/** One AI request that works, as the app makes it. Returns whether it ran. */
async function use(who: Person, purpose: AiPurpose, over: Partial<SpendRequest> = {}): Promise<boolean> {
  let ran = false;
  await withSpendCap(who.db, who.user.id, request(purpose, over), async () => {
    ran = true;
    return { result: null, usage: USAGE };
  });
  return ran;
}

async function setPlan(who: Person, plan: string) {
  const { error } = await admin.from("entitlements").upsert({ user_id: who.user.id, plan });
  if (error) throw error;
}

let alva: Person;
let bea: Person;

beforeAll(async () => {
  alva = await person("alva");
  bea = await person("bea");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

beforeEach(async () => {
  for (const who of [alva, bea]) {
    await admin.from("ai_usage").delete().eq("user_id", who.user.id);
    await admin.from("entitlements").delete().eq("user_id", who.user.id);
  }
});

describe("what each plan is held to", () => {
  it("is a count on Free, and dollars only on Pro and Premium", () => {
    expect(limitsOf(PLANS.free, "summary", 100)).toEqual({ capUsd: 0.25, maxUses: 5 });
    expect(limitsOf(PLANS.free, "assistant", 100)).toEqual({ capUsd: 0.25, maxUses: 20 });
    expect(limitsOf(PLANS.free, "research", 100)).toEqual({ capUsd: 0.25, maxUses: 0 });
    expect(limitsOf(PLANS.pro, "summary", 100)).toEqual({ capUsd: 2, maxUses: null });
    expect(limitsOf(PLANS.pro, "assistant", 100)).toEqual({ capUsd: 3, maxUses: null });
    expect(limitsOf(PLANS.premium, "assistant", 100)).toEqual({ capUsd: 10, maxUses: null });
  });

  it("never goes above the environment's emergency brake, whatever the plan", () => {
    expect(limitsOf(PLANS.premium, "summary", 1).capUsd).toBe(1);
    expect(limitsOf(PLANS.premium, "assistant", 0).capUsd).toBe(0);
  });
});

describe("Free's allowance", () => {
  it("runs five summaries, and refuses the sixth before anything is sent", async () => {
    for (let n = 0; n < 5; n += 1) expect(await use(alva, "summary")).toBe(true);

    let ran = false;
    const failure = await withSpendCap(alva.db, alva.user.id, request("summary"), async () => {
      ran = true;
      return { result: null, usage: USAGE };
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiAllowanceUsed);
    expect(failure).toMatchObject({ purpose: "summary", used: 5, allowed: 5 });
    expect(ran).toBe(false);
  });

  it("counts each purpose apart: five summaries leave five drafts", async () => {
    for (let n = 0; n < 5; n += 1) await use(alva, "summary");
    expect(await use(alva, "draft")).toBe(true);
  });

  it("does not count a request that failed before it cost anything", async () => {
    for (let n = 0; n < 4; n += 1) await use(alva, "summary");
    await withSpendCap(alva.db, alva.user.id, request("summary"), async () => {
      throw new Error("OpenAI is down");
    }).catch(() => undefined);
    expect(await use(alva, "summary")).toBe(true);
  });

  it("lets exactly one of two presses at the same moment take the last use", async () => {
    for (let n = 0; n < 4; n += 1) await use(alva, "summary");
    const both = await Promise.allSettled([use(alva, "summary"), use(alva, "summary")]);
    expect(both.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = both.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(AiAllowanceUsed);
  });

  it("does not count, or stop, the later part of something already counted", async () => {
    for (let n = 0; n < 5; n += 1) await use(alva, "summary");
    expect(await use(alva, "summary", { countsAsUse: false })).toBe(true);
    const { data } = await admin.from("ai_usage").select("counts_as_use").eq("user_id", alva.user.id);
    expect(data!.filter((row) => row.counts_as_use)).toHaveLength(5);
  });

  it("has no web research at all", async () => {
    await expect(use(alva, "research")).rejects.toBeInstanceOf(AiAllowanceUsed);
  });

  it("is yours alone: Alva using hers leaves Bea's whole", async () => {
    for (let n = 0; n < 5; n += 1) await use(alva, "summary");
    expect(await use(bea, "summary")).toBe(true);
  });

  it("is still held by dollars: one runaway request cannot cost more than $0.25", async () => {
    const failure = await use(alva, "summary", { estimateUsd: 0.3 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiCapReached);
    expect(failure).not.toBeInstanceOf(AiAllowanceUsed);
  });
});

describe("a paid plan", () => {
  it("has no count: Pro runs a sixth summary and more", async () => {
    await setPlan(alva, "pro");
    for (let n = 0; n < 7; n += 1) expect(await use(alva, "summary")).toBe(true);
  });

  it("keeps its dollar limit", async () => {
    await setPlan(alva, "pro");
    await expect(use(alva, "summary", { estimateUsd: 2.5 })).rejects.toBeInstanceOf(AiCapReached);
  });

  it("is held by the emergency brake even on Premium", async () => {
    await setPlan(alva, "premium");
    await expect(use(alva, "summary", { estimateUsd: 0.5, ceilingUsd: 0.4 })).rejects.toBeInstanceOf(AiCapReached);
  });
});

describe("a question to the Assistant", () => {
  const small = { inputTokens: 500, cachedInputTokens: 0, outputTokens: 50 };
  const steps: ToolStep[] = [
    {
      output: [{ type: "function_call", call_id: "c1", name: "who_needs_you", arguments: "{}" }],
      text: null,
      calls: [{ callId: "c1", name: "who_needs_you", arguments: "{}" }],
      usage: small,
    },
    {
      output: [{ type: "function_call", call_id: "c2", name: "this_week", arguments: "{}" }],
      text: null,
      calls: [{ callId: "c2", name: "this_week", arguments: "{}" }],
      usage: small,
    },
    { output: [{ type: "message", content: [{ type: "output_text", text: "Nobody." }] }], text: "Nobody.", calls: [], usage: small },
  ];

  async function ask(resume: ToolStep["output"] | null = null) {
    let index = 0;
    const events = [];
    for await (const event of converse({
      db: alva.db,
      userId: alva.user.id,
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      history: [{ role: "user", text: "Who needs me?" }],
      monthlyCapUsd: 10,
      step: async () => steps[Math.min(index++, steps.length - 1)],
      resume,
    })) {
      events.push(event);
    }
    return events;
  }

  const counted = async () =>
    (await admin.from("ai_usage").select("counts_as_use").eq("user_id", alva.user.id).eq("purpose", "assistant")).data!;

  it("counts as one use however many steps it takes", async () => {
    await ask();
    expect((await counted()).map((row) => row.counts_as_use)).toEqual([true, false, false]);
  });

  it("does not count again when it carries on", async () => {
    await ask([{ role: "user", content: "Who needs me?" }]);
    expect((await counted()).every((row) => !row.counts_as_use)).toBe(true);
  });

  it("is refused at the twenty-first, and says so in words", async () => {
    for (let n = 0; n < 20; n += 1) await use(alva, "assistant");
    const events = await ask();
    expect(events.at(-1)).toMatchObject({
      type: "stopped",
      reason: expect.stringContaining("You've used this month's 20 free questions to the Assistant."),
    });
  });
});

describe("what the person is told", () => {
  const now = new Date("2026-09-24T10:00:00Z");

  it("names the allowance and the day it comes back", () => {
    expect(limitMessage(new AiAllowanceUsed("summary", 5, 5), now)).toBe(
      "You've used this month's 5 free summaries. They come back on 1 October, or Pro has no monthly limit.",
    );
    expect(limitMessage(new AiAllowanceUsed("research", 0, 0), now)).toBe(
      "Free doesn't include web searches. Premium does.",
    );
  });

  it("names the budget when it is dollars", () => {
    expect(limitMessage(new AiCapReached(2, 2), now)).toBe(
      "This month's AI budget is used up ($2.00 of $2.00). It starts again on 1 October.",
    );
  });

  it("finds next month across a new year, in Swedish time", () => {
    // 00:30 on 1 January in Stockholm (UTC+1 in winter): the limits next start on 1 February.
    expect(nextMonthInStockholm(new Date("2026-12-31T23:30:00Z")).toISOString()).toBe("2027-01-31T23:00:00.000Z");
    // 23:30 on 31 December there: still December.
    expect(nextMonthInStockholm(new Date("2026-12-31T22:30:00Z")).toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });
});
