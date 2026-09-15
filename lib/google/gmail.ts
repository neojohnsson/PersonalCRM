/**
 * The four Gmail API requests the sync needs, as plain `fetch`
 * (decisions.md: no googleapis package — every request visible).
 *
 * Every function takes an access token, not a user. Getting a token is
 * lib/google/tokens.ts's job; keeping it out of here means these can be
 * tested with a fake fetch and no database.
 *
 * Checked against Google's reference, 2026-09-15:
 *   - messages.list and history.list: maxResults defaults to 100, max 500
 *   - spam and trash are left out of messages.list unless asked for
 *   - history.list answers HTTP 404 when startHistoryId is too old, and the
 *     client must then do a full sync
 *
 * Server-side only in practice: an access token is a live key to a mailbox.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The only headers the sync asks for. No body, no subject (decision 4). */
export const METADATA_HEADERS = ["From", "To", "Cc", "List-Unsubscribe"] as const;

export type GmailHeader = { name: string; value: string };

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  /** Epoch milliseconds, as a string. */
  internalDate: string;
  payload?: { headers?: GmailHeader[] };
};

export type IdPage = {
  ids: string[];
  /** null on the last page. */
  nextPageToken: string | null;
};

export type HistoryPage = IdPage & {
  /** The mailbox's bookmark now. Store it once the last page is read. */
  historyId: string;
};

/** Gmail answered with an error status. `status` tells the sync what kind. */
export class GmailApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

/**
 * The stored history_id is older than Gmail keeps history for (typically at
 * least a week). An incremental sync is impossible; start over with a backfill.
 */
export class GmailHistoryTooOld extends Error {
  constructor() {
    super("Gmail no longer has history for this bookmark; a full sync is needed.");
    this.name = "GmailHistoryTooOld";
  }
}

async function gmailGet<T>(
  accessToken: string,
  path: string,
  params: URLSearchParams,
): Promise<T> {
  const query = params.toString();
  const response = await fetch(`${GMAIL_API}${path}${query ? `?${query}` : ""}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new GmailApiError(
      response.status,
      `Gmail ${path} failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * The mailbox's current history bookmark.
 *
 * Saved *before* a backfill starts, so mail that arrives during a long
 * backfill is picked up by the next incremental sync.
 */
export async function getMailboxHistoryId(accessToken: string): Promise<string> {
  const profile = await gmailGet<{ historyId: string }>(
    accessToken,
    "/profile",
    new URLSearchParams(),
  );

  return profile.historyId;
}

/**
 * One page of message ids from the last `lookbackDays` days.
 *
 * `newer_than:90d` rather than `after:<date>`: it's Gmail's documented
 * relative form, so there's no date arithmetic or timezone to get wrong.
 */
export async function listMessageIds(
  accessToken: string,
  options: { lookbackDays: number; pageToken?: string; pageSize?: number },
): Promise<IdPage> {
  const params = new URLSearchParams({
    q: `newer_than:${options.lookbackDays}d`,
    maxResults: String(options.pageSize ?? 100),
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const body = await gmailGet<{
    messages?: { id: string }[];
    nextPageToken?: string;
  }>(accessToken, "/messages", params);

  // An empty mailbox answers with no `messages` field at all.
  return {
    ids: (body.messages ?? []).map((message) => message.id),
    nextPageToken: body.nextPageToken ?? null,
  };
}

/** One message's headers: format=metadata, limited to METADATA_HEADERS. */
export async function getMessageMetadata(
  accessToken: string,
  id: string,
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of METADATA_HEADERS) {
    params.append("metadataHeaders", header);
  }

  return gmailGet<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(id)}`,
    params,
  );
}

type HistoryResponse = {
  history?: { messagesAdded?: { message: { id: string } }[] }[];
  nextPageToken?: string;
  historyId: string;
};

/**
 * One page of messages added since `startHistoryId`.
 *
 * Only messageAdded. Deletions and label changes don't change who you've
 * talked to, so Slice 1 doesn't ask for them.
 */
export async function listAddedSince(
  accessToken: string,
  options: { startHistoryId: string; pageToken?: string; pageSize?: number },
): Promise<HistoryPage> {
  const params = new URLSearchParams({
    startHistoryId: options.startHistoryId,
    historyTypes: "messageAdded",
    maxResults: String(options.pageSize ?? 100),
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);

  let body: HistoryResponse;
  try {
    body = await gmailGet<HistoryResponse>(accessToken, "/history", params);
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) {
      throw new GmailHistoryTooOld();
    }
    throw error;
  }

  // One message can appear in several history records. Count it once.
  const ids = new Set<string>();
  for (const record of body.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      ids.add(added.message.id);
    }
  }

  return {
    ids: [...ids],
    nextPageToken: body.nextPageToken ?? null,
    historyId: body.historyId,
  };
}
