/**
 * The shape of a saved summary — shared by the server code that makes and
 * changes summaries and the browser component that shows them. Only plain
 * values and types here: lib/ai/summary.ts imports server-only code (the
 * OpenAI key), and a client component must never pull that in.
 */

export const SUMMARY_PARTS = ["who_they_are", "how_you_know", "discussed", "next_step"] as const;
export type SummaryPart = (typeof SUMMARY_PARTS)[number];

/** Longest text kept for one part — the database allows no more. */
export const MAX_PART_CHARS = 2_000;

export type SourceRef = { messageId: string; threadId: string };

export type SavedSummary = {
  id: string;
  contact_id: string;
  status: "pending" | "approved";
  who_they_are: string | null;
  how_you_know: string | null;
  discussed: string | null;
  next_step: string | null;
  sources: Partial<Record<SummaryPart, SourceRef[]>>;
  as_of: string;
  edited: boolean;
  model: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

export const SUMMARY_COLUMNS =
  "id, contact_id, status, who_they_are, how_you_know, discussed, next_step, sources, as_of, edited, model, created_at, updated_at, approved_at";
