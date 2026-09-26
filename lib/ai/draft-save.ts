import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_COLUMNS, MAX_BODY_CHARS, type SavedDraft } from "@/lib/ai/draft-types";
import { createDraft } from "@/lib/google/gmail";
import { buildReplyMessage } from "@/lib/google/message";
import { loadReplyContext } from "@/lib/ai/reply";
import { canDraft } from "@/lib/google/scopes";
import { getAccessToken } from "@/lib/google/tokens";
import { supabaseError } from "@/lib/supabase/errors";

/** Two pending drafts for one contact: migration 0014's partial unique index. */
const UNIQUE_VIOLATION = "23505";

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
/** A newer pending draft exists, so a discarded one can't be put back. */
export class NewerDraftExists extends Error {
  constructor() {
    super("There's a newer draft for this contact now.");
    this.name = "NewerDraftExists";
  }
}

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

/** The address isn't one of this contact's, or the contact isn't the caller's. */
export class AddressNotOnContact extends Error {
  constructor() {
    super("That address isn't on this contact any more.");
    this.name = "AddressNotOnContact";
  }
}

/**
 * "Save to Gmail drafts" on the Assistant's new-email card (2026-09-26): an
 * email that answers nothing, to somebody there may be no mail with yet. The
 * Assistant wrote the words from what you asked for, you edited them in the
 * card, and pressing Save is the approval (AGENTS.md).
 *
 * Unlike a reply, nothing is kept in the app before or after: the text waits
 * only in the card, as the conversation does, and once Gmail has the draft
 * the app keeps nothing about it. So no row, and no clash with a contact's
 * one waiting reply draft (migration 0014).
 *
 * The address is checked here, at the press, not only when the Assistant
 * offered it: it must still be one of this contact's, read through your own
 * rights, so nobody can aim a draft at an address they typed or at another
 * person's contact. **It creates a draft. It never sends.**
 */
export async function saveNewEmailToGmail(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  email: { to: string; subject: string; body: string },
  options: SaveDraftOptions = {},
): Promise<{ gmailDraftId: string }> {
  const text = email.body.replace(/\r\n?/g, "\n").trim();
  const subject = email.subject.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("A draft can't be empty.");
  if (text.length > MAX_BODY_CHARS) throw new Error("That draft is too long to save.");
  if (!subject) throw new Error("A new email needs a subject.");
  if (subject.length > 500) throw new Error("That subject is too long.");

  const [addressResult, gmailResult] = await Promise.all([
    db
      .from("contact_emails")
      .select("email")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .eq("email", email.to.trim().toLowerCase())
      .maybeSingle<{ email: string }>(),
    db.from("google_accounts").select("scopes").eq("user_id", userId).maybeSingle(),
  ]);
  if (addressResult.error) throw supabaseError(addressResult.error, "Couldn't check the address");
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");
  if (!addressResult.data) throw new AddressNotOnContact();
  if (!canDraft((gmailResult.data?.scopes as string[] | undefined) ?? [])) throw new DraftsNotAllowedHere();

  const token = await (options.accessToken ?? getAccessToken)(db, userId);
  const raw = buildReplyMessage({
    to: addressResult.data.email,
    subject,
    body: text,
    inReplyTo: null,
    references: null,
  });

  const created = await createDraft(token, { raw, threadId: null });
  return { gmailDraftId: created.id };
}

/** Discard: the pending draft is deleted. Nothing was ever in Gmail. */
export async function discardDraft(db: SupabaseClient, userId: string, draftId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("contact_drafts")
    .update({ status: "discarded", body: null, discarded_at: now, updated_at: now })
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't discard the draft");
  if (data.length === 0) throw new DraftNotFound();
}

/**
 * Undo a Discard (slice 9b, Part 3; migration 0024).
 *
 * The row survived the discard, so this is the same row going back to
 * pending -- but its body was cleared at the moment you pressed Discard, and
 * `body` here is the text the browser was showing. That is not a new kind of
 * trust: "Save to Gmail drafts" already sends the text from that same box,
 * because editing it there is the whole point of a pending draft.
 *
 * A contact may have one pending draft (migration 0014's partial index), so
 * if another was written in the meantime this cannot happen, and the toast
 * says so rather than swallowing it.
 */
export async function restoreDraft(
  db: SupabaseClient,
  userId: string,
  draftId: string,
  body: string,
): Promise<void> {
  if (!body.trim()) throw new DraftNotFound();

  const { data, error } = await db
    .from("contact_drafts")
    .update({
      status: "pending",
      body: body.slice(0, MAX_BODY_CHARS),
      discarded_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "discarded")
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) throw new NewerDraftExists();
  if (error) throw supabaseError(error, "Couldn't put the draft back");
  if (data.length === 0) throw new DraftNotFound();
}

/** Where to find a saved draft: Gmail's Drafts, in the connected account. */
export function gmailDraftsUrl(gmailEmail: string | null): string {
  return gmailEmail
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailEmail)}#drafts`
    : "https://mail.google.com/mail/u/0/#drafts";
}
