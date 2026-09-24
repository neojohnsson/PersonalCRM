import type { InputItem } from "@/lib/ai/openai-tools";
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

/** How much working memory a paused turn may hand back: steps, not a novel. */
export const MAX_RESUME_ITEMS = 300;
export const MAX_RESUME_BYTES = 600_000;

/** The item kinds a turn's working memory is made of, and nothing else. */
const TOOL_ITEMS = new Set(["function_call", "function_call_output", "reasoning"]);

/**
 * A paused turn's working memory, sent back with Carry on (2026-09-24), or
 * null when there is none. It came from this server a moment ago, but it
 * arrives from the browser, so it is checked as strictly as the conversation:
 *
 *   - only what a turn is made of: your words and its answers (roles "user"
 *     and "assistant"), its tool calls and their results, its reasoning.
 *     Never "system" or "developer" -- the same rule as parseHistory, for the
 *     same reason
 *   - at most 300 items and 600 kB
 *
 * Returns undefined when the body carries something that is not that: the
 * route refuses the request whole.
 */
export function parseResume(body: unknown): InputItem[] | null | undefined {
  if (!body || typeof body !== "object") return null;
  const resume = (body as { resume?: unknown }).resume;
  if (resume === undefined || resume === null) return null;
  if (!Array.isArray(resume) || resume.length === 0 || resume.length > MAX_RESUME_ITEMS) return undefined;
  if (JSON.stringify(resume).length > MAX_RESUME_BYTES) return undefined;

  for (const item of resume) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const { type, role } = item as { type?: unknown; role?: unknown };
    if (role !== undefined) {
      if (role !== "user" && role !== "assistant") return undefined;
      if (type !== undefined && type !== "message") return undefined;
    } else if (typeof type !== "string" || !TOOL_ITEMS.has(type)) {
      return undefined;
    }
  }
  return resume as InputItem[];
}
