import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * A new client per request — never share one across requests. The session
 * lives in cookies, so a shared client would serve one user's session to the
 * next request that came along.
 *
 * `cookies()` is async in Next 16. Server Components are also not allowed to
 * write cookies, which is why `setAll` swallows the error: `proxy.ts` is what
 * actually persists a refreshed token, and it runs before this does.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // Safe to ignore — proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
