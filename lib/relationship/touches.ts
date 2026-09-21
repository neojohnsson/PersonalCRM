import { isAutoReplySubject } from "@/lib/google/filter";

/**
 * A "touch" is one message between you and a contact — the raw material for
 * whose turn it is and for warmth (docs/slice-3-plan.md, Parts 1 and 2).
 */

export type Direction = "inbound" | "outbound";

export type Touch = {
  messageId: string;
  threadId: string;
  direction: Direction;
  at: Date;
  subject: string | null;
};

/** The gmail_messages columns needed to find touches. */
export type StoredMessage = {
  gmail_message_id: string;
  thread_id: string;
  direction: Direction;
  internal_date: string;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
};

/** One of a contact's addresses (contact_emails). */
export type ContactAddress = { contact_id: string; email: string };

/**
 * Every contact's touches, oldest first.
 *
 * A message is a touch with a contact when:
 *   - they sent it, from any of their addresses, or
 *   - you sent it, with any of their addresses in To or Cc.
 *
 * Mail someone else sent, with the contact only on Cc, is not a touch: the
 * contact didn't write it and you didn't write to them. A message to two of a
 * contact's addresses counts once.
 */
export function touchesByContact(
  messages: StoredMessage[],
  addresses: ContactAddress[],
): Map<string, Touch[]> {
  const contactByEmail = new Map<string, string>();
  for (const { contact_id, email } of addresses) {
    contactByEmail.set(email.toLowerCase(), contact_id);
  }

  const touches = new Map<string, Touch[]>();

  for (const message of messages) {
    // An out-of-office already in the database still is not a person writing
    // to you (slice 9a). The sync stops storing these, but mail read before
    // that change is still here, and re-syncing would not remove it — so the
    // subject rule is applied again where touches are counted. That makes the
    // fix retroactive for nothing: no re-sync, and no mail deleted.
    if (message.direction === "inbound" && isAutoReplySubject(message.subject)) continue;

    const contacts = new Set<string>();

    if (message.direction === "inbound") {
      const contact = contactByEmail.get(message.from_email.toLowerCase());
      if (contact) contacts.add(contact);
    } else {
      for (const email of [...message.to_emails, ...message.cc_emails]) {
        const contact = contactByEmail.get(email.toLowerCase());
        if (contact) contacts.add(contact);
      }
    }

    for (const contact of contacts) {
      const list = touches.get(contact) ?? [];
      list.push({
        messageId: message.gmail_message_id,
        threadId: message.thread_id,
        direction: message.direction,
        at: new Date(message.internal_date),
        subject: message.subject,
      });
      touches.set(contact, list);
    }
  }

  for (const list of touches.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  return touches;
}
