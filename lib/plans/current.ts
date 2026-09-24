import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import { planNamed, type Plan } from "./plans";

/**
 * The plan this user is on (migration 0027).
 *
 * Read from `entitlements`, which the user can read and nobody can write
 * through the API, so what comes back was set by the Stripe webhook or the
 * database owner, never by the user. No row means Free.
 *
 * Cached for one request: the shell, the page and its actions all ask.
 */
export const currentPlan = cache(async (db: SupabaseClient, userId: string): Promise<Plan> => {
  const { data, error } = await db
    .from("entitlements")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle<{ plan: string }>();
  if (error) throw supabaseError(error, "Couldn't check what this account includes");
  return planNamed(data?.plan);
});
