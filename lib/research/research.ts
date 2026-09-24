import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfig, type AiConfig } from "@/lib/ai/config";
import { estimateTokens, maxCostOf } from "@/lib/ai/models";
import { createStructuredResponse, type JsonSchema, type ResponseRequest, type StructuredResponse, type WebSource } from "@/lib/ai/openai";
import { withSpendCap } from "@/lib/ai/spend";
import { displayName } from "@/lib/contacts/display";
import { supabaseError } from "@/lib/supabase/errors";
import { BLOCKED_DOMAINS, isBlocked } from "./blocked";

/**
 * Research this person (slice 12; docs/slice-12-plan.md, plan.md §3.11).
 *
 * One press, one contact, one request to OpenAI with its web_search tool --
 * never a background job. What comes back is checked by code before anything
 * is saved, and what is saved is a WAITING set: nothing reaches the contact
 * until the person ticks it (lib/research/decide.ts).
 *
 * The checks, and why each one is code and not an instruction:
 *
 *   a fact's link must be a page the search actually consulted -- a link the
 *   model made up is dropped, so every kept fact can be opened and read
 *
 *   a link on a blocked domain is dropped, even though the search itself was
 *   told not to look there (lib/research/blocked.ts)
 *
 *   a fact is one sentence of at most 240 characters, at most 8 of them, and
 *   only the sentence, the link and the page title are stored -- never the page
 *
 * What the model is given: the contact's name, company, role, how you know
 * them, and the DOMAIN of their email -- never the address, and no domain at
 * all for a personal mailbox, which says nothing about where they work.
 */

export const MAX_FACTS = 8;
export const MAX_FACT_CHARS = 240;
/** Searches per press. $10 per 1,000: at most 5 cents. */
export const MAX_SEARCHES = 5;
export const SEARCH_USD = 0.01;
/** Reasoning included; the answer itself is a few hundred tokens. */
export const MAX_OUTPUT_TOKENS = 4_000;
/** What a search reads and hands the model, at most, for the reservation. */
const SEARCH_CONTENT_TOKENS = 40_000;

export type Identity = "sure" | "likely" | "unsure";
export type ResearchFact = { text: string; url: string; title: string };
export type ResearchSet = { identity: Identity; identityWhy: string; facts: ResearchFact[] };

export class ResearchContactNotFound extends Error {
  constructor() {
    super("That contact isn't there any more.");
    this.name = "ResearchContactNotFound";
  }
}

/** Mailboxes anyone can have: their domain says nothing about work. */
const PERSONAL_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.se", "outlook.com", "outlook.se", "live.com", "live.se",
  "msn.com", "yahoo.com", "yahoo.se", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "telia.com",
  "spray.se", "bredband.net", "aol.com", "gmx.com", "gmx.net",
]);

export const RESEARCH_INSTRUCTIONS = `You research one professional contact of the user, on the public web, so the user can decide what to add to their contact record. The user approves every fact before it is kept.

Find public, professional facts about THIS person: their current role and employer, what their work is about, public talks, articles, news mentions, their organisation's own pages about them. Say whether the pages you found are about this very person.

Rules:
- Only professional facts. Never home address, family, relationships, health, politics, religion, age or birthday, personal ID numbers, salary, finances or anything about private life. Write each fact as if the person will read it one day.
- Every fact must come from a page you actually opened in your search, and its "url" must be that page's address exactly. Never cite a page you did not open. Never cite LinkedIn, people-search or data-broker sites, or personal social media.
- One sentence per fact, at most 240 characters, in plain English. At most 8 facts. No fact that only repeats what the user already gave you, and no two facts that say the same thing -- one page usually gives one fact.
- No contact details in a fact: no email addresses and no phone numbers, even public ones. The user already has a way to reach them; a fact is about who they are and what they do.
- "identity": "sure" only when a page ties the name to the given company or email domain; "likely" when it fits but nothing ties it for certain; "unsure" when it may be someone else with the same name. "identity_why" says why, in one sentence.
- If you find nothing reliable, return an empty list of facts and say so in identity_why. An empty answer is better than a wrong one about a real person.`;

export const RESEARCH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    identity: { type: "string", enum: ["sure", "likely", "unsure"] },
    identity_why: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["text", "url", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["identity", "identity_why", "facts"],
  additionalProperties: false,
};

type RawResearch = { identity: Identity; identity_why: string; facts: { text: string; url: string; title: string }[] };

export type ResearchSubject = {
  name: string;
  company: string | null;
  role: string | null;
  howKnown: string | null;
  /** Their work email's domain, or null for none or a personal mailbox. */
  domain: string | null;
};

export function buildResearchInput(subject: ResearchSubject): string {
  return [
    `Name: ${subject.name}`,
    `Company: ${subject.company ?? "(not known)"}`,
    `Role: ${subject.role ?? "(not known)"}`,
    `Their email's domain: ${subject.domain ?? "(not known)"}`,
    `How the user knows them: ${subject.howKnown ?? "(not said)"}`,
  ].join("\n");
}

/** "combitech.se" from "karin@combitech.se"; null for a personal mailbox. */
export function workDomain(email: string | null): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || PERSONAL_MAIL.has(domain)) return null;
  return domain;
}

/** A link reduced to what identifies a page: host (without www.) and path. */
function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export type CheckedFacts = {
  facts: ResearchFact[];
  dropped: { notConsulted: number; blocked: number; empty: number };
};

/**
 * The model's facts, keeping only those whose link is a consulted page that
 * is not on a blocked domain -- cut to one sentence's length, at most 8.
 */
export function checkFacts(raw: RawResearch["facts"], sources: WebSource[]): CheckedFacts {
  const consulted = new Map<string, WebSource>();
  for (const source of sources) {
    const key = pageKey(source.url);
    if (key) consulted.set(key, source);
  }

  const dropped = { notConsulted: 0, blocked: 0, empty: 0 };
  const facts: ResearchFact[] = [];
  for (const fact of raw) {
    const text = fact.text?.trim().replace(/\s+/g, " ") ?? "";
    if (!text) {
      dropped.empty += 1;
      continue;
    }
    if (isBlocked(fact.url)) {
      dropped.blocked += 1;
      continue;
    }
    const key = pageKey(fact.url);
    const source = key ? consulted.get(key) : undefined;
    if (!source) {
      dropped.notConsulted += 1;
      continue;
    }
    if (facts.length >= MAX_FACTS) break;
    const host = new URL(fact.url).hostname.replace(/^www\./, "");
    facts.push({
      text: text.length > MAX_FACT_CHARS ? `${text.slice(0, MAX_FACT_CHARS - 1).trimEnd()}…` : text,
      // The consulted page's own address, not the model's copy of it.
      url: source.url,
      title: (fact.title?.trim() || source.title?.trim() || host).slice(0, 200),
    });
  }
  return { facts, dropped };
}

export type ResearchOptions = {
  config?: AiConfig;
  /** Swapped for a fake in tests. */
  call?: <T>(request: ResponseRequest) => Promise<StructuredResponse<T>>;
};

export type ResearchResult = ResearchSet & { saved: boolean; dropped: CheckedFacts["dropped"] };

/**
 * Search, check, and save what survives as the contact's waiting set --
 * replacing any set already waiting. With nothing left, nothing is saved.
 */
export async function researchContact(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  options: ResearchOptions = {},
): Promise<ResearchResult> {
  const config = options.config ?? aiConfig();
  const call = options.call ?? createStructuredResponse;

  const [{ data: contact, error }, { data: listed, error: listError }] = await Promise.all([
    db
      .from("contacts")
      .select("first_name, last_name, company, role, how_known")
      .eq("user_id", userId)
      .eq("id", contactId)
      .maybeSingle(),
    db.from("contact_list").select("primary_email").eq("user_id", userId).eq("id", contactId).maybeSingle(),
  ]);
  if (error) throw supabaseError(error, "Couldn't load the contact");
  if (listError) throw supabaseError(listError, "Couldn't load the contact");
  if (!contact) throw new ResearchContactNotFound();

  const email = (listed?.primary_email as string | null) ?? null;
  const subject: ResearchSubject = {
    name: displayName({ ...contact, primary_email: email }),
    company: (contact.company as string | null) ?? null,
    role: (contact.role as string | null) ?? null,
    howKnown: (contact.how_known as string | null) ?? null,
    domain: workDomain(email),
  };
  const input = buildResearchInput(subject);
  const model = config.draftModel;
  const searchesMax = MAX_SEARCHES * SEARCH_USD;

  const response = await withSpendCap(
    db,
    userId,
    {
      contactId,
      purpose: "research",
      model,
      estimateUsd:
        maxCostOf(model, estimateTokens(RESEARCH_INSTRUCTIONS + input) + SEARCH_CONTENT_TOKENS, MAX_OUTPUT_TOKENS) +
        searchesMax,
      capUsd: config.monthlyCapUsd,
      extraUsdIfFailed: searchesMax,
    },
    async () => {
      const answer = await call<RawResearch>({
        apiKey: config.apiKey,
        model,
        instructions: RESEARCH_INSTRUCTIONS,
        input,
        schemaName: "contact_research",
        schema: RESEARCH_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        webSearch: { blockedDomains: [...BLOCKED_DOMAINS], maxSearches: MAX_SEARCHES },
      });
      return { result: answer, usage: answer.usage, extraUsd: (answer.searches ?? 0) * SEARCH_USD };
    },
  );

  const identity: Identity = ["sure", "likely", "unsure"].includes(response.data.identity) ? response.data.identity : "unsure";
  const why = response.data.identity_why?.trim().replace(/\s+/g, " ") || "No reason given.";
  // The column holds 300; a longer reason ends with an ellipsis, not mid-word.
  const identityWhy = why.length > 300 ? `${why.slice(0, 299).trimEnd()}…` : why;
  const checked = checkFacts(response.data.facts ?? [], response.sources ?? []);

  if (checked.facts.length === 0) {
    return { identity, identityWhy, facts: [], saved: false, dropped: checked.dropped };
  }

  // One waiting set per contact (migration 0026): the new one replaces it.
  const { error: clearError } = await db
    .from("contact_research")
    .delete()
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "pending");
  if (clearError) throw supabaseError(clearError, "Couldn't replace the waiting research");

  const { error: saveError } = await db.from("contact_research").insert({
    user_id: userId,
    contact_id: contactId,
    identity,
    identity_why: identityWhy,
    facts: checked.facts,
    model,
  });
  if (saveError) throw supabaseError(saveError, "Couldn't save what was found");

  return { identity, identityWhy, facts: checked.facts, saved: true, dropped: checked.dropped };
}
