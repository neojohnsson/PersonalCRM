import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a contact for everyone the user has exchanged mail with in both
 * directions and who doesn't have one yet. Returns how many were created.
 *
 * The work happens in the database function import_contacts (migration 0005),
 * so each contact and its address are created in one transaction. It only
 * ever creates — an existing contact is never changed.
 *
 * Takes the client and user id, like runSyncStep, so a scheduled sync can call
 * it without a signed-in user.
 */
export async function importContacts(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db.rpc("import_contacts", { p_user_id: userId });
  if (error) throw error;

  return data as number;
}
