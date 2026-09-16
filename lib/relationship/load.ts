import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import { touchesByContact, type ContactAddress, type StoredMessage } from "@/lib/relationship/touches";
import { warmth, type Warmth } from "@/lib/relationship/warmth";
import { whoseTurn, type Turn } from "@/lib/relationship/whose-turn";

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

/**
 * Supabase answers at most 1,000 rows per request by default, and a mailbox
 * can hold more messages than that — so both queries are read page by page.
 */
const DEFAULT_PAGE_SIZE = 1_000;

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
      pageSize,
      (from, to) =>
        db
          .from("contact_emails")
          .select("contact_id, email")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contact addresses",
    ),
    readAll<StoredMessage>(
      pageSize,
      (from, to) =>
        db
          .from("gmail_messages")
          .select(MESSAGE_COLUMNS)
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load messages",
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

type PageResult = PromiseLike<{
  data: unknown[] | null;
  error: { message: string; code?: string | null } | null;
}>;

/** Reads rows `pageSize` at a time until a page comes back short. */
async function readAll<T>(
  pageSize: number,
  page: (from: number, to: number) => PageResult,
  whatFailed: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw supabaseError(error, whatFailed);

    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}
