import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { PLANS, planNamed } from "@/lib/plans/plans";
import { currentPlan } from "@/lib/plans/current";
import { hasResearch } from "@/lib/research/entitlement";

/**
 * Migration 0027, with two users (docs/slice-13-plan.md §2 and §4; AGENTS.md:
 * "RLS policies get tested with two users").
 *
 *   entitlements.plan and the Stripe columns   yours to read, nobody's to
 *                                               write through the API
 *   what a plan includes                       lib/plans/plans.ts, read
 *                                               through the plan
 *
 * Fails until supabase/migrations/0027_plans.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `plans-${name}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

const PAID = {
  plan: "pro",
  stripe_customer_id: `cus_test_${randomUUID().slice(0, 8)}`,
  stripe_subscription_id: `sub_test_${randomUUID().slice(0, 8)}`,
  current_period_end: "2026-10-24T00:00:00+00:00",
  withdrawal_waived_at: "2026-09-24T10:00:00+00:00",
};

const row = async (who: Person) =>
  (
    await admin
      .from("entitlements")
      .select("plan, stripe_customer_id, stripe_subscription_id, current_period_end, withdrawal_waived_at")
      .eq("user_id", who.user.id)
      .maybeSingle()
  ).data;

let alva: Person;
let bea: Person;

beforeAll(async () => {
  alva = await person("alva");
  bea = await person("bea");
  // Only the owner -- later the Stripe webhook -- can write this.
  const { error } = await admin.from("entitlements").insert({ user_id: alva.user.id, ...PAID });
  if (error) throw error;
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("your plan", () => {
  it("is yours to read, with its Stripe ids", async () => {
    const { data } = await alva.db
      .from("entitlements")
      .select("plan, stripe_customer_id, stripe_subscription_id, current_period_end, withdrawal_waived_at")
      .eq("user_id", alva.user.id)
      .single();
    expect(data).toEqual(PAID);
  });

  it("cannot be raised, extended or rewritten by you", async () => {
    const before = await row(alva);
    await alva.db.from("entitlements").update({ plan: "premium" }).eq("user_id", alva.user.id);
    await alva.db.from("entitlements").update({ current_period_end: "2099-01-01T00:00:00Z" }).eq("user_id", alva.user.id);
    await alva.db.from("entitlements").update({ stripe_subscription_id: "sub_somebody_elses" }).eq("user_id", alva.user.id);
    await alva.db.from("entitlements").delete().eq("user_id", alva.user.id);
    expect(await row(alva)).toEqual(before);
  });

  it("cannot be given to yourself when you have none", async () => {
    const { error } = await bea.db.from("entitlements").insert({ user_id: bea.user.id, plan: "premium" });
    expect(error).not.toBeNull();
    await bea.db.from("entitlements").upsert({ user_id: bea.user.id, plan: "premium" });
    expect(await row(bea)).toBeNull();
  });

  it("cannot be seen by anybody else, Stripe ids included", async () => {
    const { data } = await bea.db.from("entitlements").select("*");
    expect(data).toEqual([]);
  });

  it("is only ever one of the three, even for the owner", async () => {
    const { error } = await admin.from("entitlements").update({ plan: "gold" }).eq("user_id", alva.user.id);
    expect(error).not.toBeNull();
    expect((await row(alva))?.plan).toBe("pro");
  });

  it("gives no two people the same Stripe subscription", async () => {
    const { error } = await admin
      .from("entitlements")
      .insert({ user_id: bea.user.id, plan: "pro", stripe_subscription_id: PAID.stripe_subscription_id });
    expect(error).not.toBeNull();
  });
});

describe("what a plan includes", () => {
  it("is read through the plan: Pro has the Assistant and no research", async () => {
    expect(await currentPlan(alva.db, alva.user.id)).toEqual(PLANS.pro);
    expect(await hasAssistant(alva.db, alva.user.id)).toBe(true);
    expect(await hasResearch(alva.db, alva.user.id)).toBe(false);
  });

  it("is Free with no row at all: the Assistant on its allowance, and no research", async () => {
    expect(await currentPlan(bea.db, bea.user.id)).toEqual(PLANS.free);
    expect(await hasAssistant(bea.db, bea.user.id)).toBe(true);
    expect(await hasResearch(bea.db, bea.user.id)).toBe(false);
  });

  it("is never more than was paid for: an unknown name is Free", () => {
    expect(planNamed("gold")).toBe(PLANS.free);
    expect(planNamed(null)).toBe(PLANS.free);
    expect(planNamed("constructor")).toBe(PLANS.free);
    expect(planNamed("premium")).toBe(PLANS.premium);
  });
});
