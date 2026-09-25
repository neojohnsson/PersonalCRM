import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiAllowanceUsed, withSpendCap, type SpendRequest } from "@/lib/ai/spend";
import { allowanceLine, allowanceOf, roomFor } from "@/lib/plans/allowance";
import { PLANS, PRICE_SEK, includes, type AiPurpose } from "@/lib/plans/plans";
import { usesThisMonth } from "@/lib/plans/usage";

/**
 * What the page says is left of Free's allowance (slice 13, commit 4). The
 * number on the screen must be the database's own: if the page said "1 left"
 * and the press was refused, the page would be lying.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const USAGE = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 };

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `usage-${name}-${randomUUID()}@example.com`,
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
  model: "gpt-5.6-luna",
  estimateUsd: 0.001,
  ceilingUsd: 100,
  ...over,
});

const works = (who: Person, purpose: AiPurpose, over: Partial<SpendRequest> = {}) =>
  withSpendCap(who.db, who.user.id, request(purpose, over), async () => ({ result: null, usage: USAGE }));

const failsForFree = (who: Person, purpose: AiPurpose) =>
  withSpendCap(who.db, who.user.id, request(purpose), async () => {
    throw new Error("OpenAI is down");
  }).catch(() => undefined);

let alva: Person;
let bea: Person;

beforeAll(async () => {
  alva = await person("alva");
  bea = await person("bea");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("the count on the page", () => {
  it("counts what the database counts, and nothing it does not", async () => {
    for (let n = 0; n < 3; n += 1) await works(alva, "summary");
    await failsForFree(alva, "summary");
    await works(alva, "summary", { countsAsUse: false });
    await works(alva, "draft");
    await works(alva, "assistant");
    await works(alva, "assistant", { countsAsUse: false });

    expect(await usesThisMonth(alva.db, alva.user.id)).toEqual({
      summary: 3,
      draft: 1,
      promises: 0,
      assistant: 1,
      research: 0,
    });
  });

  it("says none are left exactly when the database starts refusing", async () => {
    for (let n = 0; n < 2; n += 1) await works(alva, "summary");
    const left = allowanceOf(PLANS.free, await usesThisMonth(alva.db, alva.user.id), "summary")!;
    expect(left).toEqual({ used: 5, allowed: 5, left: 0 });
    await expect(works(alva, "summary")).rejects.toBeInstanceOf(AiAllowanceUsed);
  });

  it("never counts somebody else's", async () => {
    expect(await usesThisMonth(bea.db, bea.user.id)).toEqual({
      summary: 0,
      draft: 0,
      promises: 0,
      assistant: 0,
      research: 0,
    });
    // Even when Bea names Alva: RLS answers, not the argument.
    expect((await usesThisMonth(bea.db, alva.user.id)).summary).toBe(0);
  });
});

describe("the words", () => {
  const uses = { summary: 2, draft: 5, promises: 0, assistant: 19, research: 0 };

  it("say what is left, in the person's terms", () => {
    expect(allowanceLine(allowanceOf(PLANS.free, uses, "summary")!, "summary")).toBe(
      "3 of 5 free summaries left this month",
    );
    expect(allowanceLine(allowanceOf(PLANS.free, uses, "assistant")!, "assistant")).toBe(
      "1 of 20 free questions left this month",
    );
  });

  it("have no count at all on a paid plan", () => {
    expect(allowanceOf(PLANS.pro, uses, "summary")).toBeNull();
    expect(allowanceOf(PLANS.premium, uses, "assistant")).toBeNull();
  });

  it("offer the button only with dollars and a use left", () => {
    const budget = { spentUsd: 0.02, capUsd: 0.25 };
    expect(roomFor(budget, allowanceOf(PLANS.free, uses, "summary"))).toBe(true);
    expect(roomFor(budget, allowanceOf(PLANS.free, uses, "draft"))).toBe(false);
    expect(roomFor({ spentUsd: 2, capUsd: 2 }, null)).toBe(false);
    expect(roomFor({ spentUsd: 0, capUsd: 2 }, null)).toBe(true);
  });
});

describe("the pricing page's promises", () => {
  it("are built from the limits, so it cannot promise more than they give", () => {
    expect(includes(PLANS.free).map((line) => line.text)).toContain("5 summaries and 5 drafts a month");
    expect(includes(PLANS.free).find((line) => line.text.startsWith("The Assistant"))).toEqual({
      text: "The Assistant, 20 questions a month",
      yes: true,
    });
    for (const plan of [PLANS.free, PLANS.pro]) {
      expect(includes(plan).find((line) => line.text.startsWith("Research"))?.yes).toBe(false);
    }
    expect(includes(PLANS.premium).every((line) => line.yes)).toBe(true);
  });

  it("charge the agreed prices", () => {
    expect(PRICE_SEK).toEqual({ free: 0, pro: 49, premium: 99 });
  });
});
