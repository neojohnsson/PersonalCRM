import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0026, with two users (docs/slice-12-plan.md; AGENTS.md: "RLS
 * policies get tested with two users").
 *
 *   entitlements.research   readable, and writable by nobody through the API
 *   contact_research        yours only, about your own contacts only; one
 *                           waiting set per contact; bounded, so it cannot
 *                           become a place to store pages
 *   ai_usage                'research' is a purpose
 *
 * Fails until supabase/migrations/0026_web_research.sql has been run.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; contactId: string };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `research-${name}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ user_id: data.user.id, first_name: name === "alva" ? "Karin" : "Johan", source: "manual" })
    .select("id")
    .single();
  if (contactError) throw contactError;
  return { user: data.user, db, contactId: contact.id };
}

const fact = { text: "Leads the thesis programme at Combitech.", url: "https://combitech.se/thesis", title: "Thesis at Combitech" };

const research = (who: Person, over: Record<string, unknown> = {}) => ({
  user_id: who.user.id,
  contact_id: who.contactId,
  identity: "likely",
  identity_why: "Same name, and the page is on their email's domain.",
  facts: [fact],
  model: "gpt-5.4-mini",
  ...over,
});

let alva: Person;
let bea: Person;

beforeAll(async () => {
  alva = await person("alva");
  bea = await person("bea");
  const { error } = await admin.from("entitlements").insert({ user_id: alva.user.id, plan: "premium" });
  if (error) throw error;
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("the research switch", () => {
  it("is yours to read", async () => {
    const { data } = await alva.db.from("entitlements").select("plan").eq("user_id", alva.user.id).single();
    expect(data).toEqual({ plan: "premium" });
  });

  it("is nobody's to switch on through the API, not even for themselves", async () => {
    await bea.db.from("entitlements").insert({ user_id: bea.user.id, plan: "premium" });
    await bea.db.from("entitlements").update({ plan: "premium" }).eq("user_id", bea.user.id);
    const { data } = await admin.from("entitlements").select("plan").eq("user_id", bea.user.id).maybeSingle();
    expect(data?.plan ?? "free").toBe("free");
  });
});

describe("contact_research", () => {
  it("holds your own research, which nobody else can see, change or delete", async () => {
    const { data: row, error } = await alva.db.from("contact_research").insert(research(alva)).select("id").single();
    expect(error).toBeNull();

    const { data: seen } = await bea.db.from("contact_research").select("id").eq("id", row!.id);
    expect(seen).toEqual([]);
    await bea.db.from("contact_research").update({ status: "kept" }).eq("id", row!.id);
    await bea.db.from("contact_research").delete().eq("id", row!.id);

    const { data: still } = await admin.from("contact_research").select("status").eq("id", row!.id).single();
    expect(still).toEqual({ status: "pending" });
  });

  it("can only be about your own contacts, whoever it claims to belong to", async () => {
    // As Bea, about Alva's contact: the contact is not hers.
    const asBea = await bea.db.from("contact_research").insert(research(bea, { contact_id: alva.contactId }));
    expect(asBea.error).not.toBeNull();
    // As Bea, claiming to be Alva: the row is not hers.
    const asAlva = await bea.db.from("contact_research").insert(research(alva));
    expect(asAlva.error).not.toBeNull();
  });

  it("keeps one waiting set per contact, and any number of kept ones", async () => {
    const second = await alva.db.from("contact_research").insert(research(alva));
    expect(second.error?.code).toBe("23505");

    const kept = await alva.db.from("contact_research").insert([
      research(alva, { status: "kept" }),
      research(alva, { status: "kept" }),
    ]);
    expect(kept.error).toBeNull();
  });

  it("cannot become a place to store pages", async () => {
    const nine = Array.from({ length: 9 }, () => fact);
    for (const over of [
      { facts: nine },
      { facts: [] },
      { facts: { text: "not a list" } },
      { facts: [{ text: "x".repeat(20_000), url: "https://x.se", title: "x" }] },
      { identity: "certain" },
      { identity_why: "" },
    ]) {
      const { error } = await alva.db.from("contact_research").insert(research(alva, { status: "kept", ...over }));
      expect(error, JSON.stringify(over).slice(0, 60)).not.toBeNull();
    }
  });

  it("goes with the contact", async () => {
    const { data: extra } = await alva.db
      .from("contacts")
      .insert({ user_id: alva.user.id, first_name: "Temporary", source: "manual" })
      .select("id")
      .single();
    await alva.db.from("contact_research").insert(research(alva, { contact_id: extra!.id }));
    await admin.from("contacts").delete().eq("id", extra!.id);

    const { count } = await admin
      .from("contact_research")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", extra!.id);
    expect(count).toBe(0);
  });
});

describe("ai_usage", () => {
  it("knows 'research' as a purpose", async () => {
    const { error } = await admin.from("ai_usage").insert({
      user_id: alva.user.id,
      purpose: "research",
      model: "gpt-5.4-mini",
      reserved_usd: 0.1,
    });
    expect(error).toBeNull();
  });
});
