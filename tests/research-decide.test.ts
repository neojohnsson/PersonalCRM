import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ResearchNotFound, discardPending, keepTicked, loadResearch, removeKeptFact } from "@/lib/research/decide";

/**
 * Deciding what a search found (slice 12, commit 4): nothing reaches a
 * contact until it is ticked, what is discarded is deleted, and one person
 * can decide nothing about another's research.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; contactId: string };
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
  const { data: contact } = await db
    .from("contacts")
    .insert({ user_id: data.user.id, first_name: "Karin", source: "manual" })
    .select("id")
    .single();
  return { user: data.user, db, contactId: contact!.id };
}

const fact = (n: number) => ({ text: `Fact ${n}.`, url: `https://combitech.se/${n}`, title: `Page ${n}` });

async function waiting(who: Person, count = 3): Promise<string> {
  await admin.from("contact_research").delete().eq("contact_id", who.contactId).eq("status", "pending");
  const { data, error } = await who.db
    .from("contact_research")
    .insert({
      user_id: who.user.id,
      contact_id: who.contactId,
      identity: "likely",
      identity_why: "Fits.",
      facts: Array.from({ length: count }, (_, n) => fact(n + 1)),
      model: "gpt-5.4-mini",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const row = async (id: string) =>
  (await admin.from("contact_research").select("status, facts").eq("id", id).maybeSingle()).data;

beforeAll(async () => {
  alva = await person("decide-alva");
  bea = await person("decide-bea");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("deciding", () => {
  it("keeps only the ticked facts, in their order, and ignores a tick that is not there", async () => {
    const id = await waiting(alva);
    await keepTicked(alva.db, alva.user.id, id, [2, 0, 7, 2]);
    expect(await row(id)).toEqual({ status: "kept", facts: [fact(1), fact(3)] });
  });

  it("deletes the set when nothing is ticked, and when it is discarded", async () => {
    const none = await waiting(alva);
    await keepTicked(alva.db, alva.user.id, none, []);
    expect(await row(none)).toBeNull();

    const discarded = await waiting(alva);
    await discardPending(alva.db, alva.user.id, discarded);
    expect(await row(discarded)).toBeNull();
  });

  it("takes one kept fact out, and the last one out deletes the row", async () => {
    const id = await waiting(alva, 2);
    await keepTicked(alva.db, alva.user.id, id, [0, 1]);
    await removeKeptFact(alva.db, alva.user.id, id, 0);
    expect(await row(id)).toEqual({ status: "kept", facts: [fact(2)] });
    await removeKeptFact(alva.db, alva.user.id, id, 0);
    expect(await row(id)).toBeNull();
  });

  it("shows the waiting set and the kept ones, apart", async () => {
    const kept = await waiting(alva, 1);
    await keepTicked(alva.db, alva.user.id, kept, [0]);
    const pending = await waiting(alva, 2);
    const loaded = await loadResearch(alva.db, alva.user.id, alva.contactId);
    expect(loaded.pending?.id).toBe(pending);
    expect(loaded.kept.map((set) => set.id)).toContain(kept);
  });

  it("decides nothing about somebody else's research", async () => {
    const id = await waiting(alva);
    await expect(keepTicked(bea.db, bea.user.id, id, [0])).rejects.toBeInstanceOf(ResearchNotFound);
    await expect(discardPending(bea.db, bea.user.id, id)).rejects.toBeInstanceOf(ResearchNotFound);
    // Even naming Alva: RLS answers, not the argument.
    await expect(discardPending(bea.db, alva.user.id, id)).rejects.toBeInstanceOf(ResearchNotFound);
    expect((await row(id))?.status).toBe("pending");
    expect(await loadResearch(bea.db, bea.user.id, alva.contactId)).toEqual({ pending: null, kept: [] });
  });
});

describe("the card's actions", () => {
  it("each check that research is switched on for you", () => {
    const actions = readFileSync("app/contacts/[id]/research-actions.ts", "utf8");
    const exported = actions.match(/^export async function \w+/gm) ?? [];
    expect(exported).toHaveLength(4);
    // Every action goes through allowed(), which refuses without the switch.
    expect(actions).toContain("if (!(await hasResearch(supabase, user.id))) notFound();");
    expect(actions.match(/await allowed\(\)/g)).toHaveLength(exported.length);
  });

  it("start doubtful facts unticked, so keeping one is a choice", () => {
    const card = readFileSync("app/contacts/[id]/research-card.tsx", "utf8");
    expect(card).toContain('set.identity === "unsure" ? [] :');
  });
});
