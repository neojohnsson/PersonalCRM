/**
 * The add and edit contact form: reading it, checking it, and what's sent back
 * when something is wrong.
 *
 * Text is kept as typed — only spaces at either end are removed. The one
 * exception is email addresses, which are lowercased because the database
 * compares and stores them that way.
 */

export const LIMITS = {
  first_name: 100,
  last_name: 100,
  company: 200,
  role: 200,
  one_liner: 300,
  how_known: 1_000,
  phone: 40,
  notes: 10_000,
} as const;

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_EMAILS = 10;

export type TextField = keyof typeof LIMITS;
export const TEXT_FIELDS = Object.keys(LIMITS) as TextField[];

/** What's in the form's inputs, as strings — shown again if saving fails. */
export type ContactValues = Record<TextField, string> & { tags: string; emails: string[] };

/** A checked contact, ready for save_contact. Empty fields are null. */
export type ContactInput = Record<TextField, string | null> & { tags: string[]; emails: string[] };

export type ContactFormErrors = Partial<Record<TextField | "tags" | "emails" | "form", string>>;

export type ParsedContactForm =
  | { ok: true; contact: ContactInput; values: ContactValues }
  | { ok: false; errors: ContactFormErrors; values: ContactValues };

/** What the Server Action hands back to the form: null until something is wrong. */
export type ContactFormState = { errors: ContactFormErrors; values: ContactValues } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().\/-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyContactValues(): ContactValues {
  return {
    first_name: "",
    last_name: "",
    company: "",
    role: "",
    one_liner: "",
    how_known: "",
    phone: "",
    notes: "",
    tags: "",
    emails: [],
  };
}

/** A saved contact as the edit form's starting values. */
export function valuesFromContact(
  contact: Record<TextField, string | null> & { tags: string[] },
  emails: string[],
): ContactValues {
  const values = emptyContactValues();
  for (const field of TEXT_FIELDS) values[field] = contact[field] ?? "";
  values.tags = contact.tags.join(", ");
  values.emails = emails;
  return values;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function readValues(formData: FormData): ContactValues {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };

  const values = emptyContactValues();
  for (const field of TEXT_FIELDS) values[field] = text(field);
  values.tags = text("tags");
  values.emails = formData.getAll("emails").filter((value): value is string => typeof value === "string");
  return values;
}

export function parseContactForm(formData: FormData): ParsedContactForm {
  const values = readValues(formData);
  const errors: ContactFormErrors = {};
  const contact = { tags: [], emails: [] } as unknown as ContactInput;

  for (const field of TEXT_FIELDS) {
    const trimmed = values[field].trim();
    if (trimmed.length > LIMITS[field]) {
      errors[field] = `Keep it under ${LIMITS[field].toLocaleString("en-GB")} characters.`;
    }
    contact[field] = trimmed === "" ? null : trimmed;
  }

  if (contact.phone) {
    const digits = contact.phone.replace(/\D/g, "").length;
    if (!PHONE.test(contact.phone) || digits < 3) {
      errors.phone ??= "Use digits, spaces and + ( ) - only.";
    }
  }

  // Tags: comma-separated, spelled as typed, each once (whatever its case).
  const seenTags = new Set<string>();
  for (const raw of values.tags.split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      errors.tags ??= `Keep each tag under ${MAX_TAG_LENGTH} characters.`;
      continue;
    }
    const key = tag.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    contact.tags.push(tag);
  }
  if (contact.tags.length > MAX_TAGS) errors.tags = `Use at most ${MAX_TAGS} tags.`;

  // Addresses: in the order given (the first is primary), empty rows ignored.
  for (const raw of values.emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 320 || !EMAIL.test(email)) {
      errors.emails ??= `“${raw.trim()}” isn't an email address.`;
      continue;
    }
    if (contact.emails.includes(email)) {
      errors.emails ??= `${email} is listed twice.`;
      continue;
    }
    contact.emails.push(email);
  }
  if (contact.emails.length > MAX_EMAILS) errors.emails = `Use at most ${MAX_EMAILS} addresses.`;

  if (!contact.first_name && !contact.last_name && contact.emails.length === 0 && !errors.emails) {
    errors.form = "Give the contact a name or an email address.";
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors, values }
    : { ok: true, contact, values };
}
