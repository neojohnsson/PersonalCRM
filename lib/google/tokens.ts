

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";

export class GmailReconnectRequired extends Error {}

export async function getAccessToken(db: SupabaseClient, userId: string): Promise<string> {
    const { data, error } = await db
    .from("google_accounts")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .single();

    if (error || !data) {
        throw new Error("No Gmail connection for this user");
    }

    const refreshToken = decrypt(data.refresh_token_encrypted);

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        const body: { error?: string } = await response.json().catch(() => ({}));
        if (body.error === "invalid_grant") {
            throw new GmailReconnectRequired("Gmail access expired or was revoked");
        }
        throw new Error("Google refused the token refresh");
    }

    const tokens: { access_token: string } = await response.json();

    return tokens.access_token;
}

/**
 * What happened when we asked Google to forget this app.
 *
 * "already_gone" covers a token Google has never heard of or has already
 * revoked — the connection is dead either way, which is what was wanted.
 */
export type RevokeResult = "revoked" | "already_gone" | "failed";

/**
 * Tell Google to drop the refresh token, before the app forgets it.
 *
 * Order matters and is the whole point: deleting our row only makes the app
 * forget the token, while Google would go on honouring it. Account deletion
 * calls this first and refuses to delete anything if it fails
 * (app/privacy/actions.ts), because a live token after "delete everything" is
 * the worst bug this app could have.
 *
 * app/connect/actions.ts does the same thing inline for Disconnect; that one is
 * hand-written and left as it is.
 */
export async function revokeGmailAccess(db: SupabaseClient, userId: string): Promise<RevokeResult> {
    const { data, error } = await db
        .from("google_accounts")
        .select("refresh_token_encrypted")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) return "failed";
    if (!data) return "already_gone";

    let response: Response;
    try {
        response = await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            body: new URLSearchParams({ token: decrypt(data.refresh_token_encrypted) }),
        });
    } catch {
        // Google unreachable. Not knowing is the same as a failure here.
        return "failed";
    }

    if (response.ok) return "revoked";

    // 400 invalid_token: Google has no such token, so there is nothing left to
    // revoke. Any other refusal is a failure we must not paper over.
    const body: { error?: string } = await response.json().catch(() => ({}));
    return response.status === 400 && body.error === "invalid_token" ? "already_gone" : "failed";
}
