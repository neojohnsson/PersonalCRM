"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { emailsFromForm } from "@/lib/contacts/form-emails";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The Seen once queue's buttons.
 *
 * `only` is bound by the button (Next.js 16 forms guide, "Passing additional
 * arguments"): a row's button binds its row's address, the bulk buttons bind
 * null and act on everything ticked.
 *
 * A Server Action can be called by anyone who sends it a POST, not only by
 * these buttons (Next.js 16 docs, "Mutating data"), so each one checks the user
 * itself. The work happens in database functions that run as the signed-in
 * user — RLS applies — and that only act on addresses really in their Seen
 * once (migration 0007).
 */

/** "Add as contact", for one row or everything ticked. */
export async function addAsContacts(only: string | null, formData: FormData): Promise<void> {
  const user = await requireUser();
  const emails = emailsFromForm(formData, only);
  if (emails.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_seen_once_contacts", {
    p_user_id: user.id,
    p_emails: emails,
  });
  if (error) throw supabaseError(error, "Couldn't add contacts");

  refresh();
}

/**
 * "Dismiss", for one row or everything ticked. Their incoming mail is deleted
 * and their future mail is never stored (slice-2-plan.md, decision A).
 */
export async function dismissPeople(only: string | null, formData: FormData): Promise<void> {
  const user = await requireUser();
  const emails = emailsFromForm(formData, only);
  if (emails.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_seen_once", {
    p_user_id: user.id,
    p_emails: emails,
  });
  if (error) throw supabaseError(error, "Couldn't dismiss");

  refresh();
}
