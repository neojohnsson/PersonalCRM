import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailApiError, getThreadMetadata, type GmailThread } from "@/lib/google/gmail";
import { GmailReconnectRequired, getAccessToken } from "@/lib/google/tokens";

/**
 * The first lines of a thread, read from Gmail while you look at a contact
 * (slice 9b, Part 4).
 *
 * It never throws. A contact page must not break because Gmail is down, a
 * token expired, or the connection was removed in another tab — the
 * conversation is still worth showing with everything but the lines
 * (lib/relationship/conversation.ts builds it either way).
 *
 * Nothing here is stored. The snippets live for the length of one render, the
 * same rule the promise scan and the calendar's titles follow
 * (docs/privacy.md).
 */
export type ThreadRead = { thread: GmailThread; error: null } | { thread: null; error: string };

export async function readThreadLines(
  db: SupabaseClient,
  userId: string,
  threadId: string,
): Promise<ThreadRead> {
  try {
    const accessToken = await getAccessToken(db, userId);
    return { thread: await getThreadMetadata(accessToken, threadId), error: null };
  } catch (error) {
    // Logged for the server, and said on the page in one quiet line -- rows
    // with no lines and no reason is the kind of silence that cost slice 8b a
    // day of debugging (the calendar read failed and swallowed its own error).
    console.error("[conversation] couldn't read the thread from Gmail", error);
    return { thread: null, error: why(error) };
  }
}

/** The reason, in words, and never the message text. */
function why(error: unknown): string {
  if (error instanceof GmailReconnectRequired) return "Gmail access has expired — reconnect Gmail to see the lines.";
  if (error instanceof GmailApiError) return `Gmail couldn't be reached (HTTP ${error.status}).`;
  if (error instanceof Error && error.message.includes("No Gmail connection")) {
    return "Gmail isn't connected, so there are no lines to read.";
  }
  return "Gmail couldn't be read just now.";
}
