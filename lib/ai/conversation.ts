import { messageText } from "@/lib/google/body";
import { GmailApiError, getMessageFull } from "@/lib/google/gmail";
import type { ThreadItem } from "@/lib/ai/thread";

/**
 * The text of a contact's recent messages, read from Gmail for one AI request
 * (docs/slice-4-plan.md, Part 1; docs/thread-context-plan.md, Part 1).
 *
 * It reads whatever messages it is handed — the whole thread, including anyone
 * else who wrote in it, each already labelled by lib/ai/thread.ts.
 *
 * This module has no database client and imports nothing that writes: the
 * text it returns can only live in the memory of the request that asked for
 * it. tests/conversation.test.ts checks that stays true.
 */

/** How many of the most recent messages one summary reads (decision B). */
export const MESSAGES_PER_SUMMARY = 20;

/** Gmail requests at once. Each costs 5 quota units; the sync's pacing isn't needed for 20. */
const CONCURRENCY = 4;

export type ConversationMessage = {
  /** "m1", "m2", … oldest first. The AI cites these; they map back to Gmail ids. */
  ref: string;
  messageId: string;
  threadId: string;
  from: "you" | "them" | "other";
  /** For "other": who wrote it — their name from the header, or their address. */
  who: string | null;
  /** Who it went to and who was copied (lib/ai/thread.ts). */
  to: string[];
  cc: string[];
  at: Date;
  subject: string | null;
  text: string;
};

/**
 * Reads the newest `limit` of `items` from Gmail, oldest first in the result.
 * A message that's gone from Gmail (deleted since the sync) is left out; any
 * other Gmail failure stops the request.
 */
export async function readConversation(
  accessToken: string,
  items: ThreadItem[],
  limit = MESSAGES_PER_SUMMARY,
): Promise<ConversationMessage[]> {
  const newest = [...items].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-limit);
  const texts: (string | null)[] = new Array(newest.length).fill(null);

  let next = 0;
  async function worker() {
    while (next < newest.length) {
      const index = next++;
      try {
        const message = await getMessageFull(accessToken, newest[index].messageId);
        texts[index] = messageText(message.payload);
      } catch (error) {
        if (error instanceof GmailApiError && error.status === 404) continue;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, newest.length) }, worker));

  const conversation: ConversationMessage[] = [];
  newest.forEach((item, index) => {
    const text = texts[index];
    if (text === null) return;
    conversation.push({
      ref: `m${conversation.length + 1}`,
      messageId: item.messageId,
      threadId: item.threadId,
      from: item.from,
      who: item.who,
      to: item.to,
      cc: item.cc,
      at: item.at,
      subject: item.subject,
      text,
    });
  });

  return conversation;
}
