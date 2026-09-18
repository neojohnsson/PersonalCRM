"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The duplicates page's two buttons (docs/slice-6a-plan.md, Part 3).
 *
 * Merging is destructive and can't be undone, so it happens only here, from a
 * button a person pressed having seen both records. Like every Server Action,
 * each checks the user itself; migration 0017's function runs as them, so RLS
 * decides which contacts they may touch at all.
 */

export type MergeState = { error: string | null } | null;

/** "Keep this one": fold the other contact into it. */
export async function mergeContactsAction(
  keepId: string,
  mergeId: string,
  previous: MergeState,
): Promise<MergeState> {
  void previous;
  const user = await requireUser();
  if (!isUuid(keepId) || !isUuid(mergeId)) notFound();

  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_contacts", {
    p_user_id: user.id,
    p_keep_id: keepId,
    p_merge_id: mergeId,
  });

  if (error) {
    // Gone, already merged in another tab, or never theirs: the same answer.
    if (error.code === "P0002") return { error: "One of those contacts isn't there any more." };
    if (error.code === "22023") return { error: "That's the same contact twice." };
    throw supabaseError(error, "Couldn't merge the contacts");
  }

  refresh();
  return { error: null };
}

/** "Not the same person": remember it, so the pair stops being suggested. */
export async function dismissPairAction(a: string, b: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(a) || !isUuid(b) || a === b) notFound();

  // Stored smallest id first, so the answer holds whichever way round it comes.
  const [first, second] = [a, b].sort();
  const supabase = await createClient();
  const { error } = await supabase
    .from("duplicate_dismissals")
    .upsert(
      { user_id: user.id, contact_a: first, contact_b: second },
      { onConflict: "user_id,contact_a,contact_b" },
    );
  // A contact that has since gone takes its dismissals with it; nothing to do.
  if (error && error.code !== "23503") throw supabaseError(error, "Couldn't dismiss the pair");

  refresh();
}
