import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { canReadCalendar } from "@/lib/google/scopes";
import { supabaseError } from "@/lib/supabase/errors";
import type { RevokeResult } from "@/lib/google/tokens";

/**
 * The calendar's access token, and giving it back (slice 8a).
 *
 * Separate from lib/google/tokens.ts because it is a separate connection with
 * its own row and its own refresh token. The alternative — one function with a
 * "which connection" argument — would mean a mistake in one flow could reach
 * into the other, which is not a risk worth taking for eight saved lines in an
 * OAuth path.
 */

export class CalendarNotConnected extends Error {}
export class CalendarReconnectRequired extends Error {}

export type CalendarConnection = {
  email: string;
  scopes: string[];
  syncedThrough: string | null;
};

/** The connection, or null when the calendar was never connected. */
export async function calendarConnection(
  db: SupabaseClient,
  userId: string,
): Promise<CalendarConnection | null> {
  const { data, error } = await db
    .from("google_calendar")
    .select("email, scopes, synced_through")
    .eq("user_id", userId)
    .maybeSingle<{ email: string; scopes: string[]; synced_through: string | null }>();
  if (error) throw supabaseError(error, "Couldn't check the calendar connection");
  if (!data) return null;

  return { email: data.email, scopes: data.scopes ?? [], syncedThrough: data.synced_through };
}

/**
 * A fresh access token for reading events.
 *
 * Refreshes against Google on every call, like the Gmail one. Callers that read
 * several things ask once and pass the token down — slice 6d learned that the
 * hard way, one refresh per contact.
 */
export async function getCalendarAccessToken(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db
    .from("google_calendar")
    .select("refresh_token_encrypted, scopes")
    .eq("user_id", userId)
    .maybeSingle<{ refresh_token_encrypted: string; scopes: string[] }>();
  if (error) throw supabaseError(error, "Couldn't read the calendar connection");
  if (!data) throw new CalendarNotConnected("No calendar connection for this user");
  if (!canReadCalendar(data.scopes ?? [])) {
    throw new CalendarReconnectRequired("The calendar permission was not granted");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(data.refresh_token_encrypted),
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body: { error?: string } = await response.json().catch(() => ({}));
    // The user removed access at Google, or the token expired unused.
    if (body.error === "invalid_grant") {
      throw new CalendarReconnectRequired("Calendar access expired or was revoked");
    }
    throw new Error("Google refused the calendar token refresh");
  }

  const tokens: { access_token: string } = await response.json();
  return tokens.access_token;
}

/**
 * Tell Google to forget the calendar token, then forget it here.
 *
 * Same order as account deletion for the same reason (app/privacy/actions.ts):
 * deleting the row alone would only make the app forget a token Google would go
 * on honouring. The meetings go too — they were read under this permission, and
 * keeping them after it is withdrawn would be keeping data on a promise that no
 * longer holds.
 */
/**
 * Tell Google to drop the calendar's refresh token, and say whether it did
 * (slice 13, commit 6b). For account deletion, which must not delete anything
 * while Google still honours a token (app/privacy/actions.ts).
 *
 * The same rules as revokeGmailAccess (lib/google/tokens.ts), written again
 * here rather than shared, for the reason at the top of this file. Stricter
 * than disconnectCalendar below, which ignores a failed revoke: there the
 * person is still signed in and can try again; after deletion nobody could.
 *
 *   revoked        Google said yes
 *   already_gone   no calendar connected, or Google has never heard of the
 *                  token: dead either way, which is what was wanted
 *   failed         anything else, including Google being unreachable. Not
 *                  knowing is a failure here
 */
export async function revokeCalendarAccess(db: SupabaseClient, userId: string): Promise<RevokeResult> {
  const { data, error } = await db
    .from("google_calendar")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle<{ refresh_token_encrypted: string }>();
  if (error) return "failed";
  if (!data) return "already_gone";

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: decrypt(data.refresh_token_encrypted) }),
    });
  } catch {
    return "failed";
  }
  if (response.ok) return "revoked";
  const body: { error?: string } = await response.json().catch(() => ({}));
  return response.status === 400 && body.error === "invalid_token" ? "already_gone" : "failed";
}

export async function disconnectCalendar(db: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await db
    .from("google_calendar")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle<{ refresh_token_encrypted: string }>();
  if (error) throw supabaseError(error, "Couldn't read the calendar connection");

  if (data) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: decrypt(data.refresh_token_encrypted) }),
    }).catch(() => undefined);
  }

  const meetings = await db.from("calendar_meetings").delete().eq("user_id", userId);
  if (meetings.error) throw supabaseError(meetings.error, "Couldn't delete the meetings");

  const connection = await db.from("google_calendar").delete().eq("user_id", userId);
  if (connection.error) throw supabaseError(connection.error, "Couldn't disconnect the calendar");
}
