import { countOf, timeAgo } from "@/lib/format";
import type { SyncStatus } from "@/lib/sync/run-sync-step";

/** The gmail_sync_state columns the status line reads. */
export type SyncSummary = {
  status: SyncStatus;
  message_count: number;
  last_synced_at: string | null;
  last_error: string | null;
};

export type SyncLine = {
  /** ok: green dot · busy: blue · problem: orange · idle: grey. */
  tone: "ok" | "busy" | "problem" | "idle";
  text: string;
};

/**
 * The line under the page's top row — design/Main.dc.html's "Last synced 4
 * minutes ago · 312 messages · 18 new people".
 *
 * It counts contacts, not "new people": that's what the list below it shows,
 * and nothing yet knows who is new. And it never hides a failure — a sync
 * status that lies is plan.md §3.1's example of what not to build.
 */
export function describeSync(
  sync: SyncSummary | null,
  contactCount: number,
  now: Date = new Date(),
): SyncLine {
  if (!sync) return { tone: "idle", text: "Not synced yet" };

  const messages = countOf(sync.message_count, "message");
  const contacts = countOf(contactCount, "contact");
  const lastSynced = sync.last_synced_at
    ? `Last synced ${timeAgo(sync.last_synced_at, now)}`
    : null;

  switch (sync.status) {
    case "backfilling":
      // "Keep this tab open": the Sync now button drives the backfill from the
      // browser, so closing the tab pauses it. Goes once the sync is scheduled.
      return { tone: "busy", text: `Syncing · ${messages} so far · keep this tab open` };

    case "incremental":
      return { tone: "busy", text: `Checking for new mail · ${messages}` };

    case "synced":
      return {
        tone: "ok",
        text: `${lastSynced ?? "Synced"} · ${messages} · ${contacts}`,
      };

    case "needs_reconnect":
      return { tone: "problem", text: "Gmail access expired — reconnect to keep syncing" };

    case "error":
      return {
        tone: "problem",
        text: `Last sync failed: ${sync.last_error ?? "unknown error"}`,
      };

    case "ready":
      return lastSynced
        ? { tone: "ok", text: `${lastSynced} · ${messages} · ${contacts}` }
        : { tone: "idle", text: "Not synced yet" };
  }
}
