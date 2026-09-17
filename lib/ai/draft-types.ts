import { TONES, type Tone } from "@/lib/profile/profile";

/**
 * A draft reply as it's stored and shown (migration 0014). Plain types only:
 * the draft panel runs in the browser, and lib/ai/draft.ts imports
 * server-only code.
 */

export { TONES };
export type { Tone };

/** Longest draft body the database takes. */
export const MAX_BODY_CHARS = 20_000;

export type SavedDraft = {
  id: string;
  contact_id: string;
  thread_id: string;
  status: "pending" | "saved";
  subject: string | null;
  /** The text — only while pending. Once it's in Gmail, Gmail holds it. */
  body: string | null;
  /** The language the model answered in, as it named it ("Swedish"). */
  language: string | null;
  tone: Tone;
  gmail_draft_id: string | null;
  model: string;
  created_at: string;
  updated_at: string;
  saved_at: string | null;
};

export const DRAFT_COLUMNS =
  "id, contact_id, thread_id, status, subject, body, language, tone, gmail_draft_id, model, created_at, updated_at, saved_at";

/**
 * The phrases from your "never write" list that the draft used anyway. The
 * model is told to avoid them; this is what the panel shows when it didn't.
 */
export function neverWriteHits(body: string, neverWrite: string[]): string[] {
  const text = body.toLowerCase();
  return neverWrite.filter((phrase) => phrase.trim() && text.includes(phrase.trim().toLowerCase()));
}
