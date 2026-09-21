import type { MessageRow } from "@/lib/google/parse";

/**
 * Which incoming messages the sync never stores (slice-2-plan.md, decision A).
 *
 * The rules look at the sender and the headers already read — never the body.
 * Each rule is conservative on purpose: a real person filtered out is never
 * seen anywhere, so a newsletter that slips through (and is dismissed by hand)
 * is the cheaper mistake.
 *
 * Mail you sent is never filtered: it's yours.
 */

export type FilterReason =
  | "automated-address"
  | "list-unsubscribe"
  | "calendar"
  | "dismissed"
  | "auto-reply";

/**
 * Local parts that only machines use. Matched at the start of the local part,
 * followed by the end or a separator — so "noreply", "no-reply-aws",
 * "notifications" and "bounces+123" match, but "notificationsteam" doesn't.
 *
 * Left out on purpose: "info", "hello", "contact", "support" — at small
 * companies those are read and answered by a real person.
 */
const AUTOMATED_LOCAL_PART =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?|notifications?)(?=$|[-_.+])/;

/** Calendar systems that send invites and updates from their own addresses. */
const CALENDAR_SENDERS = new Set(["calendar-notification@google.com"]);

/**
 * An out-of-office is not a person writing to you (added 2026-09-21, after the
 * first outside test of the app).
 *
 * Two "Autosvar:" replies from real municipal addresses had become contacts,
 * taken **Your turn · today**, and scored warmth 35 — above real people. The
 * address rules above could never catch them: the sender really is a person's
 * address, and the mailbox really did send the message.
 *
 * Detected two ways, because they cost different amounts:
 *
 *   the subject   works on mail already stored, with no re-sync
 *   the headers   the correct way, but only for mail read after this change
 *
 * An auto-reply is not stored at all, like a newsletter, which is what keeps it
 * from flipping the turn, making a contact or counting toward warmth. The
 * message is still in Gmail; this app simply does not keep a copy.
 */

/**
 * Subject prefixes, Swedish and English.
 *
 * The prefix has to be a *label*: at the start of the subject, and followed by
 * a colon or nothing else. That is what separates a machine's answer from a
 * person's sentence, and my first attempt got both of these wrong —
 *
 *   "Autosvar: Förfrågan"            a machine, caught
 *   "Autosvar hantering i Outlook"   a person writing about auto-replies, kept
 *   "Automatiseringsprojektet"       a project, kept
 *   "Frånvarorapport för augusti"    a report, kept
 *   "Auto: your message received"    a machine, caught
 *
 * — which is exactly the trap the Swedish negation list fell into in 6d: a
 * prefix is not a word. An optional "Re:" is allowed, because a threaded
 * auto-reply is still an auto-reply.
 */
const AUTO_REPLY_SUBJECT =
  /^\s*(re\s*:\s*)?(automatiskt\s+genererat\s+svar|automatiskt\s+svar|automatic\s+reply|out\s+of\s+office|ej\s+på\s+kontoret|frånvaro(smeddelande)?|autosvar|auto\s*reply|auto)(?=\s*:|\s*$)/i;

/** Headers a mail server sets when a machine answered. */
const AUTO_SUBMITTED_OK = new Set(["no", ""]);
const AUTO_PRECEDENCE = new Set(["auto_reply", "bulk", "junk"]);

export function isAutoReplySubject(subject: string | null | undefined): boolean {
  return AUTO_REPLY_SUBJECT.test(subject ?? "");
}

/**
 * `headers` as Gmail hands them over. Absent headers mean "we cannot tell",
 * which is not the same as "no" — the subject rule still applies.
 */
export function isAutoReplyHeaders(
  headers: { name: string; value: string }[] | undefined,
): boolean {
  const value = (name: string) =>
    headers?.find((header) => header.name.toLowerCase() === name)?.value?.trim().toLowerCase();

  const submitted = value("auto-submitted");
  if (submitted !== undefined && !AUTO_SUBMITTED_OK.has(submitted)) return true;

  const precedence = value("precedence");
  if (precedence !== undefined && AUTO_PRECEDENCE.has(precedence)) return true;

  return value("x-autoreply") !== undefined || value("x-autorespond") !== undefined;
}

export function isAutomatedAddress(email: string): boolean {
  const localPart = email.trim().toLowerCase().split("@")[0] ?? "";
  return AUTOMATED_LOCAL_PART.test(localPart);
}

/**
 * Why the sync should skip this message, or null to keep it.
 *
 * `dismissed` holds the addresses the user dismissed from Seen once, lowercased.
 */
export function filterReason(
  message: Pick<MessageRow, "direction" | "from_email" | "has_list_unsubscribe" | "subject">,
  dismissed: ReadonlySet<string> = new Set(),
  /** Gmail's headers for this message, when the caller has them to hand. */
  headers?: { name: string; value: string }[],
): FilterReason | null {
  if (message.direction === "outbound") return null;

  const from = message.from_email.trim().toLowerCase();

  if (dismissed.has(from)) return "dismissed";
  if (CALENDAR_SENDERS.has(from)) return "calendar";
  if (isAutomatedAddress(from)) return "automated-address";
  if (message.has_list_unsubscribe) return "list-unsubscribe";
  if (isAutoReplySubject(message.subject) || isAutoReplyHeaders(headers)) return "auto-reply";

  return null;
}
