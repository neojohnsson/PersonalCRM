import type { SupabaseClient } from "@supabase/supabase-js";
import { filterReason } from "@/lib/google/filter";
import { GmailApiError, getMessageMetadata, listMessageIds } from "@/lib/google/gmail";
import { toMessageRow, type MessageRow } from "@/lib/google/parse";
import { GmailReconnectRequired, getAccessToken } from "@/lib/google/tokens";

/**
 * After a dismissal is undone: read the mail that person sent back in from
 * Gmail.
 *
 * Why it's needed: dismissing deleted their messages from the database, and
 * the normal sync won't fetch them again — after the first backfill it only
 * asks Gmail for mail that's *new* since its bookmark. So this asks Gmail
 * directly for mail from that one address in the lookback window, and saves
 * it the same way the sync does:
 *
 *   - headers only (From, To, Cc, Subject, List-Unsubscribe) — never a body
 *   - the same filters: a no-reply or newsletter message still isn't stored
 *   - upsert on (user_id, gmail_message_id), so reading twice never duplicates
 *
 * Only mail *from* them: mail you sent them was never deleted.
 *
 * It must run after the dismissal row is gone. It doesn't check dismissals
 * itself — being called is the decision that this person's mail is wanted.
 *
 * Returns what happened:
 *   read            the mail was read; `stored` is how many messages were saved
 *   not_connected   no Gmail connection, so nothing to read
 *   needs_reconnect Google refused the stored key. Nothing read now; when the
 *                   user reconnects, the sync starts over from scratch and
 *                   reads this mail anyway (lib/sync/reconnect.ts)
 */

export type ReadBackResult =
  | { status: "read"; stored: number }
  | { status: "not_connected" }
  | { status: "needs_reconnect" };

/**
 * At most this many messages per click. Each costs 20 of Gmail's 6,000
 * per-minute quota units (lib/sync/pace.ts), so 100 is about a third of a
 * minute's budget — room left for a second click or a sync running alongside.
 * Newest first, so if someone sent more, the ones that decide whose turn it is
 * are the ones read.
 */
export const READ_BACK_LIMIT = 100;

const PARALLEL_FETCHES = 10;

/** Plain addresses only, so the address can't smuggle other search words into the query. */
const PLAIN_ADDRESS = /^[^\s"'()<>{}:@]+@[^\s"'()<>{}:@]+$/;

export async function readBackMailFrom(
  db: SupabaseClient,
  userId: string,
  address: string,
  options: { lookbackDays: number },
): Promise<ReadBackResult> {
  const email = address.trim().toLowerCase();
  if (!PLAIN_ADDRESS.test(email)) throw new Error("Not a plain email address");

  const { data: account, error: accountError } = await db
    .from("google_accounts")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) return { status: "not_connected" };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(db, userId);
  } catch (error) {
    if (error instanceof GmailReconnectRequired) return { status: "needs_reconnect" };
    throw error;
  }

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIds(accessToken, {
      lookbackDays: options.lookbackDays,
      search: `from:${email}`,
      pageToken,
      pageSize: READ_BACK_LIMIT - ids.length,
    });
    ids.push(...page.ids);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken && ids.length < READ_BACK_LIMIT);

  const rows: MessageRow[] = [];
  for (let i = 0; i < ids.length; i += PARALLEL_FETCHES) {
    const messages = await Promise.all(
      ids.slice(i, i + PARALLEL_FETCHES).map((id) =>
        getMessageMetadata(accessToken, id).catch((error: unknown) => {
          // Deleted in Gmail between listing and reading it: skip it.
          if (error instanceof GmailApiError && error.status === 404) return null;
          throw error;
        }),
      ),
    );

    for (const message of messages) {
      const row = message && toMessageRow(message, { userId, ownEmail: account.email });
      // Gmail's from: search is loose (it also matches names); keep only this
      // exact address, and only what the sync itself would have kept.
      if (row && row.from_email === email && filterReason(row) === null) rows.push(row);
    }
  }

  if (rows.length > 0) {
    const { error } = await db
      .from("gmail_messages")
      .upsert(rows, { onConflict: "user_id,gmail_message_id" });
    if (error) throw error;
  }

  return { status: "read", stored: rows.length };
}
