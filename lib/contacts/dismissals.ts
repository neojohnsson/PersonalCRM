import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

export type Dismissal = {
  email: string;
  /** ISO timestamp. */
  dismissedAt: string;
};

/** Everyone the user has dismissed, most recent first. */
export async function listDismissals(db: SupabaseClient, userId: string): Promise<Dismissal[]> {
  const { data, error } = await db
    .from("seen_once_dismissals")
    .select("email, dismissed_at")
    .eq("user_id", userId)
    .order("dismissed_at", { ascending: false })
    .order("email");
  if (error) throw supabaseError(error, "Couldn't load dismissed people");

  return data.map((row) => ({ email: row.email as string, dismissedAt: row.dismissed_at as string }));
}

/**
 * Take a dismissal back: delete its row, so the sync stores their mail again.
 *
 * No database function needed. RLS's "Users can undo their own dismissals"
 * (migration 0004) only lets a delete reach the caller's own rows; someone
 * else's row is invisible to it, so nothing happens. `user_id` is in the
 * query too, so the intent is plain to read — RLS is what enforces it.
 *
 * Returns whether a row was deleted.
 */
export async function undoDismissal(db: SupabaseClient, userId: string, email: string): Promise<boolean> {
  const { data, error } = await db
    .from("seen_once_dismissals")
    .delete()
    .eq("user_id", userId)
    .eq("email", email.trim().toLowerCase())
    .select("email");
  if (error) throw supabaseError(error, "Couldn't undo the dismissal");

  return data.length > 0;
}

/**
 * "Undo and add as contact", the second half: make the address a contact, and
 * return the contact's id. Call it after the dismissal is undone and their
 * mail has been read back, so the contact gets the name and tier their mail
 * gives them.
 *
 * Three cases, by what the mail says about them now (person_tiers, 0004):
 *
 *   mail both ways    import_contacts (0005) — the same path the sync uses, so
 *                     the name is split the same way. It also imports anyone
 *                     else two-way who isn't a contact yet; the sync would do
 *                     that on its next run anyway.
 *   mail one way      add_seen_once_contacts (0007), as Seen once's button does
 *   no mail at all    save_contact (0008) with just the address — nothing else
 *                     is known about them
 *
 * If the address already belongs to a contact (added by hand meanwhile), that
 * contact is the answer and nothing is created.
 */
export async function addAddressAsContact(
  db: SupabaseClient,
  userId: string,
  address: string,
): Promise<string> {
  const email = address.trim().toLowerCase();

  const existing = await contactIdFor(db, userId, email);
  if (existing) return existing;

  const { data: person, error: personError } = await db
    .from("person_tiers")
    .select("tier")
    .eq("user_id", userId)
    .eq("email", email)
    .maybeSingle();
  if (personError) throw supabaseError(personError, "Couldn't look the address up");

  if (person?.tier === "contact") {
    const { error } = await db.rpc("import_contacts", { p_user_id: userId });
    if (error) throw supabaseError(error, "Couldn't add the contact");
  } else if (person?.tier === "seen_once") {
    const { error } = await db.rpc("add_seen_once_contacts", { p_user_id: userId, p_emails: [email] });
    if (error) throw supabaseError(error, "Couldn't add the contact");
  } else {
    const { error } = await db.rpc("save_contact", {
      p_user_id: userId,
      p_contact_id: null,
      p_contact: { tags: [] },
      p_emails: [email],
    });
    // address_taken: added in another tab a moment ago. The lookup below finds it.
    if (error && error.message !== "address_taken") {
      throw supabaseError(error, "Couldn't add the contact");
    }
  }

  const created = await contactIdFor(db, userId, email);
  if (!created) throw new Error("The contact wasn't created");
  return created;
}

async function contactIdFor(db: SupabaseClient, userId: string, email: string): Promise<string | null> {
  const { data, error } = await db
    .from("contact_emails")
    .select("contact_id")
    .eq("user_id", userId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw supabaseError(error, "Couldn't look the address up");
  return (data?.contact_id as string | undefined) ?? null;
}
