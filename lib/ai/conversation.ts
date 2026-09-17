import { messageText } from "@/lib/google/body";
import { GmailApiError, getMessageFull } from "@/lib/google/gmail";
import type { Touch } from "@/lib/relationship/touches";

/**
 * The text of your last messages with a contact, read from Gmail for one AI
 * request (docs/slice-4-plan.md, Part 1; decision B).
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
  from: "you" | "them";
  at: Date;
  subject: string | null;
  text: string;
};

/**
 * Reads the newest `limit` of `touches` from Gmail, oldest first in the
 * result. A message that's gone from Gmail (deleted since the sync) is left
 * out; any other Gmail failure stops the request.
 */
export async function readConversation(
  accessToken: string,
  touches: Touch[],
  limit = MESSAGES_PER_SUMMARY,
): Promise<ConversationMessage[]> {
  const newest = [...touches].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-limit);
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
  newest.forEach((touch, index) => {
    const text = texts[index];
    if (text === null) return;
    conversation.push({
      ref: `m${conversation.length + 1}`,
      messageId: touch.messageId,
      threadId: touch.threadId,
      from: touch.direction === "outbound" ? "you" : "them",
      at: touch.at,
      subject: touch.subject,
      text,
    });
  });

  return conversation;
}
