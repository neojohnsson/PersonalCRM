import type Stripe from "stripe";

/**
 * What the Checkout page asks for (slice 13, commit 5). Pure, so a test can
 * read exactly what Stripe will be sent.
 *
 *   the right of withdrawal   Swedish distance-selling law gives 14 days to
 *                             withdraw; for a digital service it ends when the
 *                             service starts, only if the buyer agreed first.
 *                             consent_collection makes the box REQUIRED --
 *                             Stripe will not take the payment without it --
 *                             and custom_text says what it means.
 *   who                       our user id twice: on the session (for the
 *                             consent) and on the subscription (for every
 *                             later event about it)
 *   where back                our own address, never the request's
 */

export const WITHDRAWAL_TEXT =
  "Start now: I ask for the service to begin straight away, and I understand that I then lose my 14-day right of withdrawal. I agree to the [terms]({terms}).";

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
    client_reference_id: input.userId,
    // An existing Stripe customer is reused, so one person is one customer.
    ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
    subscription_data: { metadata: { user_id: input.userId } },
    metadata: { user_id: input.userId },
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: { message: WITHDRAWAL_TEXT.replace("{terms}", `${input.appUrl}/terms`) },
    },
    success_url: `${input.appUrl}/pricing?paid=1`,
    cancel_url: `${input.appUrl}/pricing`,
  };
}
