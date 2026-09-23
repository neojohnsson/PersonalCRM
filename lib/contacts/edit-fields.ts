import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import { TEXT_FIELDS, parseContactForm, type ContactFormErrors, type TextField } from "./contact-form";

/**
 * Changing a few of a contact's details, and adding a contact, from somewhere
 * other than the edit form — the Assistant's cards (docs/slice-11b-plan.md).
 *
 * Both go through exactly what the form goes through: parseContactForm for the
 * checks (lengths, what a phone number may contain) and save_contact for the
 * write (migration 0008), which runs as you, so RLS decides whose contact it
 * is. What this adds is the part the form never needed:
 *
 *   - save_contact replaces EVERY field and address at once. A card only knows
 *     the fields it shows, so this reads the contact as it is now and changes
 *     just those.
 *   - a card was drawn a while ago. Each field must still hold the value the
 *     card showed as "before"; if you changed it since, the save is refused
 *     rather than quietly overwriting you. The same check makes Undo exact:
 *     Undo is this with before and after swapped.
 */

/** What a card may change. Not notes or tags (their own logged tools), and not addresses. */
export const EDITABLE_FIELDS = ["first_name", "last_name", "company", "role", "one_liner", "how_known", "phone"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField, string> = {
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  role: "Role",
  one_liner: "One-liner",
  how_known: "How you know them",
  phone: "Phone",
};

/** One field's change: null means empty. */
export type FieldChange = { field: EditableField; before: string | null; after: string | null };

export type EditResult = { ok: true } | { ok: false; error: string };

export class EditContactNotFound extends Error {
  constructor() {
    super("That contact isn't there any more.");
    this.name = "EditContactNotFound";
  }
}

type ContactRow = Record<TextField, string | null> & { tags: string[] };

export function isEditableField(value: unknown): value is EditableField {
  return typeof value === "string" && (EDITABLE_FIELDS as readonly string[]).includes(value);
}

/** Apply `changes` to one contact, if each field still holds its `before`. */
export async function applyFieldChanges(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  changes: FieldChange[],
): Promise<EditResult> {
  if (changes.length === 0) return { ok: false, error: "Nothing to change." };
  if (!changes.every((change) => isEditableField(change.field))) {
    return { ok: false, error: "That detail can only be changed on the contact's own page." };
  }

  const [contactResult, emailsResult] = await Promise.all([
    db
      .from("contacts")
      .select(`${TEXT_FIELDS.join(", ")}, tags`)
      .eq("user_id", userId)
      .eq("id", contactId)
      .maybeSingle<ContactRow>(),
    db
      .from("contact_emails")
      .select("email, is_primary")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false })
      .order("email"),
  ]);
  if (contactResult.error) throw supabaseError(contactResult.error, "Couldn't load the contact");
  if (emailsResult.error) throw supabaseError(emailsResult.error, "Couldn't load the addresses");
  const contact = contactResult.data;
  if (!contact) throw new EditContactNotFound();

  for (const change of changes) {
    if ((contact[change.field] ?? null) !== (change.before ?? null)) {
      return {
        ok: false,
        error: `${FIELD_LABELS[change.field]} has changed since this was offered, so it was left as it is.`,
      };
    }
  }

  // The whole contact as the form would send it, with only these fields different.
  const form = new FormData();
  for (const field of TEXT_FIELDS) form.set(field, contact[field] ?? "");
  for (const change of changes) form.set(change.field, change.after ?? "");
  form.set("tags", contact.tags.join(", "));
  for (const row of emailsResult.data) form.append("emails", row.email as string);

  return save(db, userId, contactId, form);
}

export type NewContact = {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
};

/** Add a contact, as the Add contact form does. Answers with its id. */
export async function addContact(
  db: SupabaseClient,
  userId: string,
  values: NewContact,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!values.first_name?.trim() && !values.last_name?.trim() && !values.email?.trim()) {
    return { ok: false, error: "A contact needs a name or an address." };
  }
  const form = new FormData();
  form.set("first_name", values.first_name ?? "");
  form.set("last_name", values.last_name ?? "");
  form.set("company", values.company ?? "");
  form.set("role", values.role ?? "");
  if (values.email) form.append("emails", values.email);
  return save(db, userId, null, form);
}

async function save(db: SupabaseClient, userId: string, contactId: string, form: FormData): Promise<EditResult>;
async function save(
  db: SupabaseClient,
  userId: string,
  contactId: null,
  form: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
async function save(db: SupabaseClient, userId: string, contactId: string | null, form: FormData) {
  const parsed = parseContactForm(form);
  if (!parsed.ok) return { ok: false, error: firstError(parsed.errors) };

  const { emails, ...fields } = parsed.contact;
  const { data, error } = await db.rpc("save_contact", {
    p_user_id: userId,
    p_contact_id: contactId,
    p_contact: fields,
    p_emails: emails,
  });
  if (error) {
    if (error.message === "address_taken") {
      return { ok: false, error: `${error.details} already belongs to ${error.hint}.` };
    }
    if (error.code === "P0002") throw new EditContactNotFound();
    throw supabaseError(error, "Couldn't save the contact");
  }
  return contactId === null ? { ok: true, id: data as string } : { ok: true };
}

function firstError(errors: ContactFormErrors): string {
  const [field, message] = Object.entries(errors)[0] ?? [];
  if (!field) return "That couldn't be saved.";
  return isEditableField(field) ? `${FIELD_LABELS[field]}: ${message}` : String(message);
}
