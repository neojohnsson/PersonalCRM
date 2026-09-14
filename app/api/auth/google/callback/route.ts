import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";

type GoogleTokens = {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    token_type: string;
};

export async function GET(request: NextRequest) {
    await requireUser();

    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const error = request.nextUrl.searchParams.get("error");

    const savedState = request.cookies.get("google_oauth_state")?.value;
    
    if (!state || !savedState || state !== savedState) {
        return clearState(NextResponse.redirect(new URL("/connect?error=state_mismatch", request.url)));
    }

    if (error || !code) {
        return clearState(NextResponse.redirect(new URL("/connect?error=denied", request.url)));
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
            code: code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
            grant_type: "authorization_code",
        }),
    });
    if (!response.ok) {
        return clearState(NextResponse.redirect(new URL("/connect?error=token_exchange", request.url)));
    }

    const tokens: GoogleTokens = await response.json();

    return clearState(NextResponse.json({
        hasRefreshToken: Boolean(tokens.refresh_token),
        scope: tokens.scope,
        expiresIn: tokens.expires_in,
    }));
}

function clearState(response: NextResponse) {
    response.cookies.delete({ name: "google_oauth_state", path: "/api/auth/google" });
    return response;
}