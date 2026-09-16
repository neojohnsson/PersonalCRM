"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid, parseContactForm, type ContactFormState } from "@/lib/contacts/contact-form";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Save the add or edit contact form.
 *
 * `contactId` is bound by the form: null for a new contact. `previous` is what
 * useActionState passes (Next.js 16 forms guide, "Validation errors"); the
 * return value is the form's next state — the errors to show and the values to
 * show them next to — or, when saving works, a redirect to the contact.
 *
 * A Server Action can be called by anyone who sends it a POST, so it checks the
 * user itself. The save runs as that user in one database transaction
 * (migration 0008), so RLS decides which contacts they may write.
 */
export async function saveContact(
  contactId: string | null,
  previous: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  void previous;
  const user = await requireUser();
  if (contactId !== null && !isUuid(contactId)) notFound();

  const parsed = parseContactForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: parsed.values };

  const { emails, ...fields } = parsed.contact;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_contact", {
    p_user_id: user.id,
    p_contact_id: contactId,
    p_contact: fields,
    p_emails: emails,
  });

  if (error) {
    if (error.message === "address_taken") {
      return {
        errors: { emails: `${error.details} already belongs to ${error.hint}.` },
        values: parsed.values,
      };
    }
    // Missing, or someone else's: the same answer either way.
    if (error.code === "P0002") notFound();
    throw supabaseError(error, "Couldn't save the contact");
  }

  redirect(`/contacts/${data as string}`);
}
