import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * Whether web research is switched on for this user (migration 0026).
 *
 * The same rule as the Assistant's flag (lib/assistant/entitlement.ts): read
 * from `entitlements`, which nobody can write through the API, so a true here
 * was set by the database owner. No row means off.
 *
 * Cached for one request: the contact page and its actions both ask.
 */
export const hasResearch = cache(async (db: SupabaseClient, userId: string): Promise<boolean> => {
  const { data, error } = await db
    .from("entitlements")
    .select("research")
    .eq("user_id", userId)
    .maybeSingle<{ research: boolean }>();
  if (error) throw supabaseError(error, "Couldn't check what this account includes");
  return data?.research === true;
});
