import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { googleCalendarCallbackUrl } from "@/lib/google/redirect";
import { REQUESTED_CALENDAR_SCOPES } from "@/lib/google/scopes";

/**
 * The calendar's own consent screen (slice 8a; docs/slice-8-plan.md, Part 1).
 *
 * Deliberately a copy of app/api/auth/google/route.ts rather than a shared
 * function with two modes: they are two separate connections that happen to
 * look alike, and the Gmail one is hand-written. A shared helper would mean one
 * change could break both, which is the last thing wanted in an OAuth flow.
 *
 * What differs from the Gmail request:
 *   - the scopes (read events, and which account it is)
 *   - its own callback path, so the two can never be confused on the way back
 *   - its own state cookie, scoped to this path
 */
export async function POST(request: NextRequest) {
    await requireUser();
    const state = randomBytes(32).toString("base64url");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    // Built from the address this request came in on, so localhost, previews
    // and production each get their own callback. See lib/google/redirect.ts.
    url.searchParams.set("redirect_uri", googleCalendarCallbackUrl(request));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", REQUESTED_CALENDAR_SCOPES);
    // offline, so the app can read the calendar again tomorrow without asking.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url, 303);
    response.cookies.set("google_calendar_oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/google/calendar",
        maxAge: 60 * 10,
    });
    return response;
}
