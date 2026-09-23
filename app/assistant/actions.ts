"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { ActionRefused, undoAction } from "@/lib/assistant/act";
import { hasAssistant } from "@/lib/assistant/entitlement";
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
    if (failure instanceof ActionRefused) return { error: failure.message };
    if (failure instanceof ContactNotFound) return { error: "That contact isn't there any more." };
    throw failure;
  }

  refresh();
  return null;
}
