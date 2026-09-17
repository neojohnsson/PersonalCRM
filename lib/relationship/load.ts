import type { SupabaseClient } from "@supabase/supabase-js";
import { touchesByContact, type ContactAddress, type StoredMessage, type Touch } from "@/lib/relationship/touches";
import { warmth, type Warmth } from "@/lib/relationship/warmth";
import { whoseTurn, type Turn } from "@/lib/relationship/whose-turn";
import { supabaseError } from "@/lib/supabase/errors";
import { DEFAULT_PAGE_SIZE, readAll } from "@/lib/supabase/read-all";

/**
 * Whose turn and warmth for every one of a user's contacts, from two queries:
 * their contact addresses and their stored message headers
 * (docs/slice-3-plan.md, step 3).
 *
 * The calculations run here, on the server, rather than once per contact in
 * the database: one pass over a few thousand small rows, with the rules living
 * in tested TypeScript (lib/relationship/whose-turn.ts and warmth.ts).
 *
 * Takes the client and user id, like the sync, and filters by user_id itself.
 */

export type Relationship = {
  turn: Turn;
  warmth: Warmth | null;
  messageCount: number;
};

/** For a contact with no stored mail at all. */
export const NO_MAIL: Relationship = { turn: { kind: "none" }, warmth: null, messageCount: 0 };

const MESSAGE_COLUMNS =
  "gmail_message_id, thread_id, direction, internal_date, from_email, to_emails, cc_emails, subject";

export async function loadRelationships(
  db: SupabaseClient,
  userId: string,
  options: { now?: Date; pageSize?: number } = {},
): Promise<Map<string, Relationship>> {
  const now = options.now ?? new Date();
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const [addresses, messages] = await Promise.all([
    readAll<ContactAddress>(
      (from, to) =>
        db
          .from("contact_emails")
          .select("contact_id, email")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contact addresses",
      pageSize,
    ),
    readAll<StoredMessage>(
      (from, to) =>
        db
          .from("gmail_messages")
          .select(MESSAGE_COLUMNS)
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load messages",
      pageSize,
    ),
  ]);

  const relationships = new Map<string, Relationship>();
  for (const [contactId, touches] of touchesByContact(messages, addresses)) {
    relationships.set(contactId, {
      turn: whoseTurn(touches, now),
      warmth: warmth(touches, now),
      messageCount: touches.length,
    });
  }

  return relationships;
}

/**
 * The same, for one contact — for their own page, where loading every message
 * in the mailbox would be wasted work. The database hands back only mail from
 * or to one of their addresses; the rules that decide whether it's a touch
 * are still touchesByContact's, so the answer is the same as in the list.
 *
 * Addresses are stored lowercased on both sides (lib/google/parse.ts,
 * lib/contacts/contact-form.ts), so exact matching finds them all.
 */
export async function loadRelationship(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  options: { now?: Date; pageSize?: number } = {},
): Promise<Relationship> {
  const now = options.now ?? new Date();
  const touches = await contactTouches(db, userId, contactId, options);
  if (!touches) return NO_MAIL;

  return { turn: whoseTurn(touches, now), warmth: warmth(touches, now), messageCount: touches.length };
}

/**
 * Every touch with one contact, oldest first — null if there are none. Used
 * by loadRelationship, and by the AI summary to pick which messages to read.
 */
export async function contactTouches(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  options: { pageSize?: number } = {},
): Promise<Touch[] | null> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const { data: addresses, error } = await db
    .from("contact_emails")
    .select("contact_id, email")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .returns<ContactAddress[]>();
  if (error) throw supabaseError(error, "Couldn't load the contact's addresses");
  if (addresses.length === 0) return null;

  const list = postgrestList(addresses.map((address) => address.email));
  const messages = await readAll<StoredMessage>(
    (from, to) =>
      db
        .from("gmail_messages")
        .select(MESSAGE_COLUMNS)
        .eq("user_id", userId)
        .or(`from_email.in.(${list}),to_emails.ov.{${list}},cc_emails.ov.{${list}}`)
        .order("id")
        .range(from, to),
    "Couldn't load the contact's messages",
    pageSize,
  );

  return touchesByContact(messages, addresses).get(contactId) ?? null;
}

/**
 * Values for a PostgREST filter list, each in double quotes so a comma, brace
 * or bracket inside an address can't end the list early.
 */
function postgrestList(values: string[]): string {
  return values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
}
