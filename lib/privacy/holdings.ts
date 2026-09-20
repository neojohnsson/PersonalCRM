import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Everything this app holds, counted from the database rather than described
 * from memory (plan.md §3.12; docs/slice-7-plan.md, Part 1).
 *
 * A privacy page that lists what a developer *believes* is stored goes out of
 * date the first time a migration lands. This counts the rows, so the page is
 * either right or obviously broken.
 *
 * The plain words matter as much as the numbers. Each line says what one row
 * actually is, in the terms the person would use — "who wrote to whom, when,
 * and the subject line" rather than "gmail_messages". They are written to be
 * read by the people in the list, not only by the person using the app, which
 * is the standard plan.md §5.2 sets: "Build the summary assuming it will one
 * day be read by its subject."
 */

export type HoldingGroup = "you" | "people";

export type Holding = {
  table: string;
  group: HoldingGroup;
  /** What to call it on the page. */
  label: string;
  /** What one row is, in plain words. */
  what: string;
  count: number;
};

/** The order they appear on the page: the biggest and most personal first. */
const HOLDINGS: Omit<Holding, "count">[] = [
  {
    table: "contacts",
    group: "people",
    label: "Contacts",
    what: "A person's name, company, role, phone, your notes and tags about them, and how you know them.",
  },
  {
    table: "contact_emails",
    group: "people",
    label: "Email addresses",
    what: "Every address belonging to a contact, so mail from either of them counts as the same person.",
  },
  {
    table: "gmail_messages",
    group: "people",
    label: "Message details",
    what: "Who wrote to whom, when, the subject line, and whether it was a newsletter. Never the message itself — bodies are read from Gmail when needed and thrown away.",
  },
  {
    table: "contact_summaries",
    group: "people",
    label: "AI summaries",
    what: "A few sentences the AI wrote about a contact, dated, with links to the messages each claim came from. You can edit or delete any of it.",
  },
  {
    table: "next_touches",
    group: "people",
    label: "Next touches",
    what: "A day you meant to get back to someone, and why.",
  },
  {
    table: "promises",
    group: "people",
    label: "Promises found in mail",
    what: "A sentence the AI judged to be a promise, as the date and a short note — never the sentence itself.",
  },
  {
    table: "settled_threads",
    group: "people",
    label: "Finished conversations",
    what: "Conversations you marked as needing nothing more, and when you said so.",
  },
  {
    table: "contact_drafts",
    group: "people",
    label: "Drafts",
    what: "A reply waiting to be written into Gmail. Once it is in Gmail the text is deleted here and only the Gmail draft id is kept.",
  },
  {
    table: "seen_once_dismissals",
    group: "people",
    label: "Dismissed addresses",
    what: "Addresses you said were not contacts. Kept so a later sync doesn't import them again.",
  },
  {
    table: "duplicate_dismissals",
    group: "people",
    label: "Pairs you said were different people",
    what: "Two contacts you confirmed are not the same person, so they stop being suggested as duplicates.",
  },
  {
    table: "google_accounts",
    group: "you",
    label: "Your Gmail connection",
    what: "The Google address you connected, the permissions you granted, and a refresh token — encrypted, and used only to read your mail and write drafts.",
  },
  {
    table: "profiles",
    group: "you",
    label: "Your profile",
    what: "Your name and how you like drafts written: tone, length, and whether to sign off.",
  },
  {
    table: "gmail_sync_state",
    group: "you",
    label: "Sync state",
    what: "Where the last Gmail sync got to, so the next one carries on rather than starting over.",
  },
  {
    table: "ai_usage",
    group: "you",
    label: "AI spending",
    what: "One row per AI request: which model, roughly what it cost, and what it was for. No message text.",
  },
];

/**
 * Count each table for this user. Fourteen small counting queries in parallel —
 * `head: true` asks the database for the number only, so no personal data is
 * read to build the page that describes it.
 */
export async function loadHoldings(db: SupabaseClient, userId: string): Promise<Holding[]> {
  return Promise.all(
    HOLDINGS.map(async (holding) => {
      const { count, error } = await db
        .from(holding.table)
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) throw supabaseError(error, `Couldn't count ${holding.label.toLowerCase()}`);
      return { ...holding, count: count ?? 0 };
    }),
  );
}

/** The one-line summary at the top of the page. */
export function headline(holdings: Holding[]): string {
  const of = (table: string) => holdings.find((holding) => holding.table === table)?.count ?? 0;
  const parts = [
    `${of("contacts")} ${of("contacts") === 1 ? "contact" : "contacts"}`,
    `${of("gmail_messages")} message details`,
    `${of("contact_summaries")} AI ${of("contact_summaries") === 1 ? "summary" : "summaries"}`,
  ];
  return `${parts.join(", ")}. No message bodies.`;
}

/** Nothing stored at all — a new account, or one that just deleted everything. */
export function isEmpty(holdings: Holding[]): boolean {
  return holdings.every((holding) => holding.count === 0);
}
