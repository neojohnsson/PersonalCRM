/** The most addresses one button press may act on. */
export const MAX_FORM_EMAILS = 200;

/**
 * The addresses a Seen once form was submitted for.
 *
 * The queue is one form: every row's checkbox is named "email", and each row's
 * own button sends name="only" with that row's address. So a row button acts
 * on just its row, and the bulk buttons act on everything ticked.
 *
 * A form can be sent by hand with anything in it, so the values are cleaned
 * here — trimmed, lowercased, address-shaped, each once, at most
 * MAX_FORM_EMAILS — and the database functions check again that each address
 * is really in the user's Seen once.
 */
export function emailsFromForm(formData: FormData): string[] {
  const only = formData.getAll("only");
  const values = only.length > 0 ? only : formData.getAll("email");

  const emails = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;

    const email = value.trim().toLowerCase();
    if (email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email)) {
      emails.add(email);
    }
    if (emails.size === MAX_FORM_EMAILS) break;
  }

  return [...emails];
}
