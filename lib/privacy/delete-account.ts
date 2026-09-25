import type { RevokeResult } from "@/lib/google/tokens";
import type { EndResult } from "@/lib/stripe/end-subscription";

/**
 * "Delete everything", in order (slice 13, commit 6b; docs/privacy.md).
 *
 * Three of the steps happen OUTSIDE our database and cannot be undone: a token
 * Google has revoked stays revoked, a subscription Stripe has cancelled stays
 * cancelled. So every outside step goes first, and the rows are deleted only
 * when all of them have succeeded. If one fails, nothing is deleted, and the
 * answer says what was already done -- pressing Delete again finishes the
 * job, because "already gone" counts as done at every step.
 *
 *   1. Gmail      revoked at Google
 *   2. Calendar   revoked at Google
 *   3. Stripe     the paid plan ended. Last of the three, because it is the
 *                 costliest to redo: reconnecting is a click, subscribing
 *                 again is a payment
 *   4. the rows   every one of them (delete_account, migration 0021)
 *
 * Kept apart from the Server Action so a test can hand it fake steps.
 */

export type DeleteSteps = {
  revokeGmail: () => Promise<RevokeResult>;
  revokeCalendar: () => Promise<RevokeResult>;
  endSubscription: () => Promise<EndResult>;
  deleteRows: () => Promise<void>;
};

export type DeleteOutcome =
  | { deleted: true }
  | { deleted: false; stoppedAt: "gmail" | "calendar" | "subscription"; done: ("gmail" | "calendar")[] };

export async function deleteEverything(steps: DeleteSteps): Promise<DeleteOutcome> {
  if ((await steps.revokeGmail()) === "failed") return { deleted: false, stoppedAt: "gmail", done: [] };
  if ((await steps.revokeCalendar()) === "failed") return { deleted: false, stoppedAt: "calendar", done: ["gmail"] };
  if ((await steps.endSubscription()) === "failed") {
    return { deleted: false, stoppedAt: "subscription", done: ["gmail", "calendar"] };
  }
  await steps.deleteRows();
  return { deleted: true };
}

/** What to tell the person when it stopped, and what they can do. */
export function stoppedMessage(outcome: Extract<DeleteOutcome, { deleted: false }>): string {
  const already =
    outcome.done.length === 0
      ? ""
      : ` Already done: the ${outcome.done.map((step) => (step === "gmail" ? "Gmail" : "Calendar")).join(" and ")} permission is withdrawn at Google.`;
  const why = {
    gmail:
      "Google didn't confirm that the Gmail connection was removed, so nothing has been deleted. Try again, or remove this app at myaccount.google.com/permissions and then delete.",
    calendar:
      "Google didn't confirm that the Calendar connection was removed, so nothing has been deleted. Try again, or remove this app at myaccount.google.com/permissions and then delete.",
    subscription:
      "Stripe didn't confirm that your paid plan was cancelled, so nothing has been deleted and you won't be left paying for an account that is gone. Try again, or cancel with Manage or cancel on your profile and then delete.",
  }[outcome.stoppedAt];
  return why + already;
}
