/**
 * What a contact is called on screen: "First Last", or whichever of the two
 * exists, or their address, or "Unnamed contact" when there's nothing at all.
 */
export function displayName(contact: {
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
}): string {
  const name = [contact.first_name, contact.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return name || contact.primary_email || "Unnamed contact";
}
