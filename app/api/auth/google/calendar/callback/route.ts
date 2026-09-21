import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { googleCalendarCallbackUrl } from "@/lib/google/redirect";
import { canReadCalendar, parseGrantedScopes } from "@/lib/google/scopes";
import { createClient } from "@/lib/supabase/server";

/**
 * Back from the calendar's consent screen (slice 8a).
 *
 * The same shape as the Gmail callback, and separate from it on purpose: its
 * own state cookie, its own row, its own token. Connecting a calendar cannot
 * disturb the Gmail connection, and neither can failing to.
 *
 * Errors come back to /connect with a reason in the query string, as the Gmail
 * flow does, so one page explains both connections.
 */

type GoogleTokens = {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    token_type: string;
};

export async function GET(request: NextRequest) {
    const user = await requireUser();

    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const error = request.nextUrl.searchParams.get("error");
    const savedState = request.cookies.get("google_calendar_oauth_state")?.value;

    if (!state || !savedState || state !== savedState) {
        return back(request, "calendar_state_mismatch");
    }
    if (error || !code) {
        return back(request, "calendar_denied");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            // Must be exactly what the consent request sent.
            redirect_uri: googleCalendarCallbackUrl(request),
            grant_type: "authorization_code",
        }),
    });
    if (!response.ok) {
        return back(request, "calendar_token_exchange");
    }

    const tokens: GoogleTokens = await response.json();

    // Google lets a permission be unticked, so check what was really granted
    // rather than what was asked for.
    const grantedScopes = parseGrantedScopes(tokens.scope);
    if (!canReadCalendar(grantedScopes)) {
        return back(request, "calendar_scope_missing");
    }
    if (!tokens.refresh_token) {
        return back(request, "calendar_no_refresh_token");
    }

    // Which Google account this calendar belongs to. It can be a different one
    // from the connected Gmail, and the page should be able to say which.
    const who = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!who.ok) {
        return back(request, "calendar_token_exchange");
    }
    const account: { email?: string } = await who.json();
    if (!account.email) {
        return back(request, "calendar_token_exchange");
    }

    const supabase = await createClient();
    const { error: saveError } = await supabase.from("google_calendar").upsert(
        {
            user_id: user.id,
            email: account.email,
            refresh_token_encrypted: encrypt(tokens.refresh_token),
            scopes: grantedScopes,
            // A reconnection reads from the beginning again: the old position
            // may point past meetings that were never stored.
            synced_through: null,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
    );
    if (saveError) {
        return back(request, "calendar_save_failed");
    }

    return clearState(NextResponse.redirect(new URL("/connect?calendar=connected", request.url)));
}

function back(request: NextRequest, reason: string) {
    return clearState(NextResponse.redirect(new URL(`/connect?error=${reason}`, request.url)));
}

function clearState(response: NextResponse) {
    response.cookies.delete({
        name: "google_calendar_oauth_state",
        path: "/api/auth/google/calendar",
    });
    return response;
}
