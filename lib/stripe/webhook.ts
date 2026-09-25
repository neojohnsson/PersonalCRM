import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySubscription, recordConsent, type SyncOutcome } from "./sync";

/**
 * One call from Stripe to app/api/stripe/webhook/route.ts (slice 13, commit 5;
 * docs/slice-13-plan.md §4). Kept apart from the route so the tests can run
 * it with a fake Stripe and the real database.
 *
 * In order, and nothing moves before step 1 has passed:
 *
 *   1. THE SIGNATURE. Anyone on the internet can POST to our URL. Stripe
 *      signs each call with a secret only Stripe and this server know
 *      (STRIPE_WEBHOOK_SECRET); constructEvent recomputes it from the exact
 *      bytes received and refuses a mismatch -- a forged call, an altered
 *      body, a replay from long ago. Refused: 400, and not one row read.
 *   2. RE-READ. For anything about a subscription, ask Stripe what it is
 *      now, rather than trusting what the event carried. Events can come
 *      twice or out of order; the truth cannot.
 *   3. WRITE. lib/stripe/sync.ts sets the plan from that truth.
 *
 * Answers: 200 when handled or not ours to handle (Stripe stops sending),
 * 400 for a bad signature, 422 for a subscription we will not act on -- an
 * unknown price or user -- so it shows as failed in Stripe's dashboard.
 */

export type WebhookDeps = {
  /** Only the two things used, so a test can pass a fake. */
  stripe: {
    webhooks: Pick<Stripe["webhooks"], "constructEvent">;
    subscriptions: { retrieve: (id: string) => Promise<Stripe.Subscription> };
  };
  admin: SupabaseClient;
  secret: string;
};

export type WebhookAnswer = { status: number; body: { received: boolean; outcome?: string } };

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function handleStripeWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string | null,
): Promise<WebhookAnswer> {
  // 1. The signature, before anything else.
  let event: Stripe.Event;
  try {
    if (!signature || !deps.secret) throw new Error("unsigned");
    event = deps.stripe.webhooks.constructEvent(rawBody, signature, deps.secret);
  } catch {
    return { status: 400, body: { received: false, outcome: "bad_signature" } };
  }

  // 2 and 3.
  let subscriptionId: string | null = null;
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await recordConsent(deps.admin, session);
    subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  } else if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const sub = invoice.parent?.subscription_details?.subscription ?? null;
    subscriptionId = typeof sub === "string" ? sub : (sub?.id ?? null);
  } else {
    return { status: 200, body: { received: true, outcome: "ignored" } };
  }
  if (!subscriptionId) return { status: 200, body: { received: true, outcome: "no_subscription" } };

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const outcome: SyncOutcome = await applySubscription(deps.admin, subscription);
  if (!outcome.applied && (outcome.reason === "unknown_price" || outcome.reason === "unknown_user" || outcome.reason === "no_user")) {
    return { status: 422, body: { received: true, outcome: outcome.reason } };
  }
  return { status: 200, body: { received: true, outcome: outcome.applied ? `plan:${outcome.plan}` : outcome.reason } };
}
