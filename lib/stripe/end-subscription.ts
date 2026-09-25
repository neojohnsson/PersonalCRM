import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * End a paid plan now, because the account is being deleted (slice 13,
 * commit 6b). No refund of the rest of the month (decided with the user
 * 2026-09-25); the Delete panel says so before anyone confirms.
 *
 *   cancelled   Stripe has ended it
 *   none        nothing to end: no subscription, one Stripe has never heard
 *               of, or one already over
 *   failed      anything we could not confirm -- including no Stripe key on
 *               this server while a subscription exists. "Probably fine" is
 *               not good enough when the alternative is charging somebody
 *               whose account is gone
 */

export type EndResult = "cancelled" | "none" | "failed";

type SubscriptionsApi = {
  retrieve: (id: string) => Promise<Stripe.Subscription>;
  cancel: (id: string) => Promise<Stripe.Subscription>;
};

const OVER: Stripe.Subscription.Status[] = ["canceled", "incomplete_expired"];

export async function endSubscription(
  db: SupabaseClient,
  userId: string,
  subscriptions: () => SubscriptionsApi,
): Promise<EndResult> {
  // Read as the user: RLS lets you read your own plan row, nobody else's.
  const { data, error } = await db
    .from("entitlements")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle<{ stripe_subscription_id: string | null }>();
  if (error) return "failed";
  const id = data?.stripe_subscription_id;
  if (!id) return "none";

  try {
    const api = subscriptions();
    let current: Stripe.Subscription;
    try {
      current = await api.retrieve(id);
    } catch (failure) {
      if ((failure as { code?: string }).code === "resource_missing") return "none";
      throw failure;
    }
    if (OVER.includes(current.status)) return "none";
    await api.cancel(id);
    return "cancelled";
  } catch {
    return "failed";
  }
}
