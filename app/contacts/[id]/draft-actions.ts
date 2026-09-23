"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { DraftContactNotFound, generateDraft } from "@/lib/ai/draft";
import { explainDraftFailure } from "@/lib/ai/draft-errors";
import {
  DraftNotFound,
  discardDraft,
  restoreDraft,
  saveDraftToGmail,
} from "@/lib/ai/draft-save";
import { TONES, type Tone } from "@/lib/ai/draft-types";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { createClient } from "@/lib/supabase/server";

/**
 * The draft panel's buttons (docs/slice-5a-plan.md, Part 3).
 *
 * Each checks the user itself, as every Server Action must. Generating writes
 * a pending draft; only "Save to Gmail drafts" reaches Gmail, and nothing here
 * can send (AGENTS.md; tests/no-send.test.ts).
 */

export type DraftState = { error: string | null } | null;

/** "Draft reply" and "Regenerate", optionally in another tone for this draft. */
export async function generateDraftAction(
  contactId: string,
  tone: Tone | null,
  previous: DraftState,
): Promise<DraftState> {
  void previous;
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();
  if (tone !== null && !TONES.includes(tone)) notFound();

  try {
    await generateDraft(await createClient(), user.id, contactId, { tone: tone ?? undefined });
  } catch (error) {
    if (error instanceof DraftContactNotFound) notFound();
    const reason = explainDraftFailure(error);
    if (reason === null) throw error;
    return { error: reason };
  }

  refresh();
  return { error: null };
}

/** "Save to Gmail drafts": the text in the box, as it is now, becomes a Gmail draft. */
export async function saveDraftAction(draftId: string, previous: DraftState, formData: FormData): Promise<DraftState> {
  void previous;
  const user = await requireUser();
  if (!isUuid(draftId)) notFound();

  const body = formData.get("body");
  if (typeof body !== "string" || !body.trim()) return { error: "The draft is empty." };

  try {
    await saveDraftToGmail(await createClient(), user.id, draftId, body);
  } catch (error) {
    const reason = explainDraftFailure(error);
    if (reason === null) throw error;
    return { error: reason };
  }

  refresh();
  return { error: null };
}

export async function discardDraftAction(draftId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(draftId)) notFound();

  try {
    await discardDraft(await createClient(), user.id, draftId);
  } catch (error) {
    // Already gone, or saved in another tab: the refresh shows how things stand.
    if (!(error instanceof DraftNotFound)) throw error;
  }
  refresh();
}

/**
 * Undo of Discard (slice 9b, Part 3). `body` is the text the panel was
 * showing when you pressed Discard, because the row's own copy was cleared
 * then -- a discarded draft holds no message text (migration 0024).
 */
export async function restoreDraftAction(draftId: string, body: string): Promise<DraftState> {
  const user = await requireUser();
  if (!isUuid(draftId)) notFound();
  if (typeof body !== "string" || !body.trim()) return { error: "There was no text to put back." };

  try {
    await restoreDraft(await createClient(), user.id, draftId, body);
  } catch (error) {
    const reason = explainDraftFailure(error);
    if (reason === null) throw error;
    return { error: reason };
  }

  refresh();
  return { error: null };
}
