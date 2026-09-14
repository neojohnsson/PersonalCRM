"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs the current browser out and sends it to /login.
 *
 * A Server Action rather than a click handler in the browser: the form POSTs
 * here, the server clears the session cookies through lib/supabase/server.ts,
 * and the redirect carries the cleared cookies back. It also works with
 * JavaScript switched off.
 *
 * `scope: "local"` ends only this browser's session. Supabase's default is
 * "global", which would also sign you out on your phone and every other device.
 *
 * Sign-out does not touch Gmail. The google_accounts row and its refresh token
 * stay; disconnecting Gmail is a separate action (slice-1-plan.md, Part 2).
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
