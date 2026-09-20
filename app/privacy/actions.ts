"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { revokeGmailAccess } from "@/lib/google/tokens";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Deleting, for real (plan.md §3.12; docs/slice-7-plan.md, Part 3).
 *
 * Both of these are irreversible and both are one database call, so the work
 * happens in one transaction: it all goes, or none of it does
 * (migration 0021).
 *
 * Each one also insists on a typed confirmation. Not as security — it is the
 * person's own data and they are allowed to destroy it — but because there is
 * no undo, and a button that deletes a year of work on one click is a trap.
 */

export type DeleteState = { error: string } | null;

const CONTACTS_PHRASE = "delete my contacts";

/** Everything about the people, keeping the account and the Gmail connection. */
export async function deleteAllContacts(
  previous: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const user = await requireUser();

  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (typed !== CONTACTS_PHRASE) {
    return { error: `Type "${CONTACTS_PHRASE}" to confirm.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_all_contacts", { p_user_id: user.id });
  if (error) throw supabaseError(error, "Couldn't delete the contacts");

  refresh();
  return null;
}

/**
 * Everything, and the login with it.
 *
 * Google is told first, and nothing is deleted if Google doesn't confirm.
 * Deleting our row would only make the app forget the token while Google went
 * on honouring it — so a failure here leaves the account entirely intact and
 * says what to do, rather than quietly doing half the job.
 */
export async function deleteAccount(previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const user = await requireUser();

  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase()) {
    return { error: "Type your email address to confirm." };
  }

  const supabase = await createClient();

  const revoked = await revokeGmailAccess(supabase, user.id);
  if (revoked === "failed") {
    return {
      error:
        "Google didn't confirm that the Gmail connection was removed, so nothing has been deleted. Try again — or remove this app at myaccount.google.com/permissions and then delete.",
    };
  }

  const { error } = await supabase.rpc("delete_account", { p_user_id: user.id });
  if (error) throw supabaseError(error, "Couldn't delete the account");

  // The session belongs to a user who no longer exists; clearing the cookie is
  // tidiness, and a failure here changes nothing that matters.
  await supabase.auth.signOut().catch(() => undefined);

  redirect("/login?deleted=1");
}
