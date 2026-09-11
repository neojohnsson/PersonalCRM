import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (runs in the browser).
 *
 * The publishable key is compiled into the browser bundle on purpose — it is
 * public by design and carries no privileges of its own. What stops one user
 * reading another user's rows is the row-level security policies on the
 * tables, not the secrecy of this key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
