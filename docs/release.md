# Going live — the checklist

_Slice 13, commit 7 (`docs/slice-13-plan.md` §6). Written 2026-09-25._

Everything that can be built is built and tested in Stripe's test mode: plans, the free
allowance, payments through Stripe with Stripe as the seller, the public pages, and a
deletion that ends everything. What is left is not code. It costs money and time, it is
yours to start, and **the app stays in Google's testing mode until every step below is
done.** Going live is a decision, not something that happens by merging.

Each step says what it costs, how long it takes, and why it comes where it does. Figures
are as checked on 2026-09-25; **verify each one when you get to it** — Google, Stripe and
Skatteverket change their terms.

## 0. Do the sums first

Per Pro user a month, with Stripe as the seller (Managed Payments):

| | kr |
|---|---|
| Price | 49.00 |
| VAT (25%, included; Stripe pays it) | −9.80 |
| Card fee, 1.5% + 1.80 kr | −2.54 |
| Managed Payments, 3.5% | −1.72 |
| AI, a heavy month (`docs/slice-13-plan.md` §1) | −0.40 |
| **Left** | **about 34.50** |

So **one Pro user brings in about 414 kr a year.** The yearly fixed costs below (above all
Google's security assessment) divided by 414 is the number of paying users needed to break
even. Get the assessment quotes (step 4) **before** spending on anything else: they decide
whether this is worth doing at all.

## 1. A business — enskild firma with F-skatt

- **What:** apply for F-skatt as a sole trader at verksamt.se (Skatteverket). Registering the
  name with Bolagsverket is optional.
- **Cost:** F-skatt is free; the Bolagsverket registration is optional, about 1,100 kr.
- **Time:** a few days to a couple of weeks.
- **Why first:** Stripe's live mode, the DPA and the privacy policy all need a legal seller
  and someone responsible.
- **Ask Skatteverket about VAT.** Stripe, as the seller, pays VAT on what customers buy, so
  your own VAT position should be simple — but confirm it, and the 120,000 kr exemption,
  with them rather than trusting this line.
- **CSN:** profit from the business counts towards CSN's income limit (*fribeloppet*).
  Check it before the first payout.
- **Then:** fill in `lib/legal/operator.ts` (name, email) — the public pages show the gap
  until you do.

## 2. A domain of your own

- **What:** buy a domain (for example a `.se`), point it at the Vercel project, and set
  `NEXT_PUBLIC_APP_URL` to it.
- **Cost:** about 100–200 kr a year.
- **Why:** Google's verification needs a homepage and privacy policy **on a domain you
  own** — a `vercel.app` address is Vercel's, not yours. Update the Google OAuth client's
  redirect URIs and authorised domains, and Stripe's public details, to the new address.

## 3. The legal pages, finished

- [ ] A person who knows Swedish and EU law reads `/terms`, `/privacy-policy` and
      `docs/dpa-draft.md`. Then set `LEGAL_REVIEWED = true` in `lib/legal/operator.ts`,
      which removes the "Draft" notice.
- [ ] Sign each sub-processor's own data processing agreement, and confirm its basis for
      transfers outside the EU: OpenAI, Supabase, Vercel, Stripe.
- [ ] Move Vercel's functions to **Dublin** (`dub1`): Vercel → project → Settings →
      Functions → Region, or `"regions": ["dub1"]` in `vercel.json`. The database is in
      Ireland, so this keeps every request in the EU and makes pages faster. Then change
      Vercel's line in `lib/legal/sub-processors.ts`.
- **Cost:** the lawyer's read is the only cost here. The Swedish bar association and some
  universities' law clinics are places to ask.

## 4. Google: verification and the yearly security assessment

The biggest cost, and the reason the app is in testing mode today (`plan.md` §5.1).

- **What:** `gmail.readonly` and `gmail.compose` are *restricted* scopes. Publishing the app
  needs Google's OAuth verification (branding, the domain from step 2, the privacy policy,
  a video of the app using each permission, and why each is needed) and then a **CASA
  security assessment** by a lab Google has approved. Google's page (checked 2026-09-24):
  an annual assessment, revalidated every year, at assurance level AL1 or AL2.
- **Cost:** set by the lab. **Get quotes from two or three of Google's listed labs** — this
  number decides step 0.
- **Time:** weeks to a few months, the first time.
- **Until it is done:** testing mode, a capped list of invited testers, and Google asking
  them to reconnect about once a week. Charging strangers for that would earn refunds.
- The Calendar scope `calendar.events` is *sensitive*, not restricted: it needs verification
  but not the assessment.

## 5. Stripe, live

The code does not change. Only settings do.

1. **Activate the account** in the Stripe dashboard, with the business from step 1 and a
   bank account for payouts.
2. **Accept the Managed Payments terms** in live mode (Settings → Managed Payments), and add
   your terms and privacy policy URLs in the Checkout settings.
3. **Create the live prices** — locally, with the live key in your shell only for that one
   command, never saved in a file:
   `STRIPE_SECRET_KEY=sk_live_… node --env-file=.env.local scripts/stripe-prices.mjs --live`
   (without `--live` the script refuses a live key). It creates `pro_monthly`,
   `premium_monthly` and the portal settings, the same names as in test mode, so nothing is
   copied into the app.
4. **Create the webhook** in the dashboard (Developers → Webhooks → Add endpoint):
   `https://<your domain>/api/stripe/webhook`, with the events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed`. Copy its signing secret for step 6.
- **Cost:** no monthly fee; 1.5% + 1.80 kr per card payment, plus 3.5% for Managed Payments.

## 6. Vercel's production settings

Set these for **Production only** (Vercel → Settings → Environment Variables):

| Setting | Value | Note |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` | The app refuses a live key anywhere but production (`lib/stripe/client.ts`) |
| `STRIPE_WEBHOOK_SECRET` | from step 5.4 | Different from the local `stripe listen` one |
| `SUPABASE_SECRET_KEY` | the service key | **The first time it goes to Vercel.** Only the payment webhook uses it (`lib/supabase/admin.ts`). Production only, never Preview, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_APP_URL` | `https://<your domain>` | Where Stripe sends people back to |

Preview deployments keep test keys, so a pull request can never take a real payment.

## 7. The database

Production and development share one Supabase project, so migrations 0027 and 0028 are
already there. After slice 13 is deployed, the old columns and function can go — the
"contract" half of expand-then-contract (migrations 0027, 0028). **Not before**: the old
code reads them until the new code is live.

```sql
-- Run only once slice 13 is live in production.
alter table entitlements
  drop column assistant,
  drop column research,
  drop column withdrawal_waived_at;   -- never written since Managed Payments
drop function public.reserve_ai_spend(uuid, uuid, text, text, numeric, numeric);
```

Production has barely been used since slice 1 (`docs/plan.md`): connect Gmail there and let
a full sync run before inviting anyone.

## 8. The first real payment, then Google

1. Deploy. Buy Pro yourself with a real card. Check in Stripe → Webhooks that every event
   got a 200, and that your plan changed.
2. Cancel it in the portal, check the plan follows at the end of the month, and refund
   yourself from the dashboard.
3. **Only then** switch the Google OAuth app from *Testing* to *In production*.

## Every year, after

- The CASA reassessment (step 4).
- Bookkeeping and the income tax return for the business (NE-bilaga).
- Keep `lib/legal/sub-processors.ts` current: `tests/legal.test.ts` fails when the code
  calls a service that is not on it, and customers get 30 days' notice of a new one
  (`docs/dpa-draft.md`).
