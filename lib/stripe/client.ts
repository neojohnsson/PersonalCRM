import "server-only";
import Stripe from "stripe";

/**
 * The Stripe connection (slice 13, commit 5; docs/slice-13-plan.md §4).
 *
 * "server-only": the secret key must never reach a browser bundle, so
 * importing this from a client component fails the build.
 *
 * The live-key guard. Test keys (sk_test_) move no money; a live key
 * (sk_live_) takes real cards. A live key is refused anywhere but Vercel's
 * production environment, so a laptop or a preview deployment can never take
 * a real payment -- not by mistake, not by a copied .env file.
 */

type Env = Record<string, string | undefined>;

export class StripeNotConfigured extends Error {
  constructor(message = "Payments aren't set up on this server: STRIPE_SECRET_KEY is missing.") {
    super(message);
    this.name = "StripeNotConfigured";
  }
}

export class LiveKeyOutsideProduction extends Error {
  constructor() {
    super("A live Stripe key is only allowed in production. Use a test key (sk_test_) here.");
    this.name = "LiveKeyOutsideProduction";
  }
}

/** The secret key, checked: present, a secret key, and live only in production. */
export function stripeSecretKey(env: Env = process.env): string {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeNotConfigured();
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_") && !key.startsWith("rk_test_") && !key.startsWith("rk_live_")) {
    throw new StripeNotConfigured("STRIPE_SECRET_KEY is not a Stripe secret key.");
  }
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (live && env.VERCEL_ENV !== "production") throw new LiveKeyOutsideProduction();
  return key;
}

export function stripeClient(env: Env = process.env): Stripe {
  return new Stripe(stripeSecretKey(env));
}

/** Where Stripe sends the browser back to: our own address, never the request's Host header. */
export function appUrl(env: Env = process.env): string {
  const url = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new StripeNotConfigured("NEXT_PUBLIC_APP_URL is missing, so Stripe has nowhere to send you back to.");
  return url;
}
