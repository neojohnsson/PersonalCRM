

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";

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
        throw new Error("Google refused the token refresh");
    }

    const tokens: { access_token: string } = await response.json();

    return tokens.access_token;
}