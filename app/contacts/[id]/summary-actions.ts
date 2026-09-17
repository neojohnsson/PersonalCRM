"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { AiNotConfigured } from "@/lib/ai/config";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { AiCapReached } from "@/lib/ai/spend";
import { NoMailToSummarise, SummaryContactNotFound, generateSummary } from "@/lib/ai/summary";
import {
  SummaryNotFound,
  approveSummary,
  discardSummary,
  editSummary,
  parseSummaryForm,
  type SummaryFormErrors,
  type SummaryFormValues,
} from "@/lib/ai/summary-record";
import { applySuggestedField, type SuggestedField } from "@/lib/ai/suggestions";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { GmailApiError } from "@/lib/google/gmail";
import { GmailReconnectRequired } from "@/lib/google/tokens";
import { createClient } from "@/lib/supabase/server";

/**
 * The summary card's buttons (docs/slice-4-plan.md, Part 4).
 *
 * Like every Server Action, each can be called by anyone who sends it a POST,
 * so each checks the user itself and runs as them — RLS, and the functions of
 * migration 0010, decide what they can touch. The ids are bound by the page
 * and checked here, because a POST can carry anything.
 */

export type GenerateState = { error: string | null } | null;

/** "Generate" and "Regenerate": a new pending summary, or a plain-words reason why not. */
export async function generateSummaryAction(contactId: string, previous: GenerateState): Promise<GenerateState> {
  void previous;
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();

  const supabase = await createClient();
  try {
    await generateSummary(supabase, user.id, contactId);
  } catch (error) {
    if (error instanceof SummaryContactNotFound) notFound();
    const reason = explain(error);
    if (reason === null) throw error;
    return { error: reason };
  }

  refresh();
  return { error: null };
}

/**
 * The failures a person can do something about, in words. Anything else is a
 * bug and goes to the error page. None of these messages include email text.
 */
function explain(error: unknown): string | null {
  if (error instanceof AiCapReached) {
    return `This month's AI budget is used up ($${error.spentUsd.toFixed(2)} of $${error.capUsd.toFixed(2)}). It resets on the 1st.`;
  }
  if (error instanceof NoMailToSummarise) return "There's no mail with this contact to summarise yet.";
  if (error instanceof AiNotConfigured) return "The AI isn't set up on this server: an OpenAI key is missing.";
  if (error instanceof GmailReconnectRequired) return "Gmail access has expired. Reconnect Gmail, then try again.";
  if (error instanceof OpenAiNoAnswer) return "The AI gave no usable answer, so nothing was saved. Try again.";
  if (error instanceof OpenAiError) return `OpenAI couldn't be reached (HTTP ${error.status}). Nothing was saved.`;
  if (error instanceof GmailApiError) return `Gmail couldn't be read (HTTP ${error.status}). Nothing was sent to the AI.`;
  return null;
}

export async function approveSummaryAction(summaryId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(summaryId)) notFound();

  await goneIsFine(async () => approveSummary(await createClient(), user.id, summaryId));
  refresh();
}

export async function discardSummaryAction(summaryId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(summaryId)) notFound();

  await goneIsFine(async () => discardSummary(await createClient(), user.id, summaryId));
  refresh();
}

export type EditSummaryState = {
  errors: SummaryFormErrors;
  values: SummaryFormValues;
  /** Bumped on every successful save, so the card knows to close its form. */
  saved: number;
} | null;

export async function editSummaryAction(
  summaryId: string,
  previous: EditSummaryState,
  formData: FormData,
): Promise<EditSummaryState> {
  const user = await requireUser();
  if (!isUuid(summaryId)) notFound();

  const saves = previous?.saved ?? 0;
  const parsed = parseSummaryForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values, saved: saves };

  try {
    await editSummary(await createClient(), user.id, summaryId, parsed.parts);
  } catch (error) {
    if (!(error instanceof SummaryNotFound)) throw error;
    // Replaced in another tab: the refreshed page shows what's there now.
  }

  refresh();
  const values = Object.fromEntries(
    Object.entries(parsed.parts).map(([part, text]) => [part, text ?? ""]),
  ) as SummaryFormValues;
  return { errors: {}, values, saved: saves + 1 };
}

/**
 * "Set as company" / "Replace Fortnox AB": one field from the summary onto the
 * contact. `expected` is what the button showed in that field; if it has
 * changed since, nothing is written and the refreshed page shows the new value.
 */
export async function applySuggestionAction(
  summaryId: string,
  field: SuggestedField,
  expected: string | null,
): Promise<void> {
  const user = await requireUser();
  if (!isUuid(summaryId)) notFound();
  if (field !== "company" && field !== "role") notFound();
  if (expected !== null && (typeof expected !== "string" || expected.length > 200)) notFound();

  await applySuggestedField(await createClient(), user.id, summaryId, field, expected);
  refresh();
}

/** Already approved, discarded or replaced in another tab: the refresh shows how things stand. */
async function goneIsFine(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof SummaryNotFound)) throw error;
  }
}
