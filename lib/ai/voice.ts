import type { SupabaseClient } from "@supabase/supabase-js";
import { messageText } from "@/lib/google/body";
import { GmailApiError, getMessageFull } from "@/lib/google/gmail";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * How you write, shown rather than described (docs/slice-5a-plan.md, Part 7).
 *
 * A model follows five real emails you wrote better than it follows the word
 * "friendly": it copies your sentence length, your greeting, whether you sign
 * off at all. So each draft is given a few of your own recent sent messages.
 *
 * Only your own mail — nothing a contact wrote — and never the thread being
 * answered, which the draft already has. Read for that one request and never
 * stored, like every other body the app reads.
 */

/** How many examples a draft gets. */
export const VOICE_SAMPLES = 5;

/** Too short to show a voice; too long to be worth the tokens. */
export const MIN_SAMPLE_CHARS = 120;
export const MAX_SAMPLE_CHARS = 1_200;

/** How many recent sent messages to consider before giving up. */
const CANDIDATE_ROWS = 40;

export type SentRow = { gmail_message_id: string; thread_id: string; internal_date: string };

/**
 * The messages worth fetching: newest first, one per thread, never the thread
 * being answered. One per thread so five examples aren't five replies in one
 * conversation.
 */
export function pickVoiceCandidates(
  rows: SentRow[],
  options: { excludeThreadId?: string; limit?: number } = {},
): SentRow[] {
  const limit = options.limit ?? VOICE_SAMPLES * 2;
  const seenThreads = new Set<string>();
  const picked: SentRow[] = [];

  for (const row of [...rows].sort((a, b) => (a.internal_date < b.internal_date ? 1 : -1))) {
    if (row.thread_id === options.excludeThreadId || seenThreads.has(row.thread_id)) continue;
    seenThreads.add(row.thread_id);
    picked.push(row);
    if (picked.length >= limit) break;
  }

  return picked;
}

/** Up to `VOICE_SAMPLES` of your own emails, oldest first, as plain text. */
export async function loadVoiceSamples(
  db: SupabaseClient,
  userId: string,
  accessToken: string,
  options: { excludeThreadId?: string; limit?: number } = {},
): Promise<string[]> {
  const limit = options.limit ?? VOICE_SAMPLES;

  const { data, error } = await db
    .from("gmail_messages")
    .select("gmail_message_id, thread_id, internal_date")
    .eq("user_id", userId)
    .eq("direction", "outbound")
    .order("internal_date", { ascending: false })
    .limit(CANDIDATE_ROWS)
    .returns<SentRow[]>();
  if (error) throw supabaseError(error, "Couldn't load your sent mail");

  const candidates = pickVoiceCandidates(data, { excludeThreadId: options.excludeThreadId, limit: limit * 2 });
  const samples: string[] = [];

  for (const candidate of candidates) {
    if (samples.length >= limit) break;
    try {
      const message = await getMessageFull(accessToken, candidate.gmail_message_id);
      const text = messageText(message.payload).trim();
      if (text.length >= MIN_SAMPLE_CHARS) samples.push(text.slice(0, MAX_SAMPLE_CHARS));
    } catch (failure) {
      // A message that's gone, or one Gmail won't give: examples are a nicety,
      // never a reason to fail a draft.
      if (!(failure instanceof GmailApiError)) throw failure;
    }
  }

  return samples.reverse();
}

/** The examples as the model reads them. */
export function voiceSectionText(samples: string[]): string | null {
  if (samples.length === 0) return null;
  return [
    "How the user writes — their own recent emails, for voice only. Copy the way they sound: greetings, sentence length, how formal they are, how they sign off. Never copy their content, and never mention these examples.",
    ...samples.map((sample, index) => `Example ${index + 1}:\n${sample}`),
  ].join("\n\n");
}
