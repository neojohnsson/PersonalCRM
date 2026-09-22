/**
 * Names that look like a mail log (docs/slice-9b-plan.md, Part 5).
 *
 * Eleven of the twenty-five contacts in the first real test of this app showed
 * as a bare address, and several as "Jönsson Linda" — the Outlook and
 * municipality style, surname first. Meanwhile the AI summary on the same page
 * wrote "Follow up with Björn" about a contact called
 * `bjorn.andersson@nordlo.com`. The app knew the name and showed the log.
 *
 * Both fixes are SUGGESTIONS. Nothing here writes anything: a guessed name
 * saved on its own is exactly what plan.md §5.2 warns about, and a name is how
 * you recognise a person — getting it wrong silently is worse than showing the
 * address.
 *
 * Every suggestion needs evidence in the address, never a dictionary of first
 * names. "Jönsson Linda" with no matching address stays as it is: a list of
 * common given names would make the app confident about strangers, and it
 * would be confidently wrong about every name not on the list, which in
 * Sweden is most of them.
 *
 *   swap           first and last are the wrong way round, and the address
 *                  proves it: linda.jonsson@… against "Jönsson Linda"
 *   from_address   no name at all, and the address is first.last@…
 */

export type NameSuggestion = {
  kind: "swap" | "from_address";
  first: string;
  last: string;
  /** Why, in the words the page shows. */
  why: string;
};

/** The longest either part may be, as the contact form allows (contact-form.ts). */
const MAX_PART = 100;

/**
 * Words that are a job, a desk or a robot rather than a person. `info.kontakt@`
 * is not "Info Kontakt", and a contact page saying so would be worse than the
 * address it replaced.
 */
const NOT_A_NAME = new Set([
  "info",
  "kontakt",
  "contact",
  "support",
  "kundtjanst",
  "kundservice",
  "noreply",
  "no",
  "reply",
  "donotreply",
  "post",
  "mail",
  "email",
  "admin",
  "office",
  "kansli",
  "registrator",
  "reception",
  "faktura",
  "invoice",
  "order",
  "orders",
  "sales",
  "press",
  "media",
  "jobb",
  "jobs",
  "career",
  "careers",
  "hr",
  "it",
  "webmaster",
  "postmaster",
  "hello",
  "hej",
  "team",
  "group",
  "news",
  "newsletter",
  "notifications",
  "notification",
  "service",
  "helpdesk",
  "expedition",
  "diarium",
  "arkiv",
]);

export function suggestName(contact: {
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
}): NameSuggestion | null {
  const local = localPart(contact.primary_email);
  if (!local) return null;

  const first = contact.first_name?.trim() ?? "";
  const last = contact.last_name?.trim() ?? "";

  if (!first && !last) return fromAddress(local);
  return swapped(first, last, local);
}

/**
 * The bit before the @, lower-cased, without a +tag, or null when there is no
 * address. A +tag is an addressing trick, never part of a name.
 */
function localPart(email: string | null): string | null {
  const address = email?.trim().toLowerCase() ?? "";
  const at = address.indexOf("@");
  if (at <= 0) return null;
  return address.slice(0, at).split("+")[0];
}

/**
 * The words of a local part. Split on dot and underscore only: a hyphen is
 * part of the name far more often than it separates two ("carl-johan.h@"), and
 * a suggestion that turns Anna-Lena into two people is worse than none.
 */
function words(local: string): string[] {
  return local.split(/[._]/).filter(Boolean);
}

/**
 * "Jönsson Linda" against linda.jonsson@… — the address says which is the
 * given name, so the two are the wrong way round.
 *
 * Both names must be single words: "Anna Maria Ek" is stored as
 * "Anna Maria" / "Ek" and swapping that produces nonsense.
 */
function swapped(first: string, last: string, local: string): NameSuggestion | null {
  if (!first || !last) return null;
  if (/\s/.test(first) || /\s/.test(last)) return null;

  const a = fold(first);
  const b = fold(last);
  if (!a || !b || a === b) return null;

  // Folded as the names are, so "carl-johan.h@" and "Carl-Johan" agree.
  const parts = words(local).map(fold);
  const looksSwapped =
    // linda.jonsson@ — the address starts with what is stored as the surname
    (parts.length > 1 && parts[0] === b && parts.slice(1).join("") === a) ||
    // lindajonsson@ — one word, but it begins with one name and ends with the other
    (parts.length === 1 && parts[0] === `${b}${a}`);

  if (!looksSwapped) return null;

  return {
    kind: "swap",
    first: last,
    last: first,
    why: "Their address puts the given name first, so these look the wrong way round.",
  };
}

/** first.last@ — two words, neither of them a desk. */
function fromAddress(local: string): NameSuggestion | null {
  const parts = words(local);
  if (parts.length !== 2) return null;

  const [first, last] = parts;
  for (const part of parts) {
    if (part.length < 2 || part.length > MAX_PART) return null;
    // Letters only: k.andersson2@ and firstname.l@ are not names to show.
    if (!/^[\p{L}\p{M}'’-]+$/u.test(part)) return null;
    if (NOT_A_NAME.has(part)) return null;
  }

  return {
    kind: "from_address",
    first: capitalise(first),
    last: capitalise(last),
    why: "Guessed from their address. Check it before you keep it.",
  };
}

/** Diacritics off and lower case, because an address writes Jönsson "jonsson". */
function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");
}

/** "pär" → "Pär", "o'brien" → "O'Brien", "anna-lena" → "Anna-Lena". */
function capitalise(word: string): string {
  return word.replace(/(^|[-'’])(\p{L})/gu, (_, boundary: string, letter: string) => boundary + letter.toUpperCase());
}
