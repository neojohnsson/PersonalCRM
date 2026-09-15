"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { runSyncStep, type SyncStepResult } from "@/lib/sync/run-sync-step";

/**
 * One step of the Gmail sync, for the "Sync now" button.
 *
 * A Server Action can be called by anyone who sends it a POST, not only by the
 * button (Next.js 16 docs, "Mutating data") — so it checks the user itself.
 * It runs with the signed-in client, so RLS applies to everything it touches.
 *
 * refresh() re-renders the page after each step, so the list and the status
 * line fill in while the sync is still going.
 */
export async function syncStep(): Promise<SyncStepResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const result = await runSyncStep(supabase, user.id, { lookbackDays: lookbackDays() });

  refresh();
  return result;
}
