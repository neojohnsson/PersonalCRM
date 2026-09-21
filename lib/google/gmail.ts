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
 *   - going over the per-user quota answers 403 (rateLimitExceeded /
 *     userRateLimitExceeded) or 429, and the fix is to wait and retry
 *
 * Server-side only in practice: an access token is a live key to a mailbox.
 *
 * Slice 4 adds a fifth, getMessageFull, for the AI summary: the one request
 * that reads a message's text. Its result is used in memory and never stored
 * (docs/slice-4-plan.md, Part 1).
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * The only headers the sync asks for. Never the body. Subject since slice 2
 * (slice-2-plan.md, decision B).
 */
export const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "List-Unsubscribe",
  // Slice 9a: what a mail server sets when a machine answered, so an
  // out-of-office is not mistaken for a person writing to you
  // (lib/google/filter.ts). Only mail read after this change carries them.
  "Auto-Submitted",
  "Precedence",
  "X-Autoreply",
  "X-Autorespond",
] as const;

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
 * Gmail says "too many requests for this user right now". Nothing is wrong:
 * the sync should keep its place, wait, and carry on.
 */
export class GmailRateLimited extends GmailApiError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "GmailRateLimited";
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

type GoogleErrorBody = {
  error?: {
    message?: string;
    errors?: { reason?: string }[];
  };
};

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

function isRateLimit(status: number, body: GoogleErrorBody): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;

  const error = body.error;
  return (
    Boolean(error?.errors?.some((e) => e.reason && RATE_LIMIT_REASONS.has(e.reason))) ||
    /quota exceeded|rate limit/i.test(error?.message ?? "")
  );
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
    // Keep Google's own explanation: "HTTP 403" alone could mean a missing
    // permission, a disabled API or a rate limit, and the status line should
    // say which. Only the error text is kept — never any message content.
    const body = await response
      .json()
      .then((parsed: GoogleErrorBody) => parsed)
      .catch((): GoogleErrorBody => ({}));

    const reason = body.error?.message;
    const message = `Gmail ${path} failed with HTTP ${response.status}${reason ? `: ${reason}` : ""}`;

    if (isRateLimit(response.status, body)) {
      throw new GmailRateLimited(response.status, message);
    }
    throw new GmailApiError(response.status, message);
  }

  return (await response.json()) as T;
}

async function gmailPost<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const parsed = await response
      .json()
      .then((json: GoogleErrorBody) => json)
      .catch((): GoogleErrorBody => ({}));
    const reason = parsed.error?.message;
    const message = `Gmail ${path} failed with HTTP ${response.status}${reason ? `: ${reason}` : ""}`;
    if (isRateLimit(response.status, parsed)) throw new GmailRateLimited(response.status, message);
    throw new GmailApiError(response.status, message);
  }

  return (await response.json()) as T;
}

/**
 * Create a draft in a thread. The only request in the app that writes to
 * Gmail, and it writes a draft — never a sent message (AGENTS.md). Needs the
 * gmail.compose permission.
 */
export async function createDraft(
  accessToken: string,
  draft: { raw: string; threadId: string },
): Promise<{ id: string; message?: { id: string; threadId: string } }> {
  return gmailPost(accessToken, "/drafts", {
    message: { raw: draft.raw, threadId: draft.threadId },
  });
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
 *
 * `search` narrows it with more of Gmail's search words, such as
 * `from:karin@example.se`.
 */
export async function listMessageIds(
  accessToken: string,
  options: { lookbackDays: number; search?: string; pageToken?: string; pageSize?: number },
): Promise<IdPage> {
  const params = new URLSearchParams({
    q: [`newer_than:${options.lookbackDays}d`, options.search].filter(Boolean).join(" "),
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

/** One MIME part of a full message: the body, or a nested multipart. */
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  /** `data` is base64url; absent for attachments, which carry attachmentId. */
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailFullMessage = Omit<GmailMessage, "payload"> & { payload?: GmailPart };

/**
 * One whole message: format=full, headers and body parts. Attachments come
 * back as ids only, and nothing here fetches them.
 *
 * Only for the AI summary, one contact at a time. The caller keeps the text
 * in memory for that request — the sync never uses this.
 */
export async function getMessageFull(accessToken: string, id: string): Promise<GmailFullMessage> {
  return gmailGet<GmailFullMessage>(
    accessToken,
    `/messages/${encodeURIComponent(id)}`,
    new URLSearchParams({ format: "full" }),
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
