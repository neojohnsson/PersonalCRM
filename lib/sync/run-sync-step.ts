import type { SupabaseClient } from "@supabase/supabase-js";

/** Every status a gmail_sync_state row can hold (0002's check constraint). */
export type SyncStatus =
  | "ready"
  | "backfilling"
  | "synced"
  | "incremental"
  | "needs_reconnect"
  | "error";

export type SyncStepResult = {
  /** Where the sync is after this step. `not_connected`: no Gmail connection. */
  status: SyncStatus | "not_connected";
  /** true when calling again now would do nothing useful. */
  done: boolean;
};

/**
 * One step of the Gmail sync. Placeholder — the tests in
 * tests/sync-step.test.ts describe what it has to do.
 */
export async function runSyncStep(
  db: SupabaseClient,
  userId: string,
  options: { lookbackDays: number },
): Promise<SyncStepResult> {
  void db;
  void userId;
  void options;
  throw new Error("runSyncStep is not built yet");
}
