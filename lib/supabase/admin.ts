import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The database as its owner, past RLS (slice 13, commit 5).
 *
 * The one place the app itself uses SUPABASE_SECRET_KEY: the Stripe webhook,
 * which writes `entitlements` -- the table nobody can write through the API,
 * on purpose (migration 0025). It is only called after Stripe's signature on
 * the request has been checked (lib/stripe/webhook.ts).
 *
 * "server-only", and the key is never NEXT_PUBLIC_ (AGENTS.md). Everything
 * else in the app runs as the signed-in user, so RLS decides.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SECRET_KEY is missing: the payment webhook cannot record a plan.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
