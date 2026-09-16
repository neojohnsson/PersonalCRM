import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { isUuid, valuesFromContact } from "@/lib/contacts/contact-form";
import { displayName } from "@/lib/contacts/display";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { ContactForm } from "../../contact-form";

export const metadata = { title: `Edit contact · ${APP_NAME}` };

export default async function EditContactPage({ params }: PageProps<"/contacts/[id]/edit">) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [contactResult, emailsResult] = await Promise.all([
    supabase
      .from("contacts")
      .select("first_name, last_name, company, role, one_liner, how_known, phone, notes, tags")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("contact_emails")
      .select("email")
      .eq("contact_id", id)
      .eq("user_id", user.id)
      .order("is_primary", { ascending: false })
      .order("email"),
  ]);
  if (contactResult.error) throw supabaseError(contactResult.error, "Couldn't load the contact");
  if (emailsResult.error) throw supabaseError(emailsResult.error, "Couldn't load the contact's addresses");

  const contact = contactResult.data;
  if (!contact) notFound();

  const emails = emailsResult.data.map((row) => row.email as string);
  const name = displayName({ ...contact, primary_email: emails[0] ?? null });

  return (
    <AppShell userEmail={user.email} headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href={`/contacts/${id}`} className="text-[12.5px] font-medium text-ink-soft hover:text-ink">
            ← {name}
          </Link>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.035em]">Edit contact</h1>
        </div>

        <ContactForm
          contactId={id}
          initial={valuesFromContact(contact, emails)}
          cancelHref={`/contacts/${id}`}
        />
      </main>
    </AppShell>
  );
}
