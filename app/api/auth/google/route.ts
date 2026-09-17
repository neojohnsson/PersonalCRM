import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { googleCallbackUrl } from "@/lib/google/redirect";
import { REQUESTED_SCOPES } from "@/lib/google/scopes";
import { randomBytes } from "node:crypto";

export async function POST(request: NextRequest) {
    await requireUser();
    const state = randomBytes(32).toString("base64url");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    const client_id = process.env.GOOGLE_CLIENT_ID!;
    // Built from the address this request came in on, so localhost, previews
    // and production each get their own callback. See lib/google/redirect.ts.
    const redirect_uri = googleCallbackUrl(request);
    // Read mail, and create drafts (slice 5a). Google shows them as separate
    // boxes; lib/google/scopes.ts says what each allows.
    const scope = REQUESTED_SCOPES;
    const response_type = "code";
    const access_type = "offline";
    const prompt = "consent";

    url.searchParams.set("client_id", client_id);
    url.searchParams.set("redirect_uri", redirect_uri);
    url.searchParams.set("response_type", response_type);
    url.searchParams.set("scope", scope);
    url.searchParams.set("access_type", access_type);
    url.searchParams.set("prompt", prompt);
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url, 303);
    response.cookies.set("google_oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/google",
        maxAge: 60 * 10,
    });
    return response;
}