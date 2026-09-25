import { stripeClient } from "@/lib/stripe/client";
import { handleStripeWebhook } from "@/lib/stripe/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/stripe/webhook -- Stripe telling us a payment happened, changed
 * or stopped (slice 13, commit 5). All the rules are in lib/stripe/webhook.ts;
 * this only hands it the exact bytes Stripe sent.
 *
 * The body as text, never parsed as JSON first: the signature is over the raw body,
 * byte for byte. Parsing and re-serialising it would change the bytes, and
 * every genuine call would then fail the check.
 *
 * No sign-in: Stripe is not a user. The signature is what lets it in.
 */
export async function POST(request: Request) {
  const answer = await handleStripeWebhook(
    {
      stripe: stripeClient(),
      admin: createAdminClient(),
      secret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
    },
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  return Response.json(answer.body, { status: answer.status });
}
