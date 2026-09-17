import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PART_CHARS,
  SUMMARY_COLUMNS,
  SUMMARY_PARTS,
  type SavedSummary,
  type SummaryPart,
} from "@/lib/ai/summary-parts";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * What a person does with a summary (docs/slice-4-plan.md, Part 4):
 *
 *   approve   the pending summary becomes the contact's summary
 *   discard   the pending summary is deleted
 *   edit      the approved summary changes to your words, marked as yours
 *
 * Regenerate is lib/ai/summary.ts's generateSummary: a new pending summary
 * beside the approved one, which it never touches.
 *
 * Every function takes the client and user id and filters by user_id itself;
 * RLS decides the rest.
 */

/** The summary doesn't exist, isn't in the state the action needs, or isn't the caller's. */
export class SummaryNotFound extends Error {
  constructor() {
    super("That summary isn't there any more.");
    this.name = "SummaryNotFound";
  }
}

/** The contact's approved summary and the pending one waiting beside it, either may be missing. */
export async function summariesFor(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<{ approved: SavedSummary | null; pending: SavedSummary | null }> {
  const { data, error } = await db
    .from("contact_summaries")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .returns<SavedSummary[]>();
  if (error) throw supabaseError(error, "Couldn't load the summary");

  return {
    approved: data.find((row) => row.status === "approved") ?? null,
    pending: data.find((row) => row.status === "pending") ?? null,
  };
}

export async function approveSummary(db: SupabaseClient, userId: string, summaryId: string): Promise<void> {
  const { error } = await db.rpc("approve_contact_summary", { p_user_id: userId, p_summary_id: summaryId });
  if (error?.code === "P0002") throw new SummaryNotFound();
  if (error) throw supabaseError(error, "Couldn't approve the summary");
}

/** Only a pending summary can be discarded; the approved one is changed by editing. */
export async function discardSummary(db: SupabaseClient, userId: string, summaryId: string): Promise<void> {
  const { data, error } = await db
    .from("contact_summaries")
    .delete()
    .eq("id", summaryId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't discard the summary");
  if (data.length === 0) throw new SummaryNotFound();
}

// ── Editing ─────────────────────────────────────────────────────────────────

export type SummaryParts = Record<SummaryPart, string | null>;
export type SummaryFormValues = Record<SummaryPart, string>;
export type SummaryFormErrors = Partial<Record<SummaryPart, string>>;

export type ParsedSummaryForm =
  | { ok: true; parts: SummaryParts }
  | { ok: false; errors: SummaryFormErrors; values: SummaryFormValues };

/** Reads the edit form: each part trimmed, empty means "nothing here". */
export function parseSummaryForm(formData: FormData): ParsedSummaryForm {
  const values = {} as SummaryFormValues;
  const parts = {} as SummaryParts;
  const errors: SummaryFormErrors = {};

  for (const part of SUMMARY_PARTS) {
    const raw = formData.get(part);
    values[part] = typeof raw === "string" ? raw : "";
    const text = values[part].replace(/\r\n?/g, "\n").trim();
    if (text.length > MAX_PART_CHARS) errors[part] = `Keep it under ${MAX_PART_CHARS.toLocaleString("en-GB")} characters.`;
    parts[part] = text || null;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors, values } : { ok: true, parts };
}

/**
 * Save your words over the approved summary and mark it edited. A part you
 * emptied loses its source links; the others keep theirs, so you can still
 * check where they came from. An edited summary is never replaced by the AI.
 */
export async function editSummary(
  db: SupabaseClient,
  userId: string,
  summaryId: string,
  parts: SummaryParts,
): Promise<SavedSummary> {
  const { data: current, error } = await db
    .from("contact_summaries")
    .select("sources")
    .eq("id", summaryId)
    .eq("user_id", userId)
    .eq("status", "approved")
    .maybeSingle<Pick<SavedSummary, "sources">>();
  if (error) throw supabaseError(error, "Couldn't load the summary");
  if (!current) throw new SummaryNotFound();

  const sources = Object.fromEntries(
    Object.entries(current.sources).filter(([part]) => parts[part as SummaryPart] !== null),
  );

  const { data, error: updateError } = await db
    .from("contact_summaries")
    .update({ ...parts, sources, edited: true, updated_at: new Date().toISOString() })
    .eq("id", summaryId)
    .eq("user_id", userId)
    .eq("status", "approved")
    .select(SUMMARY_COLUMNS)
    .returns<SavedSummary[]>();
  if (updateError) throw supabaseError(updateError, "Couldn't save the summary");
  if (data.length === 0) throw new SummaryNotFound();

  return data[0];
}
