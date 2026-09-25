import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentPlan } from "@/lib/plans/current";

/**
 * Whether web research is switched on for this user (migration 0026).
 *
 * The same rule as the Assistant's flag (lib/assistant/entitlement.ts): read
 * from `entitlements`, which nobody can write through the API, so a true here
 * was set by the database owner. No row means off.
 *
 * Cached for one request: the contact page and its actions both ask.
 *
 * Since slice 13 (migration 0027) it is part of your plan: lib/plans/plans.ts
 * says which plans include it, and `entitlements.plan` says which one is yours.
 */
export const hasResearch = cache(async (db: SupabaseClient, userId: string): Promise<boolean> =>
  (await currentPlan(db, userId)).research,
);
