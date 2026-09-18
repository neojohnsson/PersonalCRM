import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_COLUMNS, MAX_BODY_CHARS, type SavedDraft } from "@/lib/ai/draft-types";
import { createDraft } from "@/lib/google/gmail";
import { buildReplyMessage } from "@/lib/google/message";
import { loadReplyContext } from "@/lib/ai/reply";
import { canDraft } from "@/lib/google/scopes";
import { getAccessToken } from "@/lib/google/tokens";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * "Save to Gmail drafts" — the moment a person approves a draft
 * (docs/slice-5a-plan.md, Part 3, step 6).
 *
 * The text saved is whatever is in the box when you press it, edits included.
 * Gmail then holds the draft, so the app clears its copy and keeps only the
 * Gmail draft id. **It creates a draft. It never sends** (AGENTS.md;
 * tests/no-send.test.ts).
 */

/** The draft isn't pending any more, or isn't the caller's. */
export class DraftNotFound extends Error {
  constructor() {
    super("That draft isn't waiting any more.");
    this.name = "DraftNotFound";
  }
}

/** Gmail hasn't been connected with permission to create drafts. */
export class DraftsNotAllowedHere extends Error {
  constructor() {
    super("Reconnect Gmail to allow drafts.");
    this.name = "DraftsNotAllowedHere";
  }
}

export type SaveDraftOptions = {
  accessToken?: (db: SupabaseClient, userId: string) => Promise<string>;
};

/** The contact's pending draft, if there is one. */
export async function pendingDraft(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<SavedDraft | null> {
  const { data, error } = await db
    .from("contact_drafts")
    .select(DRAFT_COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .maybeSingle<SavedDraft>();
  if (error) throw supabaseError(error, "Couldn't load the draft");
  return data;
}

/** The contact's most recently saved draft, for the "Open in Gmail" link. */
export async function lastSavedDraft(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<SavedDraft | null> {
  const { data, error } = await db
    .from("contact_drafts")
    .select(DRAFT_COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "saved")
    .order("saved_at", { ascending: false })
    .limit(1)
    .maybeSingle<SavedDraft>();
  if (error) throw supabaseError(error, "Couldn't load the saved draft");
  return data;
}

export async function saveDraftToGmail(
  db: SupabaseClient,
  userId: string,
  draftId: string,
  body: string,
  options: SaveDraftOptions = {},
): Promise<SavedDraft> {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("A draft can't be empty.");
  if (text.length > MAX_BODY_CHARS) throw new Error("That draft is too long to save.");

  const [draftResult, gmailResult] = await Promise.all([
    db
      .from("contact_drafts")
      .select("id, contact_id, thread_id, subject")
      .eq("id", draftId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle<{ id: string; contact_id: string; thread_id: string; subject: string | null }>(),
    db.from("google_accounts").select("scopes").eq("user_id", userId).maybeSingle(),
  ]);
  if (draftResult.error) throw supabaseError(draftResult.error, "Couldn't load the draft");
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");
  if (!draftResult.data) throw new DraftNotFound();
  if (!canDraft((gmailResult.data?.scopes as string[] | undefined) ?? [])) throw new DraftsNotAllowedHere();

  const draft = draftResult.data;
  const token = await (options.accessToken ?? getAccessToken)(db, userId);

  // Read the thread again rather than trusting stored headers: the recipient
  // and the In-Reply-To must match the conversation as it is now.
  const context = await loadReplyContext(db, userId, draft.contact_id, token);

  const raw = buildReplyMessage({
    to: context.to,
    subject: draft.subject ?? context.subject,
    body: text,
    inReplyTo: context.inReplyTo,
    references: context.references,
  });

  const created = await createDraft(token, { raw, threadId: draft.thread_id });

  // Gmail holds the text now, so the app doesn't (slice-5a-plan.md, Part 3).
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("contact_drafts")
    .update({ status: "saved", body: null, gmail_draft_id: created.id, saved_at: now, updated_at: now })
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select(DRAFT_COLUMNS)
    .returns<SavedDraft[]>();
  if (error) throw supabaseError(error, "Couldn't record the saved draft");
  // The draft is in Gmail either way; only the record failed.
  if (data.length === 0) throw new DraftNotFound();

  return data[0];
}

/** Discard: the pending draft is deleted. Nothing was ever in Gmail. */
export async function discardDraft(db: SupabaseClient, userId: string, draftId: string): Promise<void> {
  const { data, error } = await db
    .from("contact_drafts")
    .delete()
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't discard the draft");
  if (data.length === 0) throw new DraftNotFound();
}

/** Where to find a saved draft: Gmail's Drafts, in the connected account. */
export function gmailDraftsUrl(gmailEmail: string | null): string {
  return gmailEmail
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailEmail)}#drafts`
    : "https://mail.google.com/mail/u/0/#drafts";
}
