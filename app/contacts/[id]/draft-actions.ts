"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { AiNotConfigured } from "@/lib/ai/config";
import { DraftContactNotFound, DraftsNotAllowed, generateDraft } from "@/lib/ai/draft";
import { DraftNotFound, DraftsNotAllowedHere, discardDraft, saveDraftToGmail } from "@/lib/ai/draft-save";
import { TONES, type Tone } from "@/lib/ai/draft-types";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { NoThreadToReplyTo } from "@/lib/ai/reply";
import { AiCapReached } from "@/lib/ai/spend";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { GmailApiError } from "@/lib/google/gmail";
import { GmailReconnectRequired } from "@/lib/google/tokens";
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
    const reason = explain(error);
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
    const reason = explain(error);
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

/** The failures a person can act on, in plain words. None of them include email text. */
function explain(error: unknown): string | null {
  if (error instanceof AiCapReached) {
    return `This month's AI budget is used up ($${error.spentUsd.toFixed(2)} of $${error.capUsd.toFixed(2)}). It resets on the 1st.`;
  }
  if (error instanceof DraftsNotAllowed || error instanceof DraftsNotAllowedHere) {
    return "Gmail isn't connected with permission to create drafts. Reconnect Gmail, then try again.";
  }
  if (error instanceof NoThreadToReplyTo) return "There's no mail with this contact to reply to yet.";
  if (error instanceof DraftNotFound) return "That draft isn't waiting any more — it was saved or discarded elsewhere.";
  if (error instanceof AiNotConfigured) return "The AI isn't set up on this server: an OpenAI key is missing.";
  if (error instanceof GmailReconnectRequired) return "Gmail access has expired. Reconnect Gmail, then try again.";
  if (error instanceof OpenAiNoAnswer) return "The AI gave no usable answer, so nothing was saved. Try again.";
  if (error instanceof OpenAiError) return `OpenAI couldn't be reached (HTTP ${error.status}). Nothing was saved.`;
  if (error instanceof GmailApiError) return `Gmail couldn't be reached (HTTP ${error.status}). Nothing was saved.`;
  return null;
}
