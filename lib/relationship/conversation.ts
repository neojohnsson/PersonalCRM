import type { GmailThread } from "@/lib/google/gmail";

/**
 * The conversation on a contact's page (docs/slice-9b-plan.md, Part 4).
 *
 * The one screen about a person showed their warmth, an AI summary of what
 * they said, and a link to Gmail — and not one message. The first outside test
 * of the app put it plainly:
 *
 *   "The contact page shows stats, an AI summary, and a link to Gmail — and
 *    not one email. No sender, no date, no subject, no first line."
 *
 * What a row is made of, and where each part comes from:
 *
 *   who, when, which way   `gmail_messages`, stored since slice 1
 *   subject                `gmail_messages.subject`, stored since slice 2
 *   the first line         Gmail, read while you look at the page and never
 *                          written down (lib/google/gmail.ts)
 *
 * So the timeline is built from what is already stored, and the lines are
 * filled in from Gmail if Gmail answers. If it doesn't — expired token, Gmail
 * down, no permission — every row is still there with everything but the line.
 * That is why the merge is a separate, pure function: the failure case is the
 * normal case with one field missing, not a broken page.
 */

/** One stored message of a thread. Metadata only; the body was never stored. */
export type StoredMessage = {
  gmail_message_id: string;
  internal_date: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  from_name: string | null;
  from_email: string;
};

export type ConversationEntry = {
  id: string;
  at: Date;
  /** True when they wrote it, false when you did. */
  fromThem: boolean;
  /** Who wrote it, as a name if one was in the From header. */
  who: string;
  subject: string | null;
  /**
   * The first line Gmail shows for the message, or null when Gmail wasn't
   * asked or didn't answer. Never stored.
   */
  line: string | null;
};

/** At most this many rows; the rest of the thread stays in Gmail. */
export const CONVERSATION_ROWS = 8;

/**
 * The rows to show, newest first.
 *
 * `you` is what to call your own messages — the design has no avatar for them
 * and "You" is what the other cards say.
 */
export function conversation(
  stored: StoredMessage[],
  thread: GmailThread | null = null,
  you = "You",
): ConversationEntry[] {
  const lines = linesById(thread);

  return stored
    .map((message) => ({
      id: message.gmail_message_id,
      at: new Date(message.internal_date),
      fromThem: message.direction === "inbound",
      who: message.direction === "inbound" ? senderName(message) : you,
      subject: message.subject,
      line: lines.get(message.gmail_message_id) ?? null,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, CONVERSATION_ROWS);
}

/** Gmail's snippets by message id, tidied. */
function linesById(thread: GmailThread | null): Map<string, string> {
  const lines = new Map<string, string>();
  for (const message of thread?.messages ?? []) {
    const line = firstLine(message.snippet);
    if (line) lines.set(message.id, line);
  }
  return lines;
}

/**
 * A snippet, made fit to read. Gmail returns it HTML-escaped and on one line,
 * with the quoted reply and the signature often trailing after it.
 *
 * Cut at the marker a quoted reply starts with, so a two-word answer doesn't
 * show as the whole message it answered. Swedish and English, because that is
 * what this mailbox has: "On 11 Sep ... wrote:" and "Den 11 sep ... skrev:".
 */
export function firstLine(snippet: string | undefined, max = 160): string | null {
  if (!snippet) return null;

  const text = unescapeHtml(snippet)
    .replace(/\s+/g, " ")
    // English puts the name before the verb ("Neo Johnsson wrote:"),
    // Swedish after it ("skrev Neo Johnsson:"), and both carry a time with a
    // colon in it -- so the middle is a bounded lazy match, not [^:].
    .replace(/\s*(?:On|Den)\s+\d{1,2}[\s\S]{0,80}?(?:wrote|skrev)\b[^:]{0,80}:[\s\S]*$/i, "")
    .replace(/\s*(?:-{2,}|_{2,})\s*(?:Forwarded message|Vidarebefordrat meddelande).*$/i, "")
    .trim();

  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Gmail escapes snippets. Only the five that matter, and no HTML is rendered. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** The name on the message, or the address when the From header had none. */
function senderName(message: StoredMessage): string {
  const name = message.from_name?.trim();
  return name && name.length > 0 ? name : message.from_email;
}
