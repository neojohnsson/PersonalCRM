"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadEntitlement } from "@/lib/plans/current";
import { checkoutParams } from "@/lib/stripe/checkout";
import { appUrl, stripeClient } from "@/lib/stripe/client";
import { LOOKUP_KEYS, isPaidPlan } from "@/lib/stripe/prices";
import { createClient } from "@/lib/supabase/server";

/**
 * The pricing page's and the Your plan card's buttons (slice 13, commit 5).
 *
 * Neither changes a plan. "Choose" only sends you to Stripe's page, where
 * you pay; the plan changes when Stripe's signed webhook says the payment
 * happened (lib/stripe/webhook.ts). Coming back to /pricing?paid=1 proves
 * nothing -- anyone can type that address -- so the page only says "it
 * updates in a moment".
 *
 * Each checks who you are, as every Server Action must: a POST does not come
 * through the page.
 */

async function stripeCustomerOf(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("entitlements")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  return data?.stripe_customer_id ?? null;
}

/** "Choose Pro" / "Choose Premium": to Stripe's Checkout. */
export async function choosePlanAction(plan: string): Promise<void> {
  const user = await requireUser();
  if (!isPaidPlan(plan)) redirect("/pricing");

  const supabase = await createClient();
  const entitlement = await loadEntitlement(supabase, user.id);
  // Already paying: a second subscription would charge twice. Changing plan
  // or cancelling is Stripe's portal.
  if (entitlement.plan.name !== "free" && entitlement.hasStripeCustomer) return managePlanAction();

  const stripe = stripeClient();
  const prices = await stripe.prices.list({ lookup_keys: [LOOKUP_KEYS[plan]], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`Stripe has no active price "${LOOKUP_KEYS[plan]}". Run scripts/stripe-prices.mjs.`);

  const session = await stripe.checkout.sessions.create(
    checkoutParams({
      userId: user.id,
      email: user.email ?? null,
      customerId: await stripeCustomerOf(user.id),
      priceId: price.id,
      appUrl: appUrl(),
    }),
  );
  if (!session.url) throw new Error("Stripe made no Checkout page.");
  redirect(session.url);
}

/** "Manage or cancel": Stripe's own customer portal. */
export async function managePlanAction(): Promise<void> {
  const user = await requireUser();
  const customer = await stripeCustomerOf(user.id);
  if (!customer) redirect("/pricing");

  const stripe = stripeClient();
  // The configuration scripts/stripe-prices.mjs made, found by its label;
  // Stripe's default if it is not there.
  const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const configuration = configurations.data.find((each) => each.metadata?.contact_hub === "portal")?.id;
  const portal = await stripe.billingPortal.sessions.create({
    customer,
    return_url: `${appUrl()}/profile`,
    ...(configuration ? { configuration } : {}),
  });
  redirect(portal.url);
}
