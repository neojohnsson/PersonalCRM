"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";

export async function disconnectGmail() {
    const user = await requireUser();
    const supabase = await createClient();

    const { data } = await supabase
        .from("google_accounts")
        .select("refresh_token_encrypted")
        .eq("user_id", user.id)
        .maybeSingle();

    if (data) {
        await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            body: new URLSearchParams({
                token: decrypt(data.refresh_token_encrypted),
            }),
        });
    }

    const { error } = await supabase
        .from("google_accounts")
        .delete()
        .eq("user_id", user.id);

    if (error) {
        throw new Error("Could not remove the Gmail connection");
    }

    redirect("/");
}