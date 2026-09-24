"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { AiNotConfigured } from "@/lib/ai/config";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { AiCapReached } from "@/lib/ai/spend";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { ResearchNotFound, discardPending, keepTicked, removeKeptFact } from "@/lib/research/decide";
import { hasResearch } from "@/lib/research/entitlement";
import { ResearchContactNotFound, researchContact } from "@/lib/research/research";
import { createClient } from "@/lib/supabase/server";

/**
 * The "From the web" card's buttons (slice 12, commit 4).
 *
 * Each checks the user and that research is switched on for them, as every
 * Server Action must: a POST does not come through the page. Everything runs
 * as the user, so RLS decides which research exists.
 */

export type ResearchState = { error: string | null; nothingFound?: string | null } | null;

async function allowed() {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await hasResearch(supabase, user.id))) notFound();
  return { user, supabase };
}

/** "Research this person": search, check, and leave what survives waiting. */
export async function researchAction(contactId: string): Promise<ResearchState> {
  if (!isUuid(contactId)) notFound();
  const { user, supabase } = await allowed();

  try {
    const result = await researchContact(supabase, user.id, contactId);
    refresh();
    // Nothing survived: say why, rather than an empty card that looks broken.
    return { error: null, nothingFound: result.saved ? null : result.identityWhy };
  } catch (failure) {
    if (failure instanceof ResearchContactNotFound) notFound();
    if (failure instanceof AiCapReached) {
      return {
        error: `This month's AI budget is used up ($${failure.spentUsd.toFixed(2)} of $${failure.capUsd.toFixed(2)}). It resets on the 1st.`,
      };
    }
    if (failure instanceof AiNotConfigured) return { error: "The AI isn't set up on this server: an OpenAI key is missing." };
    if (failure instanceof OpenAiNoAnswer) return { error: "The search gave no usable answer, so nothing was saved. Try again." };
    if (failure instanceof OpenAiError) return { error: `OpenAI couldn't be reached (HTTP ${failure.status}). Nothing was saved.` };
    throw failure;
  }
}

/** "Keep the ticked ones". */
export async function keepResearchAction(researchId: string, ticked: number[]): Promise<ResearchState> {
  if (!isUuid(researchId)) notFound();
  const { user, supabase } = await allowed();
  try {
    await keepTicked(supabase, user.id, researchId, Array.isArray(ticked) ? ticked.map(Number) : []);
  } catch (failure) {
    if (failure instanceof ResearchNotFound) return { error: failure.message };
    throw failure;
  }
  refresh();
  return { error: null };
}

/** "Discard all": the waiting set is deleted. */
export async function discardResearchAction(researchId: string): Promise<ResearchState> {
  if (!isUuid(researchId)) notFound();
  const { user, supabase } = await allowed();
  try {
    await discardPending(supabase, user.id, researchId);
  } catch (failure) {
    if (failure instanceof ResearchNotFound) return { error: failure.message };
    throw failure;
  }
  refresh();
  return { error: null };
}

/** The x beside a kept fact. */
export async function removeFactAction(researchId: string, index: number): Promise<ResearchState> {
  if (!isUuid(researchId)) notFound();
  const { user, supabase } = await allowed();
  try {
    await removeKeptFact(supabase, user.id, researchId, Number(index));
  } catch (failure) {
    if (failure instanceof ResearchNotFound) return { error: failure.message };
    throw failure;
  }
  refresh();
  return { error: null };
}
