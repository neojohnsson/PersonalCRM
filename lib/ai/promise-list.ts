import type { SupabaseClient } from "@supabase/supabase-js";
import { messageText } from "@/lib/google/body";
import { getMessageFull } from "@/lib/google/gmail";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * The promises waiting to be decided, with the message each one came from
 * (docs/slice-6d-plan.md, Part 6).
 *
 * The message is read from Gmail as the page loads and is never stored: it is
 * verbatim message text, and bodies are not kept (AGENTS.md). That read is also
 * the point of the screen — the model's own line is a claim, and the words in
 * the message are what you judge it by. Negation is the failure this feature is
 * most likely to have (plan.md §5.3), and it is only catchable by eye.
 *
 * A message Gmail no longer has leaves the row with no text and says so, rather
 * than hiding the promise: you can still dismiss it.
 */

export type PendingPromise = {
  id: string;
  contactId: string;
  name: string;
  company: string | null;
  primaryEmail: string | null;
  threadId: string;
  messageId: string;
  owedBy: "you" | "them";
  dueOn: string;
  reason: string;
  /** The message it was found in, read live. Null when Gmail no longer has it. */
  text: string | null;
};

type PromiseRow = {
  id: string;
  contact_id: string;
  thread_id: string;
  message_id: string;
  owed_by: "you" | "them";
  due_on: string;
  reason: string;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
};

/** How much of a message the screen shows before it becomes a wall of text. */
export const MAX_SHOWN_CHARS = 1_200;

export async function loadPendingPromises(
  db: SupabaseClient,
  userId: string,
  accessToken: string | null,
  displayName: (contact: ContactRow) => string,
): Promise<PendingPromise[]> {
  const { data: rows, error } = await db
    .from("promises")
    .select("id, contact_id, thread_id, message_id, owed_by, due_on, reason")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_on")
    .limit(100)
    .returns<PromiseRow[]>();
  if (error) throw supabaseError(error, "Couldn't load the promises");
  if (rows.length === 0) return [];

  const { data: contacts, error: contactsError } = await db
    .from("contact_list")
    .select("id, first_name, last_name, company, primary_email")
    .eq("user_id", userId)
    .in("id", [...new Set(rows.map((row) => row.contact_id))])
    .returns<ContactRow[]>();
  if (contactsError) throw supabaseError(contactsError, "Couldn't load the contacts");

  const byId = new Map(contacts.map((contact) => [contact.id, contact]));

  // One Gmail read per distinct message, in parallel. A failure is not fatal:
  // the row still shows, with nothing to read.
  const texts = new Map<string, string | null>();
  if (accessToken) {
    const ids = [...new Set(rows.map((row) => row.message_id))];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const message = await getMessageFull(accessToken, id);
          texts.set(id, messageText(message.payload).slice(0, MAX_SHOWN_CHARS) || null);
        } catch {
          texts.set(id, null);
        }
      }),
    );
  }

  return rows
    .map((row) => {
      const contact = byId.get(row.contact_id);
      if (!contact) return null;
      return {
        id: row.id,
        contactId: row.contact_id,
        name: displayName(contact),
        company: contact.company,
        primaryEmail: contact.primary_email,
        threadId: row.thread_id,
        messageId: row.message_id,
        owedBy: row.owed_by,
        dueOn: row.due_on,
        reason: row.reason,
        text: texts.get(row.message_id) ?? null,
      };
    })
    .filter((promise): promise is PendingPromise => promise !== null);
}

/** For the line on the brief, without reading any mail. */
export async function countPendingPromises(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("promises")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw supabaseError(error, "Couldn't count the promises");
  return count ?? 0;
}
