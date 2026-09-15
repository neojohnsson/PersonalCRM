import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GmailApiError,
  GmailHistoryTooOld,
  GmailRateLimited,
  getMailboxHistoryId,
  getMessageMetadata,
  listAddedSince,
  listMessageIds,
} from "@/lib/google/gmail";
import { toMessageRow } from "@/lib/google/parse";
import { GmailReconnectRequired, getAccessToken } from "@/lib/google/tokens";
import { GMAIL_UNITS, RATE_LIMIT_WAIT_MS, waitAfter } from "@/lib/sync/pace";

/**
 * The Gmail sync, one small step per call.
 *
 * Why steps: 90 days of mail can be thousands of messages, and Vercel stops a
 * request that runs too long. So each call does one page of work, saves where
 * it got to in gmail_sync_state, and returns. Whoever calls it — the "Sync
 * now" button today, a schedule later — calls again until `done`, waiting
 * `waitMs` in between so the sync stays inside Gmail's per-user quota.
 *
 *   status at start        this step                          status after
 *   ─────────────────────  ─────────────────────────────────  ───────────────────────
 *   (no row)               create the row                     ready
 *   ready, error           save Gmail's current bookmark      backfilling
 *   backfilling            one page of the last N days        backfilling │ synced
 *   synced, incremental    one page of mail since bookmark    incremental │ synced
 *   needs_reconnect        nothing — the user must reconnect  needs_reconnect
 *
 * Built for a schedule (slice-1-plan.md): it takes the database client and
 * user id as arguments and never reads a session or cookie. Every query also
 * filters by user_id itself, so it stays correct with a secret-key client
 * that bypasses RLS.
 */

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
  /** How long to wait before the next step. 0 when done. */
  waitMs: number;
};

type SyncState = {
  status: SyncStatus;
  history_id: string | null;
  page_token: string | null;
};

type Context = {
  db: SupabaseClient;
  userId: string;
  ownEmail: string;
  lookbackDays: number;
};

/**
 * Messages per step. Each costs 20 quota units to read, so a page of 50 is
 * about 1,000 units — roughly 12 seconds of Gmail's per-user budget.
 */
const PAGE_SIZE = 50;

/** How many messages' headers to fetch from Gmail at the same time. */
const PARALLEL_FETCHES = 10;

export async function runSyncStep(
  db: SupabaseClient,
  userId: string,
  options: { lookbackDays: number },
): Promise<SyncStepResult> {
  // No Gmail connection: nothing to sync, and no state worth creating.
  const { data: account, error: accountError } = await db
    .from("google_accounts")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) return { status: "not_connected", done: true, waitMs: 0 };

  const { data: state, error: stateError } = await db
    .from("gmail_sync_state")
    .select("status, history_id, page_token")
    .eq("user_id", userId)
    .maybeSingle<SyncState>();
  if (stateError) throw stateError;

  if (!state) {
    const { error } = await db
      .from("gmail_sync_state")
      .insert({ user_id: userId, status: "ready" });
    // 23505 = unique violation: another tab created the row first. Fine.
    if (error && error.code !== "23505") throw error;
    return result("ready");
  }

  if (state.status === "needs_reconnect") return result("needs_reconnect");

  const context: Context = {
    db,
    userId,
    ownEmail: account.email,
    lookbackDays: options.lookbackDays,
  };

  try {
    switch (state.status) {
      case "ready":
      case "error":
        return await startBackfill(context, state);
      case "backfilling":
        return await backfillPage(context, state);
      case "synced":
      case "incremental":
        return await incrementalPage(context, state);
    }
  } catch (error) {
    return await recordFailure(context, state, error);
  }
}

/**
 * Save Gmail's bookmark *before* reading any mail. Anything that arrives
 * during a long backfill is then after the bookmark, so the next incremental
 * sync picks it up instead of it falling in the gap.
 *
 * Also the retry path from `error`: it starts the backfill over. Messages are
 * upserted, so re-reading ones already saved costs time but never duplicates.
 */
async function startBackfill(context: Context, state: SyncState): Promise<SyncStepResult> {
  const accessToken = await getAccessToken(context.db, context.userId);
  const historyId = await getMailboxHistoryId(accessToken);

  return saveIfUnchanged(
    context,
    state,
    { status: "backfilling", history_id: historyId, page_token: null, last_error: null },
    GMAIL_UNITS.getProfile,
  );
}

/** One page of the last N days of mail. */
async function backfillPage(context: Context, state: SyncState): Promise<SyncStepResult> {
  const accessToken = await getAccessToken(context.db, context.userId);
  const page = await listMessageIds(accessToken, {
    lookbackDays: context.lookbackDays,
    pageToken: state.page_token ?? undefined,
    pageSize: PAGE_SIZE,
  });

  const messageCount = await saveMessages(context, accessToken, page.ids);
  const units = GMAIL_UNITS.messagesList + page.ids.length * GMAIL_UNITS.messagesGet;

  if (page.nextPageToken) {
    return saveIfUnchanged(
      context,
      state,
      { page_token: page.nextPageToken, message_count: messageCount },
      units,
    );
  }

  return saveIfUnchanged(
    context,
    state,
    {
      status: "synced",
      page_token: null,
      message_count: messageCount,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    },
    units,
  );
}

/**
 * One page of mail added since the bookmark.
 *
 * The bookmark only moves once the last page is read. If a step fails
 * halfway, the next attempt re-reads from the old bookmark — possibly
 * re-reading some mail, never skipping any.
 */
async function incrementalPage(context: Context, state: SyncState): Promise<SyncStepResult> {
  if (!state.history_id) {
    // Synced with no bookmark shouldn't happen; if it does, start over.
    return saveIfUnchanged(context, state, { status: "ready", page_token: null }, 0);
  }

  const accessToken = await getAccessToken(context.db, context.userId);
  const page = await listAddedSince(accessToken, {
    startHistoryId: state.history_id,
    pageToken: state.page_token ?? undefined,
    pageSize: PAGE_SIZE,
  });

  const messageCount = await saveMessages(context, accessToken, page.ids);
  const units = GMAIL_UNITS.historyList + page.ids.length * GMAIL_UNITS.messagesGet;

  if (page.nextPageToken) {
    return saveIfUnchanged(
      context,
      state,
      { status: "incremental", page_token: page.nextPageToken, message_count: messageCount },
      units,
    );
  }

  return saveIfUnchanged(
    context,
    state,
    {
      status: "synced",
      history_id: page.historyId,
      page_token: null,
      message_count: messageCount,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    },
    units,
  );
}

/**
 * Fetch each message's headers, turn them into rows, and upsert them.
 * Returns how many messages the user has stored in total.
 *
 * Upsert on (user_id, gmail_message_id) is what makes every step safe to
 * repeat: saving a message twice updates it instead of adding a copy.
 */
async function saveMessages(
  context: Context,
  accessToken: string,
  ids: string[],
): Promise<number> {
  const rows = [];

  for (let i = 0; i < ids.length; i += PARALLEL_FETCHES) {
    const batch = ids.slice(i, i + PARALLEL_FETCHES);
    const messages = await Promise.all(
      batch.map((id) =>
        getMessageMetadata(accessToken, id).catch((error: unknown) => {
          // Deleted in Gmail between listing and reading it: skip it.
          if (error instanceof GmailApiError && error.status === 404) return null;
          throw error;
        }),
      ),
    );

    for (const message of messages) {
      const row = message && toMessageRow(message, {
        userId: context.userId,
        ownEmail: context.ownEmail,
      });
      if (row) rows.push(row);
    }
  }

  if (rows.length > 0) {
    const { error } = await context.db
      .from("gmail_messages")
      .upsert(rows, { onConflict: "user_id,gmail_message_id" });
    if (error) throw error;
  }

  const { count, error } = await context.db
    .from("gmail_messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", context.userId);
  if (error) throw error;

  return count ?? 0;
}

/**
 * Save the step's result — but only if the row still looks the way it did
 * when this step read it (same status, same page token).
 *
 * This is how two tabs pressing "Sync now" at once stay correct. Both read
 * "backfilling, page 1" and both save page 1's messages (harmless: upsert).
 * The first to finish moves the row to page 2. The second's save then matches
 * no row — the page token is no longer what it read — so it changes nothing
 * and reports where the sync actually is. No page is skipped or done twice
 * over in the saved state.
 *
 * `units` is what the step spent on Gmail's quota, whoever won the save: it
 * decides how long the caller waits before the next step.
 */
async function saveIfUnchanged(
  context: Context,
  readState: SyncState,
  changes: Record<string, unknown>,
  units: number,
): Promise<SyncStepResult> {
  let update = context.db
    .from("gmail_sync_state")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("user_id", context.userId)
    .eq("status", readState.status);

  update =
    readState.page_token === null
      ? update.is("page_token", null)
      : update.eq("page_token", readState.page_token);

  const { data, error } = await update.select("status");
  if (error) throw error;

  if (data.length === 0) {
    // Another step got there first. Report what it left behind.
    return result(await currentStatus(context), units);
  }

  return result(data[0].status as SyncStatus, units);
}

async function currentStatus(context: Context): Promise<SyncStatus> {
  const { data, error } = await context.db
    .from("gmail_sync_state")
    .select("status")
    .eq("user_id", context.userId)
    .maybeSingle<{ status: SyncStatus }>();
  if (error) throw error;

  return data?.status ?? "ready";
}

/**
 * Turn a failed step into a status the UI can show.
 *
 *   Gmail rate limit      → no change, wait a minute  (nothing is wrong)
 *   dead Gmail key        → needs_reconnect           (retrying can never work)
 *   bookmark too old      → ready                     (start over with a new bookmark)
 *   anything else         → error                     (shown, retry allowed)
 */
async function recordFailure(
  context: Context,
  state: SyncState,
  error: unknown,
): Promise<SyncStepResult> {
  if (error instanceof GmailRateLimited) {
    // Keep the place: nothing is saved, so the same page is tried again.
    return { status: state.status, done: false, waitMs: RATE_LIMIT_WAIT_MS };
  }

  if (error instanceof GmailReconnectRequired) {
    return saveIfUnchanged(
      context,
      state,
      { status: "needs_reconnect", last_error: error.message },
      0,
    );
  }

  if (error instanceof GmailHistoryTooOld) {
    return saveIfUnchanged(context, state, { status: "ready", page_token: null }, 0);
  }

  return saveIfUnchanged(context, state, { status: "error", last_error: describe(error) }, 0);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function result(status: SyncStatus, units = 0): SyncStepResult {
  const done = status === "synced" || status === "needs_reconnect" || status === "error";
  return { status, done, waitMs: done ? 0 : waitAfter(units) };
}
