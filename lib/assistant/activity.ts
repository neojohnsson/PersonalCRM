import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import type { ActionKind } from "./act";

/**
 * What the Assistant did on its own, newest first (docs/slice-11-plan.md §3):
 * the strip on /assistant shows the latest, /assistant/activity shows them all.
 *
 * Read from assistant_actions under RLS, so it is only ever your own. Not the
 * before and after values: the page shows the sentence written when it
 * happened ("Added a note to Karin Lindqvist"), and Undo reads the before
 * value itself, on the server, when you press it (lib/assistant/act.ts).
 */

export type ActivityRow = {
  id: string;
  kind: ActionKind;
  summary: string;
  contactId: string;
  createdAt: string;
  undoneAt: string | null;
};

/** How many /assistant/activity shows. It says so when there are more. */
export const ACTIVITY_LIMIT = 100;

export async function recentActions(
  db: SupabaseClient,
  userId: string,
  limit = ACTIVITY_LIMIT,
): Promise<ActivityRow[]> {
  const { data, error } = await db
    .from("assistant_actions")
    .select("id, kind, summary, contact_id, created_at, undone_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw supabaseError(error, "Couldn't load what the Assistant did");

  return data.map((row) => ({
    id: row.id as string,
    kind: row.kind as ActionKind,
    summary: row.summary as string,
    contactId: row.contact_id as string,
    createdAt: row.created_at as string,
    undoneAt: (row.undone_at as string | null) ?? null,
  }));
}
