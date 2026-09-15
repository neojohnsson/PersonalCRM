import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";
import { resetSyncAfterReconnect } from "@/lib/sync/reconnect";

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

    if (!tokens.scope.split(" ").includes("https://www.googleapis.com/auth/gmail.readonly")) {
        return clearState(NextResponse.redirect(new URL("/connect?error=scope_missing", request.url)));
    }

    if (!tokens.refresh_token) {
        return clearState(NextResponse.redirect(new URL("/connect?error=no_refresh_token", request.url)));
    }

    const encryptedToken = encrypt(tokens.refresh_token);
    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { 
            Authorization: `Bearer ${tokens.access_token}`
        },
    });

    if (!profileResponse.ok) {
        return clearState(NextResponse.redirect(new URL("/connect?error=token_exchange", request.url)));
    }

    const profile: { emailAddress: string } = await profileResponse.json();
    const supabase = await createClient();

    const { error: saveError } = await supabase
        .from("google_accounts")
        .upsert(
            {
                user_id: user.id,
                email: profile.emailAddress,
                refresh_token_encrypted: encryptedToken,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
        );

    if (saveError) {
        return clearState(NextResponse.redirect(new URL("/connect?error=save_failed", request.url)));
    }

    // A fresh key un-sticks a sync that stopped on the old, dead one.
    try {
        await resetSyncAfterReconnect(supabase, user.id);
    } catch {
        return clearState(NextResponse.redirect(new URL("/connect?error=save_failed", request.url)));
    }

    return clearState(NextResponse.redirect(new URL("/", request.url)));
}

function clearState(response: NextResponse) {
    response.cookies.delete({ name: "google_oauth_state", path: "/api/auth/google" });
    return response;
}