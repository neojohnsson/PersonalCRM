// Creates the two plans' prices in Stripe, and the customer portal's settings
// (slice 13, commit 5). Safe to run again: whatever exists is left alone.
//
//   node --env-file=.env.local scripts/stripe-prices.mjs
//
// The app finds each price by its lookup key (lib/stripe/prices.ts), so the
// same script run with a live key creates the same names in live mode and the
// app needs nothing copied into it. A live key is refused unless --live is
// given, so live mode is never set up by accident.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) throw new Error("STRIPE_SECRET_KEY is missing. Put your test key (sk_test_...) in .env.local.");
const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
if (live && !process.argv.includes("--live")) throw new Error("That is a LIVE key. Add --live only when you mean to set up real payments.");

const stripe = new Stripe(key);

// Prices in öre, VAT included (docs/slice-13-plan.md §2).
const PLANS = [
  { lookup: "pro_monthly", name: "Contact Hub Pro", amount: 4900 },
  { lookup: "premium_monthly", name: "Contact Hub Premium", amount: 9900 },
];

const prices = [];
for (const plan of PLANS) {
  const found = await stripe.prices.list({ lookup_keys: [plan.lookup], active: true, limit: 1 });
  if (found.data[0]) {
    console.log(`${plan.lookup}: already there (${found.data[0].id})`);
    prices.push(found.data[0]);
    continue;
  }
  const product = await stripe.products.create({ name: plan.name });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "sek",
    unit_amount: plan.amount,
    recurring: { interval: "month" },
    lookup_key: plan.lookup,
    // The price already holds the 25% VAT: 49 kr is what the person pays.
    tax_behavior: "inclusive",
  });
  console.log(`${plan.lookup}: created (${price.id})`);
  prices.push(price);
}

// The customer portal: cancel at the end of the paid month (never mid-month,
// so nobody loses days they paid for), change card, see receipts, and move
// between Pro and Premium.
// Labelled, and found by its label (lib/stripe/portal.ts), rather than
// relying on which configuration Stripe treats as its default.
const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
const existing = configurations.data.find((each) => each.metadata?.contact_hub === "portal");
if (existing) {
  console.log(`portal: already set up (${existing.id})`);
} else {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "http://localhost:3000";
  const portal = await stripe.billingPortal.configurations.create({
    metadata: { contact_hub: "portal" },
    business_profile: { headline: "Contact Hub: your plan", terms_of_service_url: `${appUrl}/terms`, privacy_policy_url: `${appUrl}/privacy-policy` },
    features: {
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: prices.map((price) => ({ product: typeof price.product === "string" ? price.product : price.product.id, prices: [price.id] })),
      },
    },
  });
  console.log(`portal: created (${portal.id})`);
}
