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

export type FilterReason = "automated-address" | "list-unsubscribe" | "calendar" | "dismissed";

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
  message: Pick<MessageRow, "direction" | "from_email" | "has_list_unsubscribe">,
  dismissed: ReadonlySet<string> = new Set(),
): FilterReason | null {
  if (message.direction === "outbound") return null;

  const from = message.from_email.trim().toLowerCase();

  if (dismissed.has(from)) return "dismissed";
  if (CALENDAR_SENDERS.has(from)) return "calendar";
  if (isAutomatedAddress(from)) return "automated-address";
  if (message.has_list_unsubscribe) return "list-unsubscribe";

  return null;
}
