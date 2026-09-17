import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Taking a suggestion from a summary onto the contact, one field per click
 * (docs/slice-4-plan.md, Part 7).
 *
 * `expected` is what the page showed in that field when you clicked: the
 * update only happens if the field still holds exactly that. So a button that
 * said "Set as company" can't overwrite a company typed in another tab since,
 * and "Replace Fortnox AB" only ever replaces Fortnox AB.
 *
 * The next touch isn't here: its suggestion fills in the Next touch form,
 * and saving that form is the click (app/contacts/[id]/next-touch-card.tsx).
 */

export type SuggestedField = "company" | "role";

export type ApplyResult =
  /** The contact now has the suggested value. */
  | "applied"
  /** The field changed since the page was shown; nothing was written. */
  | "changed"
  /** No such summary, no suggestion for that field, or not the caller's. */
  | "not_found";

export async function applySuggestedField(
  db: SupabaseClient,
  userId: string,
  summaryId: string,
  field: SuggestedField,
  expected: string | null,
): Promise<ApplyResult> {
  const column = field === "company" ? "suggested_company" : "suggested_role";

  const { data: summary, error } = await db
    .from("contact_summaries")
    .select(`contact_id, ${column}`)
    .eq("id", summaryId)
    .eq("user_id", userId)
    .maybeSingle<{ contact_id: string } & Record<typeof column, string | null>>();
  if (error) throw supabaseError(error, "Couldn't load the suggestion");

  const suggested = summary?.[column];
  if (!summary || !suggested) return "not_found";

  let update = db
    .from("contacts")
    .update({ [field]: suggested, updated_at: new Date().toISOString() })
    .eq("id", summary.contact_id)
    .eq("user_id", userId);
  update = expected === null || expected === "" ? update.or(`${field}.is.null,${field}.eq.`) : update.eq(field, expected);

  const { data, error: updateError } = await update.select("id");
  if (updateError) throw supabaseError(updateError, "Couldn't update the contact");

  return data.length > 0 ? "applied" : "changed";
}
