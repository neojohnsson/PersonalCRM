import { requireUser } from "@/lib/auth";
import { contactsCsv, exportEverything } from "@/lib/privacy/export";
import { createClient } from "@/lib/supabase/server";

/**
 * The download itself (docs/slice-7-plan.md, Part 2).
 *
 * A route handler rather than a server action, because the answer is a file:
 * the browser saves it, and nothing is written on the server to make that
 * happen. `requireUser` runs first and the queries run as that user, so RLS
 * decides what is in the file — a link that somebody else opens gives them
 * their own data, not yours.
 *
 *   /privacy/export            everything, as JSON
 *   /privacy/export?as=csv     the contact list, as a spreadsheet
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  const supabase = await createClient();

  const day = new Date().toISOString().slice(0, 10);
  const wantsCsv = new URL(request.url).searchParams.get("as") === "csv";

  if (wantsCsv) {
    const csv = await contactsCsv(supabase, user.id);
    return file(csv, "text/csv; charset=utf-8", `contacts-${day}.csv`);
  }

  const everything = await exportEverything(supabase, user.id, user.email ?? null);
  return file(JSON.stringify(everything, null, 2), "application/json; charset=utf-8", `your-data-${day}.json`);
}

function file(body: string, type: string, name: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      // It is personal data built for one request: never let anything keep it.
      "Cache-Control": "no-store",
    },
  });
}
