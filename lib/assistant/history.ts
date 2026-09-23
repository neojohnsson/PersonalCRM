import type { Said } from "./converse";

/**
 * The conversation the page sends back each turn, checked (slice 11).
 *
 * The browser keeps the conversation — nothing about it is stored on the
 * server — so every word of it arrives as untrusted input. Anything that could
 * not have come from the page is refused whole:
 *
 *   - only "user" and "assistant". A page that could send "system" or
 *     "developer" could rewrite the Assistant's instructions
 *   - at most 40 messages of 4,000 characters each
 *   - the last message must be yours: a turn answers you
 */

export const MAX_MESSAGES = 40;
export const MAX_CHARS = 4_000;

/** The conversation, or null if it could not have come from the page. */
export function parseHistory(body: unknown): Said[] | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;

  const history: Said[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") return null;
    const { role, text } = message as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_CHARS) return null;
    history.push({ role, text });
  }
  return history[history.length - 1].role === "user" ? history : null;
}
