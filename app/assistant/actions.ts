"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { generateSummaryAction } from "@/app/contacts/[id]/summary-actions";
import { runScan, type ScanState } from "@/app/assistant/promises/actions";
import { DraftContactNotFound, generateDraft } from "@/lib/ai/draft";
import { explainDraftFailure } from "@/lib/ai/draft-errors";
import { TONES, type Tone } from "@/lib/ai/draft-types";
import { ActionRefused, AlreadyUndone, undoAction } from "@/lib/assistant/act";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { costSinceUsd } from "@/lib/assistant/price";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { ContactNotFound } from "@/lib/relationship/settle";
import { createClient } from "@/lib/supabase/server";

/**
 * Undo, for something the Assistant did on its own (slice 11;
 * lib/assistant/act.ts does the work).
 *
 * Checks the user and the entitlement itself, as every Server Action must: a
 * POST does not come through the page. The action id is only found under
 * RLS, so somebody else's action is "not there", never undone.
 */
export async function undoAssistantAction(actionId: string): Promise<{ error: string } | null> {
  const user = await requireUser();
  if (!isUuid(actionId)) notFound();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();

  try {
    await undoAction(supabase, user.id, actionId);
  } catch (failure) {
    // Undone twice is still undone: the second press has nothing to say.
    if (failure instanceof AlreadyUndone) {
      refresh();
      return null;
    }
    if (failure instanceof ActionRefused) return { error: failure.message };
    if (failure instanceof ContactNotFound) return { error: "That contact isn't there any more." };
    throw failure;
  }

  refresh();
  return null;
}

/**
 * The "Needs you" cards' presses (slice 11, commit 6). The Assistant only
 * proposed these; this is you saying yes.
 *
 * Each one is the same work the contact and Promises pages do, through the
 * same code — a draft is written by generateDraft and lands pending, a summary
 * lands pending for you to approve, a scan leaves promises for you to decide.
 * What these add is the price: what the press really cost, read back from
 * ai_usage once it is over, so the card can say it.
 *
 * They check the user and the Assistant themselves, as the Undo above does.
 */

export type WrittenDraft =
  | { ok: true; draft: { id: string; subject: string | null; body: string }; costUsd: number | null }
  | { ok: false; error: string };

/** "Write it": a pending draft, shown on the card. Nothing reaches Gmail until "Save to Gmail". */
export async function writeProposedDraft(contactId: string, tone: Tone | null): Promise<WrittenDraft> {
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();
  if (tone !== null && !TONES.includes(tone)) notFound();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();

  const started = new Date();
  try {
    const draft = await generateDraft(supabase, user.id, contactId, { tone: tone ?? undefined });
    refresh();
    return {
      ok: true,
      draft: { id: draft.id, subject: draft.subject, body: draft.body ?? "" },
      costUsd: await costSinceUsd(supabase, user.id, "draft", started),
    };
  } catch (failure) {
    if (failure instanceof DraftContactNotFound) return { ok: false, error: "That contact isn't there any more." };
    const reason = explainDraftFailure(failure);
    if (reason === null) throw failure;
    return { ok: false, error: reason };
  }
}

/** "Write it" on a summary card: a pending summary, approved on the contact's page. */
export async function writeProposedSummary(
  contactId: string,
): Promise<{ error: string | null; costUsd: number | null }> {
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();

  const started = new Date();
  const result = await generateSummaryAction(contactId, null);
  return {
    error: result?.error ?? null,
    costUsd: await costSinceUsd(supabase, user.id, "summary", started),
  };
}

/** "Read my mail" on a promise-scan card: what it found waits on Promises. */
export async function runProposedScan(): Promise<{ scan: ScanState; costUsd: number | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) notFound();

  const started = new Date();
  const scan = await runScan();
  return { scan, costUsd: await costSinceUsd(supabase, user.id, "promises", started) };
}
