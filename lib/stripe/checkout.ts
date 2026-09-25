import type Stripe from "stripe";

/**
 * What the Checkout page asks for (slice 13, commit 5). Pure, so a test can
 * read exactly what Stripe will be sent.
 *
 *   Managed Payments   Stripe, through Link, is the SELLER to the customer
 *                      (decided with the user 2026-09-25; docs/slice-13-plan.md
 *                      §4). It calculates, collects and pays VAT in every
 *                      country, applies the right of withdrawal and other
 *                      consumer rules, handles disputes, and sends the
 *                      receipts. Set here on every session rather than left
 *                      to the account's default, so it cannot quietly change.
 *                      It rules out our own tick-box wording (custom_text),
 *                      so there is none: Stripe's page shows its own terms.
 *   who                our user id twice: on the session, and on the
 *                      subscription for every later event about it
 *   where back         our own address, never the request's
 */

export function checkoutParams(input: {
  userId: string;
  email: string | null;
  customerId: string | null;
  priceId: string;
  appUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    managed_payments: { enabled: true },
    client_reference_id: input.userId,
    // An existing Stripe customer is reused, so one person is one customer.
    ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
    subscription_data: { metadata: { user_id: input.userId } },
    metadata: { user_id: input.userId },
    success_url: `${input.appUrl}/pricing?paid=1`,
    cancel_url: `${input.appUrl}/pricing`,
  };
}
