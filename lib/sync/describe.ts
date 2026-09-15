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
 * The line under the heading — design/Main.dc.html's "Last synced 4 minutes
 * ago · 312 messages · 18 new people".
 *
 * It says "people", not "new people": slice 1 has no idea who is new yet.
 * And it never hides a failure — a sync status that lies is plan.md §3.1's
 * example of what not to build.
 */
export function describeSync(
  sync: SyncSummary | null,
  peopleCount: number,
  now: Date = new Date(),
): SyncLine {
  if (!sync) return { tone: "idle", text: "Not synced yet" };

  const messages = countOf(sync.message_count, "message");
  const people = countOf(peopleCount, "person", "people");
  const lastSynced = sync.last_synced_at
    ? `Last synced ${timeAgo(sync.last_synced_at, now)}`
    : null;

  switch (sync.status) {
    case "backfilling":
      return { tone: "busy", text: `Syncing · ${messages} so far` };

    case "incremental":
      return { tone: "busy", text: `Checking for new mail · ${messages}` };

    case "synced":
      return {
        tone: "ok",
        text: `${lastSynced ?? "Synced"} · ${messages} · ${people}`,
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
        ? { tone: "ok", text: `${lastSynced} · ${messages} · ${people}` }
        : { tone: "idle", text: "Not synced yet" };
  }
}
