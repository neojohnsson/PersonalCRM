import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRICE_SAMPLE, costSinceUsd, priceInWords, typicalCostUsd } from "@/lib/assistant/price";

/**
 * The "Needs you" cards (slice 11, commit 6): the price they show, and that
 * pressing one goes through the app's own draft and calendar code.
 *
 * The price is read from ai_usage under RLS, so two users: Bea's expensive
 * drafts must never set the price on Alva's card.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };
let alva: Person;
let bea: Person;

async function person(label: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  return { user: data.user, db };
}

/** A finished request, written as the service would: users cannot write ai_usage. */
async function spent(who: Person, purpose: string, costUsd: number, createdAt = new Date()) {
  const { error } = await admin.from("ai_usage").insert({
    user_id: who.user.id,
    purpose,
    model: "gpt-5.4-mini",
    status: "settled",
    reserved_usd: 0.05,
    cost_usd: costUsd,
    created_at: createdAt.toISOString(),
    settled_at: createdAt.toISOString(),
  });
  if (error) throw error;
}

beforeAll(async () => {
  alva = await person("price-alva");
  bea = await person("price-bea");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("the price on a card", () => {
  it("is null with nothing to go on, so the card says 'a little' rather than guess", async () => {
    expect(await typicalCostUsd(alva.db, alva.user.id, "summary")).toBeNull();
    expect(priceInWords(null)).toBe("a little");
  });

  it("is the average of what the same thing really cost you", async () => {
    await spent(alva, "draft", 0.002);
    await spent(alva, "draft", 0.004);
    // A failed request settles at nothing and says nothing about price.
    await spent(alva, "draft", 0);

    expect(await typicalCostUsd(alva.db, alva.user.id, "draft")).toBeCloseTo(0.003, 6);
  });

  it("never counts somebody else's spending", async () => {
    await spent(bea, "draft", 0.9);
    await spent(bea, "promises", 0.5);

    expect(await typicalCostUsd(alva.db, alva.user.id, "draft")).toBeCloseTo(0.003, 6);
    expect(await typicalCostUsd(alva.db, alva.user.id, "promises")).toBeNull();
    // Even when asked by her id outright: RLS answers, not the filter.
    expect(await typicalCostUsd(alva.db, bea.user.id, "draft")).toBeNull();
  });

  it(`follows the last ${PRICE_SAMPLE}, so it moves when prices do`, async () => {
    const old = new Date(Date.now() - 86_400_000);
    for (let i = 0; i < PRICE_SAMPLE; i += 1) await spent(bea, "summary", 0.01, old);
    for (let i = 0; i < PRICE_SAMPLE; i += 1) await spent(bea, "summary", 0.002);

    expect(await typicalCostUsd(bea.db, bea.user.id, "summary")).toBeCloseTo(0.002, 6);
  });

  it("after a press, is what it really cost — a scan's contacts added up", async () => {
    const pressed = new Date();
    await spent(alva, "promises", 0.001, new Date(pressed.getTime() + 1_000));
    await spent(alva, "promises", 0.0015, new Date(pressed.getTime() + 2_000));

    expect(await costSinceUsd(alva.db, alva.user.id, "promises", pressed)).toBeCloseTo(0.0025, 6);
    expect(await costSinceUsd(alva.db, alva.user.id, "summary", pressed)).toBeNull();
  });

  it("reads like a person says it", () => {
    expect(priceInWords(0.0004)).toBe("under a tenth of a cent");
    expect(priceInWords(0.0042)).toBe("about $0.004");
    expect(priceInWords(0.031)).toBe("about $0.03");
  });
});

describe("pressing a card", () => {
  const cards = readFileSync("app/assistant/needs-you.tsx", "utf8");
  const actions = readFileSync("app/assistant/actions.ts", "utf8");

  it("saves a draft through the draft panel's own action, which can only make a Gmail draft", () => {
    expect(cards).toMatch(/import \{[^}]*saveDraftAction[^}]*\} from "@\/app\/contacts\/\[id\]\/draft-actions"/);
    // Writing it lands pending; nothing in the Assistant's actions reaches Gmail itself.
    expect(actions).toContain("generateDraft(");
    expect(actions).not.toMatch(/saveDraftToGmail|createDraft\(/);
  });

  it("creates an event through the Calendar page's own action, which has no field for a guest", () => {
    expect(cards).toMatch(/import \{ createCalendarEvent \} from "@\/app\/connect\/calendar-actions"/);
    // Code, not the card's own words ("Never with guests: …").
    expect(cards).not.toMatch(/attendees?\s*[:=]|form\.set\("(?:attendees|guests)"/i);
  });

  it("has no button that sends", () => {
    expect(cards).not.toMatch(/>\s*Send\b/);
    expect(cards).toContain("this app has no send button");
  });
});
