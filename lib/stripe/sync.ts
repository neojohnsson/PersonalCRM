import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/contacts/contact-form";
import { supabaseError } from "@/lib/supabase/errors";
import { planForLookupKey } from "./prices";

/**
 * A Stripe subscription, written into `entitlements` (slice 13, commit 5;
 * docs/slice-13-plan.md §4). Called by the webhook, with the database's owner
 * client, only after Stripe's signature has been checked.
 *
 * The subscription passed in is what Stripe says it is NOW -- the webhook
 * re-reads it rather than trusting the event -- so this sets the row to the
 * truth instead of adding to it. That is what makes an event arriving twice,
 * or late, harmless.
 *
 *   paying    active, trialing, or past_due (a renewal failed and Stripe is
 *             still retrying: the person keeps the plan while it does)
 *   not       anything else -- canceled, unpaid, incomplete, paused: Free.
 *             Nothing is deleted; they only cannot make new AI output.
 */

export type SyncOutcome =
  | { applied: true; userId: string; plan: "free" | "pro" | "premium" }
  | { applied: false; reason: "no_user" | "unknown_user" | "unknown_price" | "older_subscription" };

const PAYING: Stripe.Subscription.Status[] = ["active", "trialing", "past_due"];

export async function applySubscription(admin: SupabaseClient, subscription: Stripe.Subscription): Promise<SyncOutcome> {
  // Who: the id we attached when we made the Checkout page. Checked to be a
  // real account, never trusted as a string.
  const userId = subscription.metadata?.user_id;
  if (typeof userId !== "string" || !isUuid(userId)) return { applied: false, reason: "no_user" };
  const { data: found, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !found?.user) return { applied: false, reason: "unknown_user" };

  // Which plan: from the price's lookup key, looked up in our own table.
  const item = subscription.items.data[0];
  const plan = planForLookupKey(item?.price?.lookup_key);
  if (!plan) return { applied: false, reason: "unknown_price" };

  const paying = PAYING.includes(subscription.status);

  // An event about an OLD subscription must not overwrite a newer one: a
  // cancelled subscription from last month arriving late would otherwise
  // drop somebody who has since paid again back to Free.
  const { data: row, error: readError } = await admin
    .from("entitlements")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle<{ stripe_subscription_id: string | null }>();
  if (readError) throw supabaseError(readError, "Couldn't read the plan");
  const current = row?.stripe_subscription_id ?? null;
  if (current && current !== subscription.id && !paying) return { applied: false, reason: "older_subscription" };

  // In this API version the paid-until date is on the items.
  const periodEnd = Math.max(0, ...subscription.items.data.map((each) => each.current_period_end ?? 0));
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { error } = await admin.from("entitlements").upsert(
    {
      user_id: userId,
      plan: paying ? plan : "free",
      stripe_customer_id: customer,
      stripe_subscription_id: paying ? subscription.id : null,
      current_period_end: paying && periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw supabaseError(error, "Couldn't record the plan");
  return { applied: true, userId, plan: paying ? plan : "free" };
}

/**
 * Checkout finished: when the right-of-withdrawal box was ticked. Stripe will
 * not complete a Checkout without it (consent_collection, lib/stripe/checkout.ts),
 * and this keeps the date it was given. Only this column is written; the plan
 * comes from the subscription.
 */
export async function recordConsent(admin: SupabaseClient, session: Stripe.Checkout.Session): Promise<boolean> {
  const userId = session.client_reference_id;
  if (typeof userId !== "string" || !isUuid(userId) || session.consent?.terms_of_service !== "accepted") return false;
  const { error } = await admin
    .from("entitlements")
    .upsert({ user_id: userId, withdrawal_waived_at: new Date(session.created * 1000).toISOString() }, { onConflict: "user_id" });
  if (error) throw supabaseError(error, "Couldn't record the consent");
  return true;
}
