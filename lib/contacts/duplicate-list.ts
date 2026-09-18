import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findDuplicates,
  pairKey,
  type DuplicateContact,
  type DuplicatePair,
  type ThreadAddresses,
} from "@/lib/contacts/duplicates";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";

/**
 * The duplicate pairs to show, with both contacts' details
 * (docs/slice-6a-plan.md, Parts 1 and 3).
 *
 * The rules are in lib/contacts/duplicates.ts and need no database; this reads
 * what they need and hangs the contacts back onto each pair for the page.
 */

export type DuplicateSide = DuplicateContact & {
  primary_email: string | null;
  message_count: number;
  created_at: string;
};

export type DuplicateSuggestion = DuplicatePair & { keep: DuplicateSide; other: DuplicateSide };

type ContactRow = DuplicateSide;
type MessageRow = { thread_id: string; from_email: string; to_emails: string[]; cc_emails: string[] };

export async function loadDuplicates(db: SupabaseClient, userId: string): Promise<DuplicateSuggestion[]> {
  const [contacts, messages, dismissals] = await Promise.all([
    readAll<ContactRow>(
      (from, to) =>
        db
          .from("contact_list")
          .select("id, first_name, last_name, company, primary_email, emails, message_count, created_at")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contacts",
    ),
    readAll<MessageRow>(
      (from, to) =>
        db
          .from("gmail_messages")
          .select("thread_id, from_email, to_emails, cc_emails")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load messages",
    ),
    db.from("duplicate_dismissals").select("contact_a, contact_b").eq("user_id", userId),
  ]);
  if (dismissals.error) throw supabaseError(dismissals.error, "Couldn't load dismissed pairs");

  // contact_list has no phone; the rules use it, so read it once here.
  const phones = await readAll<{ id: string; phone: string | null }>(
    (from, to) => db.from("contacts").select("id, phone").eq("user_id", userId).order("id").range(from, to),
    "Couldn't load contacts",
  );
  const phoneOf = new Map(phones.map((row) => [row.id, row.phone]));
  const withPhone: DuplicateSide[] = contacts.map((contact) => ({ ...contact, phone: phoneOf.get(contact.id) ?? null }));

  const threads = new Map<string, Set<string>>();
  for (const message of messages) {
    const addresses = threads.get(message.thread_id) ?? new Set<string>();
    for (const address of [message.from_email, ...(message.to_emails ?? []), ...(message.cc_emails ?? [])]) {
      if (address) addresses.add(address.toLowerCase());
    }
    threads.set(message.thread_id, addresses);
  }
  const threadList: ThreadAddresses[] = [...threads.entries()].map(([threadId, addresses]) => ({
    threadId,
    addresses: [...addresses],
  }));

  const dismissed = new Set((dismissals.data ?? []).map((row) => pairKey(row.contact_a, row.contact_b)));
  const byId = new Map(withPhone.map((contact) => [contact.id, contact]));

  return findDuplicates(withPhone, threadList, dismissed)
    .map((pair) => {
      const keep = byId.get(pair.a);
      const other = byId.get(pair.b);
      return keep && other ? { ...pair, keep, other } : null;
    })
    .filter((pair): pair is DuplicateSuggestion => pair !== null);
}

/** How many pairs are waiting — for the line above the contact list. */
export async function countDuplicates(db: SupabaseClient, userId: string): Promise<number> {
  return (await loadDuplicates(db, userId)).length;
}
