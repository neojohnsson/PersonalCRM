import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * After the user reconnects Gmail, let a stuck sync run again.
 *
 * runSyncStep parks the sync in `needs_reconnect` when Google says the stored
 * key is dead, and does nothing in that state — retrying a dead key can never
 * work. The OAuth callback calls this once a fresh key is saved, so the next
 * step starts over from `ready` with a new bookmark.
 *
 * Only `needs_reconnect` is touched. A sync that's mid-backfill, synced or in
 * `error` keeps its place: reconnecting doesn't change what it was doing.
 */
export async function resetSyncAfterReconnect(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await db
    .from("gmail_sync_state")
    .update({
      status: "ready",
      page_token: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "needs_reconnect");

  if (error) throw error;
}
