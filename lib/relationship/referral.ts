import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "@/lib/contacts/display";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";

/**
 * Have you already done what a referral asked? (plan.md §3.4)
 *
 * "Martin referred you to Niklas Hedlund." The AI only picked out the name —
 * and an address, if the email gave one. This file decides, with no AI and
 * nothing sent anywhere, whether you've written to that person since:
 *
 *   1. Who is it? Everyone in your contacts and synced mail who matches:
 *        - the address from the email, exactly
 *        - a contact's name, or the name on their emails, exactly
 *          (ignoring case and accents: "niklas hedlund" = "Niklas Hedlund")
 *        - an address made of the name: niklas.hedlund@, niklashedlund@,
 *          hedlund.niklas@ — Gmail doesn't keep the name of someone who has
 *          only been written to, so without this they'd never be found
 *        - a first name on its own ("Pontus"), matching a first name or the
 *          first part of an address. Common, so it often finds two people —
 *          and then the caller says so rather than guessing
 *   2. One person → did you send them an email after the referral?
 *      Several → say so and don't guess. Nobody → nothing to check.
 *
 * Addresses of one contact count as one person.
 */

export type Referral = { name: string; email: string | null; since: string };

export type ReferralStatus =
  | { kind: "done"; at: string; contactId: string | null; label: string }
  | { kind: "open"; contactId: string | null; label: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "unknown" };

export type ContactCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  emails: string[];
};

export type AddressCandidate = { email: string; name: string | null };

/** A person the referral could mean: a contact, or an address that isn't one. */
export type Match = { contactId: string | null; label: string; emails: string[] };

/** Lowercase letters and digits only, accents removed: "Östen Å.-Berg" → "ostenaberg". */
export function normaliseName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Whether an address is built from the name: first.last, firstlast, last.first.
 * For a single word ("Pontus"), the address must *start* with it as its own
 * part: pontus@ or pontus.berglund@, never pontusson@.
 */
export function addressMatchesName(email: string, name: string): boolean {
  const local = email.slice(0, email.lastIndexOf("@"));
  const words = name.trim().split(/\s+/).map(normaliseName).filter(Boolean);
  if (words.length === 0) return false;

  if (words.length === 1) {
    const [first] = local.toLowerCase().split(/[._+-]/);
    return normaliseName(first ?? "") === words[0];
  }

  const whole = normaliseName(local);
  return whole === words.join("") || whole === [...words].reverse().join("");
}

/** Whether a contact's or sender's name starts with this single first name. */
function firstNameMatches(fullName: string | null, wantedWords: string[]): boolean {
  if (wantedWords.length !== 1 || !fullName) return false;
  const [first] = fullName.trim().split(/\s+/);
  return normaliseName(first ?? "") === wantedWords[0];
}

/** Everyone the referral could mean, one entry per person. */
export function matchPeople(
  referral: Pick<Referral, "name" | "email">,
  contacts: ContactCandidate[],
  addresses: AddressCandidate[],
): Match[] {
  const wantedName = normaliseName(referral.name);
  const wantedWords = referral.name.trim().split(/\s+/).map(normaliseName).filter(Boolean);
  const wantedEmail = referral.email?.trim().toLowerCase() || null;

  const addressMatches = (email: string, nameOnMail: string | null) =>
    (wantedEmail !== null && email.toLowerCase() === wantedEmail) ||
    (wantedName !== "" && nameOnMail !== null && normaliseName(nameOnMail) === wantedName) ||
    firstNameMatches(nameOnMail, wantedWords) ||
    addressMatchesName(email, referral.name);

  const namesOnMail = new Map(addresses.map((a) => [a.email.toLowerCase(), a.name]));
  const contactOf = new Map<string, ContactCandidate>();
  for (const contact of contacts) for (const email of contact.emails) contactOf.set(email.toLowerCase(), contact);

  const matches = new Map<string, Match>();

  for (const contact of contacts) {
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    const byName =
      (wantedName !== "" && fullName !== "" && normaliseName(fullName) === wantedName) ||
      firstNameMatches(contact.first_name, wantedWords);
    const byAddress = contact.emails.some((email) => addressMatches(email, namesOnMail.get(email.toLowerCase()) ?? null));
    if (byName || byAddress) {
      matches.set(`contact:${contact.id}`, {
        contactId: contact.id,
        label: displayName(contact),
        emails: contact.emails.map((email) => email.toLowerCase()),
      });
    }
  }

  for (const { email, name } of addresses) {
    const key = email.toLowerCase();
    if (contactOf.has(key)) continue; // counted with its contact above
    if (addressMatches(key, name)) matches.set(`address:${key}`, { contactId: null, label: name ?? key, emails: [key] });
  }

  return [...matches.values()];
}

/** Look up who the referral means, and whether you've written to them since. */
export async function checkReferral(db: SupabaseClient, userId: string, referral: Referral): Promise<ReferralStatus> {
  const [contacts, addresses] = await Promise.all([
    readAll<ContactCandidate>(
      (from, to) =>
        db
          .from("contact_list")
          .select("id, first_name, last_name, primary_email, emails")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contacts",
    ),
    readAll<AddressCandidate>(
      (from, to) => db.from("people").select("email, name").eq("user_id", userId).order("email").range(from, to),
      "Couldn't load people",
    ),
  ]);

  const matches = matchPeople(referral, contacts, addresses);
  if (matches.length === 0) return { kind: "unknown" };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };

  const [person] = matches;
  const list = person.emails.map((email) => `"${email.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");

  const { data, error } = await db
    .from("gmail_messages")
    .select("internal_date")
    .eq("user_id", userId)
    .eq("direction", "outbound")
    .gt("internal_date", referral.since)
    .or(`to_emails.ov.{${list}},cc_emails.ov.{${list}}`)
    .order("internal_date", { ascending: true })
    .limit(1);
  if (error) throw supabaseError(error, "Couldn't check your mail to them");

  return data.length > 0
    ? { kind: "done", at: data[0].internal_date, contactId: person.contactId, label: person.label }
    : { kind: "open", contactId: person.contactId, label: person.label };
}
