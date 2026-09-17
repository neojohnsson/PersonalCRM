"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { addAddressAsContact, undoDismissal } from "@/lib/contacts/dismissals";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { readBackMailFrom } from "@/lib/sync/read-back-mail";

/**
 * The Dismissed page's two buttons. The address is bound by the button.
 *
 * A Server Action can be called by anyone who sends it a POST, so each checks
 * the user itself and runs as them: RLS only lets the delete reach their own
 * dismissals (lib/contacts/dismissals.ts).
 *
 * Both do the same first two things, in this order:
 *   1. delete the dismissal — so the sync stops skipping them
 *   2. read the mail they sent back in from Gmail (lib/sync/read-back-mail.ts)
 *
 * Nothing further happens unless step 1 really deleted a row: an address that
 * isn't dismissed — undone in another tab, or made up — never makes a Gmail
 * request or a contact. If Gmail isn't connected or needs reconnecting, step 2
 * reads nothing; reconnecting starts the sync over, which reads it then.
 */

/** "Undo": they're back in Seen once — or a contact again, if the mail is both ways. */
export async function undoDismissalAction(email: string): Promise<void> {
  const user = await requireUser();
  if (!isAddress(email)) return;

  const supabase = await createClient();
  if (await undoDismissal(supabase, user.id, email)) {
    await readBackMailFrom(supabase, user.id, email, { lookbackDays: lookbackDays() });
  }

  refresh();
}

/** "Undo and add as contact": the same, then a contact, and off to its page. */
export async function undoAndAddAsContact(email: string): Promise<void> {
  const user = await requireUser();
  if (!isAddress(email)) return;

  const supabase = await createClient();
  if (!(await undoDismissal(supabase, user.id, email))) {
    refresh();
    return;
  }

  await readBackMailFrom(supabase, user.id, email, { lookbackDays: lookbackDays() });
  const contactId = await addAddressAsContact(supabase, user.id, email);

  redirect(`/contacts/${contactId}`);
}

function isAddress(email: unknown): email is string {
  return typeof email === "string" && email.includes("@") && email.length <= 320;
}
