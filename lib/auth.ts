import "server-only";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";

export const requireUser = cache(async () => {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.getClaims();

    if(!data?.claims || error) {
        redirect("/login");
    }

    return { id: data.claims.sub, email: data.claims.email };
});