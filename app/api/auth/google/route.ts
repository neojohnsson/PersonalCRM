
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { randomBytes } from "node:crypto";

export async function POST() {
    await requireUser();
    const state = randomBytes(32).toString("base64url");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    const client_id = process.env.GOOGLE_CLIENT_ID!;
    const redirect_uri = process.env.GOOGLE_REDIRECT_URI!;
    const scope = "https://www.googleapis.com/auth/gmail.readonly";
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
        maxAge: 60 * 10, // 10 minutes
    });
    return response;
}