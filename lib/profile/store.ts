import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile/profile";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Loading and saving your Profile (migration 0014). Takes the client and user
 * id and filters by user_id itself; RLS decides the rest.
 */

const COLUMNS =
  "display_name, based_in, what_you_do, looking_for, signature, languages, tone, length, address_by, sign_off, never_write, links, updated_at";

export type StoredProfile = Profile & { updated_at: string | null };

/** Your profile, or the defaults if you've never saved one. */
export async function loadProfile(db: SupabaseClient, userId: string): Promise<StoredProfile> {
  const { data, error } = await db
    .from("profiles")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle<StoredProfile>();
  if (error) throw supabaseError(error, "Couldn't load your profile");
  return data ?? { ...EMPTY_PROFILE, updated_at: null };
}

/** Save the whole profile, creating the row the first time. */
export async function saveProfile(db: SupabaseClient, userId: string, profile: Profile): Promise<StoredProfile> {
  const { data, error } = await db
    .from("profiles")
    .upsert({ user_id: userId, ...profile, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select(COLUMNS)
    .single<StoredProfile>();
  if (error) throw supabaseError(error, "Couldn't save your profile");
  return data;
}
