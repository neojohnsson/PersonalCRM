/** The most addresses one button press may act on. */
export const MAX_FORM_EMAILS = 200;

/**
 * The addresses a Seen once button was pressed for.
 *
 * The queue is one form, and every row's checkbox is named "email". A row's own
 * button is bound to its row's address (`action.bind(null, email)`), which
 * arrives here as `only` — so it acts on just that row. The bulk buttons are
 * bound to null, and act on everything ticked.
 *
 * (Not a name="only" on the button: React reserves a button's name when its
 * formAction is a function, and would overwrite it.)
 *
 * A form can be sent by hand with anything in it, so the values are cleaned
 * here — trimmed, lowercased, address-shaped, each once, at most
 * MAX_FORM_EMAILS — and the database functions check again that each address
 * is really in the user's Seen once.
 */
export function emailsFromForm(formData: FormData, only: string | null = null): string[] {
  const values = only !== null ? [only] : formData.getAll("email");

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
