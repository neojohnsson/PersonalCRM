import type { SupabaseClient } from "@supabase/supabase-js";
import { messageText } from "@/lib/google/body";
import { getMessageFull, type GmailHeader } from "@/lib/google/gmail";
import { latestThread, loadThreadMessages, recipientsOf, writerOf, type ThreadItem } from "@/lib/ai/thread";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * What a reply needs: the latest thread with a contact, its text, and the
 * headers that make Gmail file the reply in that same conversation
 * (docs/slice-5a-plan.md, Part 3).
 *
 * Mail clients thread a reply by three things:
 *   Subject      "Re: …"
 *   In-Reply-To  the Message-ID of the message being answered
 *   References   the Message-IDs of the thread so far, oldest first
 *
 * Gmail also takes its own threadId, but those headers are what other clients
 * read — and what keeps your reply from starting a new conversation in the
 * recipient's inbox.
 */

/** How many of the thread's newest messages the model reads. */
export const REPLY_MESSAGES = 10;

export type ReplyMessage = {
  ref: string;
  messageId: string;
  from: "you" | "them" | "other";
  /** For "other": who wrote it. */
  who: string | null;
  /** Who it went to and who was copied (lib/ai/thread.ts). */
  to: string[];
  cc: string[];
  at: Date;
  text: string;
};

export type ReplyContext = {
  threadId: string;
  /** Who the reply goes to: the address they wrote from, or their primary one. */
  to: string;
  /** The reply's subject, already "Re:"-prefixed. */
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  /** The thread's newest messages, oldest first. */
  messages: ReplyMessage[];
  /** Who wrote last in the thread. */
  lastFrom: "you" | "them" | "other";
};

/** No thread to reply to: no stored mail with this contact. */
export class NoThreadToReplyTo extends Error {
  constructor() {
    super("There's no mail with this contact to reply to.");
    this.name = "NoThreadToReplyTo";
  }
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const wanted = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === wanted)?.value?.trim() || null;
}

/** "Re: Examensarbete", and never "Re: Re: …". */
export function replySubject(subject: string | null): string {
  const clean = subject?.trim() || "";
  if (!clean) return "Re:";
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

/**
 * The References header of the reply: what the answered message already
 * referenced, plus its own Message-ID. Ids appear once, in order.
 */
export function buildReferences(existing: string | null, messageId: string | null): string | null {
  const ids = [...(existing ?? "").split(/\s+/), messageId ?? ""].filter((id) => id.startsWith("<") && id.endsWith(">"));
  const once = [...new Set(ids)];
  return once.length > 0 ? once.join(" ") : null;
}

/**
 * Everything a draft reply needs, read from Gmail for this one request. The
 * message text is never stored (same rule as summaries; lib/ai/conversation.ts).
 */
export async function loadReplyContext(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  accessToken: string,
  options: { limit?: number } = {},
): Promise<ReplyContext> {
  // The whole latest thread, including anyone else in it: a reply has to answer
  // the conversation as it stands (docs/thread-context-plan.md, Part 1).
  const all = await loadThreadMessages(db, userId, contactId);
  if (all.length === 0) throw new NoThreadToReplyTo();

  const whole = latestThread(all).sort((a, b) => a.at.getTime() - b.at.getTime());
  const newest = whole[whole.length - 1];
  const thread = whole.slice(-(options.limit ?? REPLY_MESSAGES));

  const addresses = await contactAddresses(db, userId, contactId);

  const messages: ReplyMessage[] = [];
  let answered: { to: string | null; messageId: string | null; references: string | null; subject: string | null } = {
    to: null,
    messageId: null,
    references: null,
    subject: newest.subject,
  };

  for (const item of thread) {
    const message = await getMessageFull(accessToken, item.messageId);
    const headers = message.payload?.headers;
    messages.push({
      ref: `m${messages.length + 1}`,
      messageId: item.messageId,
      from: item.from,
      who: item.who,
      to: item.to,
      cc: item.cc,
      at: item.at,
      text: messageText(message.payload),
    });

    // The reply goes to the contact — the address they last wrote from. The
    // headers that thread it come from the last message, whoever wrote it.
    answered = {
      to: item.from === "them" ? replyToAddress(headers) : answered.to,
      messageId: headerValue(headers, "Message-ID"),
      references: headerValue(headers, "References"),
      subject: headerValue(headers, "Subject") ?? answered.subject,
    };
  }

  if (messages.length === 0) throw new NoThreadToReplyTo();

  // Their address from the thread, or their primary one if they never wrote in it.
  // Slice 5a replies to the contact only: anyone else on Cc is left out, and a
  // comment on the draft panel says so.
  const to = answered.to ?? addresses[0] ?? null;
  if (!to) throw new NoThreadToReplyTo();

  return {
    threadId: newest.threadId,
    to,
    subject: replySubject(answered.subject),
    inReplyTo: answered.messageId,
    references: buildReferences(answered.references, answered.messageId),
    messages,
    lastFrom: thread[thread.length - 1].from,
  };
}

/** Reply-To if the sender asked for one, otherwise the address it came from. */
function replyToAddress(headers: GmailHeader[] | undefined): string | null {
  const raw = headerValue(headers, "Reply-To") ?? headerValue(headers, "From");
  if (!raw) return null;
  const inBrackets = /<([^>]+)>/.exec(raw);
  return (inBrackets ? inBrackets[1] : raw).trim().toLowerCase() || null;
}

async function contactAddresses(db: SupabaseClient, userId: string, contactId: string): Promise<string[]> {
  const { data, error } = await db
    .from("contact_emails")
    .select("email")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .order("is_primary", { ascending: false })
    .order("email");
  if (error) throw supabaseError(error, "Couldn't load the contact's addresses");
  return data.map((row) => row.email as string);
}

/** Used by the drafting prompt and by the Gmail draft: the thread as text. */
export function replyThreadText(context: ReplyContext): string {
  return context.messages
    .map((message) =>
      [
        `[${message.ref}] ${message.at.toISOString().slice(0, 10)} · from ${writerOf(message)}${recipientsOf(message)}`,
        message.text || "(no text)",
      ].join("\n"),
    )
    .join("\n\n");
}

/** The thread a reply would answer, oldest first. */
export function latestThreadOf(items: ThreadItem[]): ThreadItem[] {
  return latestThread(items).sort((a, b) => a.at.getTime() - b.at.getTime());
}
