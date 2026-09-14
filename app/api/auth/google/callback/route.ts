import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
    await requireUser();

    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const error = request.nextUrl.searchParams.get("error");

    const savedState = request.cookies.get("google_oauth_state")?.value;
    
    if (!state || !savedState || state !== savedState) {
        return NextResponse.redirect(new URL("/connect?error=state_mismatch", request.url));
    }

    if (error || !code) {
        return NextResponse.redirect(new URL("/connect?error=denied", request.url));
    }

    return new Response("state OK, code received");
}