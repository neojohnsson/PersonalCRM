import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiConfig } from "@/lib/ai/config";
import { OpenAiNoAnswer, type ResponseRequest, type StructuredResponse } from "@/lib/ai/openai";
import { BLOCKED_DOMAINS, isBlocked } from "@/lib/research/blocked";
import {
  MAX_FACTS,
  MAX_SEARCHES,
  RESEARCH_INSTRUCTIONS,
  ResearchContactNotFound,
  checkFacts,
  researchContact,
  workDomain,
} from "@/lib/research/research";

/**
 * Web research (slice 12, commit 3): the search, the checks, the saving and
 * the spending -- with OpenAI replaced by a script and the database real.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const config: AiConfig = { apiKey: "sk-test", model: "gpt-5.4-mini", draftModel: "gpt-5.4-mini", monthlyCapUsd: 10 };

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; contactId: string };
let alva: Person;
let bea: Person;
const karinEmail = `karin.lindqvist@combitech-${randomUUID().slice(0, 6)}.se`;

async function person(label: string, withContact: boolean): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  let contactId = "";
  if (withContact) {
    const { data: contact } = await db
      .from("contacts")
      .insert({ user_id: data.user.id, first_name: "Karin", last_name: "Lindqvist", company: "Combitech", source: "manual" })
      .select("id")
      .single();
    contactId = contact!.id;
    await db.from("contact_emails").insert({ user_id: data.user.id, contact_id: contactId, email: karinEmail, is_primary: true });
  }
  return { user: data.user, db, contactId };
}

beforeAll(async () => {
  alva = await person("research-alva", true);
  bea = await person("research-bea", false);
  // Premium, the plan with web research: these tests are about the search,
  // not the plan (tests/allowance.test.ts).
  await admin.from("entitlements").insert({ user_id: alva.user.id, plan: "premium" });
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

const page = (path: string, title = "A page") => ({ url: `https://www.combitech.se${path}`, title });

/** An OpenAI that answers from a script, and records what it was asked. */
function scripted(answer: unknown, sources: { url: string; title: string }[], searches = 2) {
  const asked: ResponseRequest[] = [];
  const call = async <T,>(request: ResponseRequest): Promise<StructuredResponse<T>> => {
    asked.push(request);
    return { data: answer as T, usage: { inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 }, sources, searches };
  };
  return { call, asked };
}

const pending = async (who: Person) =>
  (
    await admin
      .from("contact_research")
      .select("identity, facts, status")
      .eq("contact_id", who.contactId)
      .eq("status", "pending")
  ).data!;

describe("where it never looks", () => {
  it("blocks LinkedIn, the people-search and sales-data sites, and social media -- by name", () => {
    for (const domain of [
      "linkedin.com", "ratsit.se", "merinfo.se", "mrkoll.se", "hitta.se", "eniro.se", "upplysning.se", "birthday.se",
      "spokeo.com", "whitepages.com", "pipl.com", "zoominfo.com", "apollo.io", "rocketreach.co", "lusha.com",
      "contactout.com", "signalhire.com", "hunter.io", "facebook.com", "instagram.com", "tiktok.com", "x.com",
    ]) {
      expect(BLOCKED_DOMAINS, domain).toContain(domain);
    }
    // OpenAI takes at most 100.
    expect(BLOCKED_DOMAINS.length).toBeLessThanOrEqual(100);
  });

  it("counts subdomains, and refuses what is not a link at all", () => {
    expect(isBlocked("https://se.linkedin.com/in/karin")).toBe(true);
    expect(isBlocked("https://www.ratsit.se/person/1")).toBe(true);
    expect(isBlocked("https://notlinkedin.com/")).toBe(false);
    expect(isBlocked("not a url")).toBe(true);
  });

  it("never keeps a link that is not a web page, whatever the search returned", () => {
    const sly = { url: "javascript:alert(1)", title: "x" };
    expect(checkFacts([{ text: "Click me.", url: sly.url, title: "" }], [sly]).facts).toEqual([]);
  });
});

describe("what the model is told", () => {
  it("is told to keep facts about the person: no contact details, no repeats, no private life", () => {
    // Found 2026-09-24 on the first real search: a fact carried a job ad's
    // email address, and two facts said the same thing from one page.
    expect(RESEARCH_INSTRUCTIONS).toContain("No contact details in a fact: no email addresses and no phone numbers");
    expect(RESEARCH_INSTRUCTIONS).toContain("no two facts that say the same thing");
    expect(RESEARCH_INSTRUCTIONS).toMatch(/Never home address, family, relationships, health, politics, religion, age or birthday/);
  });

  it("gets a work email's domain, never the address, and nothing for a personal mailbox", () => {
    expect(workDomain("karin@combitech.se")).toBe("combitech.se");
    expect(workDomain("karin.l@gmail.com")).toBeNull();
    expect(workDomain(null)).toBeNull();
  });
});

describe("the checks on what comes back", () => {
  const sources = [page("/thesis", "Thesis at Combitech"), page("/news/karin"), { url: "https://www.linkedin.com/in/karin", title: "LinkedIn" }];

  it("keeps a fact only when its link is a page the search consulted", () => {
    const { facts, dropped } = checkFacts(
      [
        { text: "Leads the thesis programme.", url: "https://combitech.se/thesis/?utm_source=openai", title: "" },
        { text: "Invented, with an invented link.", url: "https://combitech.se/made-up", title: "x" },
      ],
      sources,
    );
    expect(facts).toEqual([{ text: "Leads the thesis programme.", url: "https://www.combitech.se/thesis", title: "Thesis at Combitech" }]);
    expect(dropped.notConsulted).toBe(1);
  });

  it("drops a blocked link even when the search did open it", () => {
    const { facts, dropped } = checkFacts([{ text: "Has 500 connections.", url: "https://www.linkedin.com/in/karin", title: "" }], sources);
    expect(facts).toEqual([]);
    expect(dropped.blocked).toBe(1);
  });

  it("cuts a long fact to one sentence's length, and keeps at most eight", () => {
    const long = checkFacts([{ text: "x".repeat(500), url: page("/thesis").url, title: "" }], sources).facts[0];
    expect(long.text.length).toBe(240);
    const many = checkFacts(Array.from({ length: 12 }, () => ({ text: "A fact.", url: page("/news/karin").url, title: "" })), sources);
    expect(many.facts).toHaveLength(MAX_FACTS);
  });
});

describe("a press of Research this person", () => {
  it("searches with the blocked list and a cap, and saves what survives as a waiting set", async () => {
    const { call, asked } = scripted(
      {
        identity: "sure",
        identity_why: "The Combitech page names her and matches her email's domain.",
        facts: [
          { text: "Leads the thesis programme at Combitech.", url: page("/thesis").url, title: "Thesis" },
          { text: "Made up.", url: "https://combitech.se/nowhere", title: "" },
        ],
      },
      [page("/thesis", "Thesis at Combitech")],
      3,
    );

    const result = await researchContact(alva.db, alva.user.id, alva.contactId, { config, call });

    expect(result).toMatchObject({ saved: true, identity: "sure", dropped: { notConsulted: 1 } });
    expect(asked[0].webSearch).toEqual({ blockedDomains: [...BLOCKED_DOMAINS], maxSearches: MAX_SEARCHES });
    // The domain went; the address did not.
    expect(asked[0].input).toContain(karinEmail.split("@")[1]);
    expect(asked[0].input).not.toContain(karinEmail);
    expect(await pending(alva)).toEqual([
      { identity: "sure", status: "pending", facts: [{ text: "Leads the thesis programme at Combitech.", url: page("/thesis").url, title: "Thesis" }] },
    ]);
  });

  it("pays for its searches as well as its tokens", async () => {
    const { data } = await admin
      .from("ai_usage")
      .select("cost_usd, status")
      .eq("user_id", alva.user.id)
      .eq("purpose", "research")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    // Three searches at a cent each, and the tokens on top.
    expect(data!.status).toBe("settled");
    expect(Number(data!.cost_usd)).toBeGreaterThan(0.03);
  });

  it("replaces a waiting set rather than piling up, and saves nothing when nothing survives", async () => {
    const again = scripted({ identity: "likely", identity_why: "Fits.", facts: [{ text: "Speaks at the fair.", url: page("/news/karin").url, title: "" }] }, [page("/news/karin")]);
    await researchContact(alva.db, alva.user.id, alva.contactId, { config, call: again.call });
    expect((await pending(alva)).map((set) => set.identity)).toEqual(["likely"]);

    const nothing = scripted({ identity: "unsure", identity_why: "Could be anyone.", facts: [{ text: "x", url: "https://elsewhere.se/", title: "" }] }, []);
    const result = await researchContact(alva.db, alva.user.id, alva.contactId, { config, call: nothing.call });
    expect(result.saved).toBe(false);
    // What was waiting is left as it was.
    expect((await pending(alva)).map((set) => set.identity)).toEqual(["likely"]);
  });

  it("charges the searches in full when the answer never comes", async () => {
    const failing = async <T,>(): Promise<StructuredResponse<T>> => {
      throw new OpenAiNoAnswer("cut off", { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 0 });
    };
    await expect(researchContact(alva.db, alva.user.id, alva.contactId, { config, call: failing })).rejects.toBeInstanceOf(OpenAiNoAnswer);
    const { data } = await admin
      .from("ai_usage")
      .select("cost_usd")
      .eq("user_id", alva.user.id)
      .eq("purpose", "research")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(Number(data!.cost_usd)).toBeGreaterThanOrEqual(MAX_SEARCHES * 0.01);
  });

  it("finds nothing of somebody else's", async () => {
    const { call, asked } = scripted({ identity: "sure", identity_why: "x", facts: [] }, []);
    await expect(researchContact(bea.db, bea.user.id, alva.contactId, { config, call })).rejects.toBeInstanceOf(ResearchContactNotFound);
    // Nothing was searched, and nothing was spent.
    expect(asked).toHaveLength(0);
  });
});
