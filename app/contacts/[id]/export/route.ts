import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { displayName } from "@/lib/contacts/display";
import { exportPerson } from "@/lib/privacy/export";
import { createClient } from "@/lib/supabase/server";

/**
 * One person's record, as a file you can send them
 * (plan.md §5.2; docs/slice-7-plan.md, Part 4).
 *
 * "A person in your database can demand a copy of what you hold on them, and
 * demand deletion — from you. Including the AI summary." This is the copy.
 *
 * The file is named after them, because it is going to be attached to a reply
 * and a file called export.json helps nobody.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const person = await exportPerson(supabase, user.id, id);
  if (!person.contact) notFound();

  const name = displayName({
    first_name: (person.contact.first_name as string | null) ?? null,
    last_name: (person.contact.last_name as string | null) ?? null,
    primary_email: (person.email_addresses[0]?.email as string | undefined) ?? null,
  });

  return new Response(JSON.stringify(person, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(name)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** A safe ASCII file name: "Pär Burman" → "par-burman-2026-09-20.json". */
function fileName(name: string): string {
  const slug =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "contact";
  return `${slug}-${new Date().toISOString().slice(0, 10)}.json`;
}
