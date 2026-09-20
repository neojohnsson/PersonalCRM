"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The three things you can say about a contact (docs/slice-6c-plan.md).
 * Shared by the home page, the brief and the contact page, because the same
 * sentence means the same thing wherever you say it.
 *
 * A Server Action can be called by anyone who sends it a POST, so each one
 * checks the user itself and runs as them: the RLS policies and the composite
 * foreign key of migration 0018 decide which contacts and threads they may
 * touch. The ids are bound by the page, and checked here because a POST can
 * carry anything.
 *
 * Nothing here is destructive. A settle is one row that you can undo, and
 * never_chase is a switch — no mail, contact or summary is changed by either.
 */

const FOREIGN_KEY_VIOLATION = "23503";

/** "Not needed": this conversation is finished, as of now. */
export async function settleThread(contactId: string, threadId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(contactId) || !threadId.trim()) notFound();

  const supabase = await createClient();
  const { error } = await supabase.from("settled_threads").upsert(
    {
      user_id: user.id,
      contact_id: contactId,
      thread_id: threadId,
      // Said again, meant again: the moment moves, so a message you have since
      // read and settled doesn't re-open the thread behind you.
      settled_at: new Date().toISOString(),
    },
    { onConflict: "user_id,contact_id,thread_id" },
  );
  // Not their contact, or it's gone: the same answer either way.
  if (error?.code === FOREIGN_KEY_VIOLATION) notFound();
  if (error) throw supabaseError(error, "Couldn't settle the thread");

  refresh();
}

/** Undo: the conversation counts again from the message it was at. */
export async function reopenThread(contactId: string, threadId: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(contactId) || !threadId.trim()) notFound();

  const supabase = await createClient();
  const { error } = await supabase
    .from("settled_threads")
    .delete()
    .eq("user_id", user.id)
    .eq("contact_id", contactId)
    .eq("thread_id", threadId);
  if (error) throw supabaseError(error, "Couldn't reopen the thread");

  refresh();
}

/** "Just a contact": never prompted about, until you say otherwise. */
export async function setNeverChase(contactId: string, neverChase: boolean): Promise<void> {
  const user = await requireUser();
  if (!isUuid(contactId)) notFound();

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ never_chase: neverChase })
    .eq("user_id", user.id)
    .eq("id", contactId);
  if (error) throw supabaseError(error, "Couldn't change how this contact is handled");

  refresh();
}
