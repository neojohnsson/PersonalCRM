/**
 * The shape of a saved summary — shared by the server code that makes and
 * changes summaries and the browser component that shows them. Only plain
 * values and types here: lib/ai/summary.ts imports server-only code (the
 * OpenAI key), and a client component must never pull that in.
 */

export const SUMMARY_PARTS = ["who_they_are", "how_you_know", "discussed", "next_step"] as const;
export type SummaryPart = (typeof SUMMARY_PARTS)[number];

/** What a summary can suggest for the contact itself (docs/slice-4-plan.md, Part 7). */
export const SUGGESTIONS = ["company", "role", "next_touch", "referral"] as const;
export type Suggestion = (typeof SUGGESTIONS)[number];

/** Longest text kept for one part — the database allows no more. */
export const MAX_PART_CHARS = 2_000;

/** The contact fields' limits (lib/contacts/contact-form.ts) and a next touch's reason (0009). */
export const MAX_SUGGESTED_FIELD_CHARS = 200;
export const MAX_SUGGESTED_REASON_CHARS = 300;

/** Where something came from: one email, or the contact's own address. */
export type SourceRef = { messageId: string; threadId: string } | { address: string };

export type SavedSummary = {
  id: string;
  contact_id: string;
  status: "pending" | "approved";
  who_they_are: string | null;
  how_you_know: string | null;
  discussed: string | null;
  next_step: string | null;
  sources: Partial<Record<SummaryPart | Suggestion, SourceRef[]>>;
  suggested_company: string | null;
  suggested_role: string | null;
  suggested_touch_reason: string | null;
  /** YYYY-MM-DD, from the timing rules (lib/relationship/touch-date.ts). */
  suggested_touch_on: string | null;
  /** The AI's one sentence on why that timing. */
  suggested_touch_why: string | null;
  /** The date is only a rough guess: "pick a better date". */
  suggested_touch_rough: boolean;
  /** Someone the contact referred you to, checked against your mail on the page. */
  suggested_referral_name: string | null;
  suggested_referral_email: string | null;
  /** When the email with the referral was sent. */
  suggested_referral_since: string | null;
  as_of: string;
  edited: boolean;
  model: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

export const SUMMARY_COLUMNS =
  "id, contact_id, status, who_they_are, how_you_know, discussed, next_step, sources, suggested_company, suggested_role, suggested_touch_reason, suggested_touch_on, suggested_touch_why, suggested_touch_rough, suggested_referral_name, suggested_referral_email, suggested_referral_since, as_of, edited, model, created_at, updated_at, approved_at";
