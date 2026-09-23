import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Whether the Assistant is switched on for this user (migration 0025).
 *
 * Read from `entitlements`, which the user can read and nobody can write
 * through the API — so a true here was set by the database owner, never by the
 * user flipping it themselves (the reason it is not a column on `profiles`).
 *
 * No row means off: a new account starts without it, and slice 13's payment
 * webhook is what will write a row.
 *
 * Cached for one request, because the shell (for the sidebar) and the page
 * (for the redirect) both ask.
 */
export const hasAssistant = cache(async (db: SupabaseClient, userId: string): Promise<boolean> => {
  const { data, error } = await db
    .from("entitlements")
    .select("assistant")
    .eq("user_id", userId)
    .maybeSingle<{ assistant: boolean }>();
  if (error) throw supabaseError(error, "Couldn't check what this account includes");
  return data?.assistant === true;
});
