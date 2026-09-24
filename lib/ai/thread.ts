import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "@/lib/contacts/display";
import { contactTouches } from "@/lib/relationship/load";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";

/**
 * A contact's conversations, whole (docs/thread-context-plan.md, Part 1).
 *
 * The rest of the app works in "touches": messages between you and one
 * contact. That's right for whose turn and warmth — a message from a third
 * person isn't a turn between you two — but wrong for what the AI reads. When
 * Carl-Johan copies in Pontus and Pontus answers, the conversation is all
 * three messages, and a summary that sees only one of them says "you are
 * waiting for a reply" when you aren't.
 *
 * So for the AI only: take the threads the contact is in, and read every
 * message in them, each labelled with who wrote it.
 */

export type ThreadItem = {
  messageId: string;
  threadId: string;
  at: Date;
  subject: string | null;
  from: "you" | "them" | "other";
  /** For "other": their name if the header had one, else their address. */
  who: string | null;
  /**
   * Who it went to and who was copied, as the model reads them: "you" for the
   * user, a contact's name, or the bare address (2026-09-24 -- before, the AI
   * saw only who wrote each message, so "who did she send it on to?" had no
   * answer). From the synced headers; nothing new is read or stored.
   */
  to: string[];
  cc: string[];
};

type ThreadRow = {
  gmail_message_id: string;
  thread_id: string;
  internal_date: string;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
};

const COLUMNS =
  "gmail_message_id, thread_id, internal_date, direction, from_email, from_name, to_emails, cc_emails, subject";

/**
 * Every message of the threads this contact is in, oldest first, and every
 * address that took part in them — the people the conversation involves, which
 * is how a summary knows whether you already have plans with them.
 */
export async function loadThreadContext(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<{ items: ThreadItem[]; participants: string[] }> {
  const [touches, addresses] = await Promise.all([
    contactTouches(db, userId, contactId),
    contactAddresses(db, userId, contactId),
  ]);
  if (!touches || touches.length === 0) return { items: [], participants: [] };

  const threadIds = [...new Set(touches.map((touch) => touch.threadId))];
  const rows = await readAll<ThreadRow>(
    (from, to) =>
      db
        .from("gmail_messages")
        .select(COLUMNS)
        .eq("user_id", userId)
        .in("thread_id", threadIds)
        .order("id")
        .range(from, to),
    "Couldn't load the contact's threads",
  );

  const theirs = new Set(addresses.map((address) => address.toLowerCase()));

  const participants = new Set<string>();
  for (const row of rows) {
    for (const address of [row.from_email, ...(row.to_emails ?? []), ...(row.cc_emails ?? [])]) {
      if (address) participants.add(address.toLowerCase());
    }
  }

  const nameOf = await participantNamer(db, userId, rows);

  return {
    items: rows.map((row) => label(row, theirs, nameOf)).sort((a, b) => a.at.getTime() - b.at.getTime()),
    participants: [...participants],
  };
}

/** Just the messages, for callers that don't care who else was on them. */
export async function loadThreadMessages(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<ThreadItem[]> {
  return (await loadThreadContext(db, userId, contactId)).items;
}

function label(row: ThreadRow, theirs: Set<string>, nameOf: (address: string) => string): ThreadItem {
  const from =
    row.direction === "outbound" ? "you" : theirs.has(row.from_email.toLowerCase()) ? "them" : "other";

  return {
    messageId: row.gmail_message_id,
    threadId: row.thread_id,
    at: new Date(row.internal_date),
    subject: row.subject,
    from,
    // The name is already in the synced headers; nothing new is read or stored.
    who: from === "other" ? (row.from_name?.trim() || row.from_email) : null,
    to: (row.to_emails ?? []).map(nameOf),
    cc: (row.cc_emails ?? []).map(nameOf),
  };
}

/** The rows' own columns this needs: who wrote, and who it went to. */
type Addressed = { direction: string; from_email: string; to_emails: string[] | null; cc_emails: string[] | null };

/**
 * A way to say each address as a person would: "you" for the user's own (any
 * address they have sent from, and their Gmail address), a contact's name,
 * or the address itself. One lookup for the lot.
 */
export async function participantNamer(
  db: SupabaseClient,
  userId: string,
  rows: Addressed[],
): Promise<(address: string) => string> {
  const all = new Set<string>();
  const own = new Set<string>();
  for (const row of rows) {
    const from = row.from_email?.toLowerCase();
    if (from && row.direction === "outbound") own.add(from);
    for (const address of [from, ...(row.to_emails ?? []), ...(row.cc_emails ?? [])]) {
      if (address) all.add(address.toLowerCase());
    }
  }
  const { data: account } = await db.from("google_accounts").select("email").eq("user_id", userId).maybeSingle();
  if (account?.email) own.add(String(account.email).toLowerCase());

  const names = new Map<string, string>();
  const others = [...all].filter((address) => !own.has(address));
  if (others.length > 0) {
    const { data: links, error } = await db
      .from("contact_emails")
      .select("email, contact_id")
      .eq("user_id", userId)
      .in("email", others);
    if (error) throw supabaseError(error, "Couldn't look up who was on the thread");
    const ids = [...new Set((links ?? []).map((link) => link.contact_id as string))];
    if (ids.length > 0) {
      const { data: contacts, error: contactError } = await db
        .from("contact_list")
        .select("id, first_name, last_name, primary_email")
        .eq("user_id", userId)
        .in("id", ids);
      if (contactError) throw supabaseError(contactError, "Couldn't look up who was on the thread");
      const byId = new Map((contacts ?? []).map((contact) => [contact.id as string, displayName(contact)]));
      for (const link of links ?? []) {
        const name = byId.get(link.contact_id as string);
        if (name) names.set(String(link.email).toLowerCase(), name);
      }
    }
  }

  return (address: string) => {
    const key = address.toLowerCase();
    return own.has(key) ? "you" : (names.get(key) ?? address);
  };
}

/** A long cc list is cut, not dropped: "..., and 12 more". */
const MAX_NAMED = 8;

/**
 * " · to you, Karin Lindqvist · cc info@softwerk.se": who a message went to,
 * for the line that introduces it to the model. Every AI input uses this one
 * helper -- summaries, drafts, the promise scan and the Assistant -- so what
 * one of them can see about a thread, all of them can.
 */
export function recipientsOf(item: { to?: string[]; cc?: string[] }): string {
  const list = (people: string[]) =>
    people.length > MAX_NAMED
      ? `${people.slice(0, MAX_NAMED).join(", ")}, and ${people.length - MAX_NAMED} more`
      : people.join(", ");
  const to = item.to ?? [];
  const cc = item.cc ?? [];
  return (to.length > 0 ? ` · to ${list(to)}` : "") + (cc.length > 0 ? ` · cc ${list(cc)}` : "");
}

async function contactAddresses(db: SupabaseClient, userId: string, contactId: string): Promise<string[]> {
  const { data, error } = await db
    .from("contact_emails")
    .select("email")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .order("is_primary", { ascending: false })
    .order("email");
  if (error) throw supabaseError(error, "Couldn't load the contact's addresses");
  return data.map((row) => row.email as string);
}

/** The thread a reply would answer: the one with the newest message. */
export function latestThread(items: ThreadItem[]): ThreadItem[] {
  if (items.length === 0) return [];
  const newest = items.reduce((latest, item) => (item.at > latest.at ? item : latest));
  return items.filter((item) => item.threadId === newest.threadId);
}

/** How a message is introduced to the model: "from you", "from them", "from Pontus Berglund". */
export function writerOf(item: { from: ThreadItem["from"]; who: string | null }): string {
  if (item.from === "you") return "you";
  if (item.from === "them") return "them";
  return item.who ?? "someone else";
}
