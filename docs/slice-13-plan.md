# Slice 13 — release, with plans

_plan.md §7, slice 13 ("only if the project goes public"), planned 2026-09-24. A draft for
the user to correct before any code._

Slice 13 is two different kinds of work, and the plan keeps them apart:

- **A. What code can do**: plans in the database, per-user budgets, a pricing page,
  payments through Stripe in **test mode**, and the public legal pages. All of it can be
  built, tested and demonstrated without a single stranger signing in.
- **B. What code cannot do**: Google's verification and yearly security assessment, a
  registered business, VAT, data processing agreements. These cost money and time, and
  are the user's to start. This slice writes them down as a checklist with an order and
  a cost, and **the app stays in Google's testing mode until every box in B is ticked.**

The payments stay in Stripe test mode at the end of this slice. Turning on real money is
a separate, deliberate step after B, not something that happens by merging.

## 1. What real use costs (measured, not guessed)

From `ai_usage`, September 2026: one user, a month of heavy development use.

| Purpose | Calls | Total | Per call |
|---|---|---|---|
| Assistant | 240 | $0.24 | $0.001 |
| Summaries | 57 | $0.04 | $0.0007 |
| Promise scans | 41 | $0.02 | $0.0004 |
| Drafts | 24 | $0.03 | $0.001 |
| Web research | 4 | $0.07 | $0.017 |
| **All** | | **$0.39** | |

So the AI is not what a price has to cover. What does, per year, whatever the number
of users: Google's security assessment (priced by the assessor lab — get quotes, B.2),
a registered business and its bookkeeping, Stripe's fee per payment, and 25% Swedish VAT
on consumer prices. The caps (below) stay, because they bound the worst case — a user
who runs the Assistant all day — not the average.

## 2. The plans

Agreed with the user 2026-09-24 (§7, question 1).

| | **Free** | **Pro** | **Premium** |
|---|---|---|---|
| Sync, whose turn, warmth, next touch, calendar | yes | yes | yes |
| Summaries a month | 5 | yes | yes |
| Drafts a month | 5 | yes | yes |
| Promise scans a month | 2 | yes | yes |
| Assistant messages a month | 20 | yes | yes |
| Web research | — | — | yes |
| AI budget a month (summaries, drafts, scans, research) — a safety limit, not shown | — | $2 | $5 |
| Assistant budget a month — a safety limit, not shown | — | $3 | $10 |
| Price a month, VAT included | 0 kr | 49 kr | 99 kr |

Free is the core premise made literal: AGENTS.md says the app must be useful with the AI
switched off, and Free is exactly that — plus a **small monthly allowance** of AI, so a
person can try it on their own contacts (decided 2026-09-24).

**An allowance, not a trial.** A one-week trial ends before the app shows its value, which
is timing over weeks; and a trial that takes a card and charges by itself is the one thing
in the app that would happen without a press. The allowance has no card and no deadline.
Full use of it costs about $0.03 a month per free user (§1). It is counted in **uses**
("3 of 5 summaries left this month"), because that is what a person understands; the paid
plans keep a dollar budget only as an invisible safety limit. The count comes from
`ai_usage`, which already records every AI call with its purpose.

_Maybe later:_ a larger allowance for a new account's first 30 days, with no card and
nothing automatic when it ends.

**What a plan is, in the code:** one row in `entitlements`, which already exists
(migration 0025) and already has the right security — each user can read their own
row, and nobody can write it through the API. Today it holds two booleans set by hand
in the SQL Editor. This slice adds the plan's name, its two budgets, and the Stripe ids,
and the only thing that writes them is the payment webhook (§4). The switches the app
already checks — `hasAssistant`, `hasResearch` — keep working unchanged.

**Budgets become per user.** Today one cap from the environment applies to everyone
(`LLM_MONTHLY_CAP_USD`, `ASSISTANT_MONTHLY_CAP_USD`). After this slice each user's cap
comes from their plan. The environment value stays as a ceiling that no plan can go
above, so a mistake in a row can't hand anyone an unlimited budget.

**Downgrading never deletes.** A Pro user who goes back to Free keeps every summary, kept
fact and note; they just can't make new AI output. Deleting someone's data because they
stopped paying would be a nasty surprise.

## 3. The pricing page

`/pricing`: the three plans side by side, what each includes, and one button per paid plan.
Signed out it says "Sign in to choose"; signed in it shows your current plan.

**No design exists for it.** It reuses the Profile page's cards and the Assistant's budget
line (the nearest designed screens), and says so in a comment.

Profile gets a **Your plan** card: the plan, this month's AI spending against its budget,
the renewal date, and "Manage or cancel", which opens Stripe's own customer portal.

## 4. Payments — Stripe (explained in depth, it writes entitlements)

**Why Stripe's hosted pages:** the card number is typed on a Stripe page, never on ours.
The app never sees a card, which keeps it out of the card industry's security rules
(PCI) almost entirely, and matches the browser rule this project already follows: the
app does not handle payment details. The same goes for cancelling: Stripe's customer
portal handles it.

**The flow:**

1. You press **Choose Pro**. A Server Action (rechecking who you are, as every action
   does) asks Stripe for a Checkout page for that plan, labelled with your user id,
   and sends your browser there.
2. You pay on Stripe's page. Stripe sends you back to `/pricing?done=1`.
3. **Separately**, Stripe calls our **webhook**, `app/api/stripe/webhook/route.ts`:
   "subscription created / changed / cancelled / payment failed".
4. The webhook sets your `entitlements` row to match.

**Why the webhook, not the return page, decides:** anyone can type `/pricing?done=1` into
their browser. The return page proves nothing. The webhook's request is **signed** by
Stripe with a secret only Stripe and our server know (`STRIPE_WEBHOOK_SECRET`). The
route checks the signature before reading a single field, and refuses anything unsigned
or altered. That signature is the whole security of the payment side, the way RLS is
the security of the data.

**Why it uses the secret key:** `entitlements` can't be written through the API — that
is the point of it. The webhook is the one place in the app that writes it, with
`SUPABASE_SECRET_KEY`, server-only, in a route that only acts after the signature has
checked out. That is exactly what migration 0025's comment said slice 13 would do.

**The rules the webhook follows:**

- The plan comes from **Stripe's price id** looked up in our own table of plans, never
  from anything the browser sent. An unknown price is refused, not guessed.
- The user comes from the id we attached when creating the Checkout, checked to be a
  real user.
- **Stripe may send an event twice, or out of order.** So each event sets the row to
  "what Stripe says the subscription is now" (it re-reads the subscription), rather
  than "add a month". Receiving it twice changes nothing the second time.
- Cancelled or unpaid past Stripe's retries → Free. Nothing is deleted (§2).

**Stripe is the seller: Managed Payments** (decided with the user 2026-09-25). The first
test Checkout showed the Stripe account has Managed Payments on: Stripe, through its Link
service, becomes the merchant of record. It calculates, collects and pays VAT in 80+
countries (sales to other EU countries included), applies the right of withdrawal and
other consumer rules, handles disputes and sends the receipts, for 3.5% on top of the
card fee (about 1.70 kr a month per Pro user). For a sole trader selling to consumers
anywhere in the EU, that hands over exactly the parts most likely to go wrong. So:

- Every Checkout sets `managed_payments: { enabled: true }`, never left to the default.
- Our own right-of-withdrawal tick box is gone: Managed Payments forbids custom wording,
  and as the seller Stripe applies the cooling-off period itself. The
  `withdrawal_waived_at` column (migration 0027) is no longer written, and goes with the
  old switches in the contract migration.
- Each product has the tax code `txcd_10103000` (software as a service, personal use),
  and the prices include VAT, so 49 kr is what the person pays.
- The pricing page says the plans are sold through Link, before the card page does.

**Test mode and live mode are the same code.** Stripe's test keys take the card 4242 4242
4242 4242 and move no money; the whole flow can be clicked through, and shown in a demo,
without a business existing. Going live is swapping three settings in Vercel's production
environment: the secret key, the webhook secret and the live price ids. A **live-key guard**
refuses to start with an `sk_live_` key anywhere but production, so a laptop or a preview
deployment can never take a real payment.

## 5. The public pages

Written from `docs/privacy.md`, which already holds the substance:

- `/privacy-policy`: what is stored and what isn't, where it goes, how long, your rights,
  how to reach the controller. Plain words.
- `/terms`: what the service does and doesn't do (it never sends mail), plans, cancelling,
  and liability kept short.
- `/sub-processors`: OpenAI, Supabase, Vercel, Google, Stripe — what each gets and where.
- A **data processing agreement** for customers, as a document in `docs/` for now: with
  paying users, each user is the controller of their contacts' data and we're the
  processor (plan.md §5.2).

These are drafts written by an AI, not legal advice. They are marked as drafts until a
person who knows Swedish and EU law has read them (B.5).

## 6. B — what code cannot do, in order

Written up in `docs/release.md` as a checklist, each item with what it costs, how long it
takes and why it comes where it does:

1. **Register a business** (enskild firma with Bolagsverket/Skatteverket, F-tax, VAT
   registration). Stripe live mode, VAT and the DPA all need a legal seller.
2. **Google OAuth verification + CASA** for `gmail.readonly` and `gmail.compose`.
   Google's current page (checked 2026-09-24): an annual security assessment, revalidated
   every year, at assurance level AL1 or AL2 depending on users and scopes. The price is
   set by the assessor lab: get quotes. This is the biggest cost and the reason the app
   is in testing mode.
3. **Sign the processors' DPAs**: OpenAI, Supabase, Vercel, Stripe.
4. **Stripe live mode**: business details, bank account, Stripe Tax for VAT.
5. **A lawyer's read** of the privacy policy, terms and DPA.
6. **Then** Google publishing status → In production, and Stripe keys → live: the exact
   settings to swap, in order, with how to check each one worked.

## 7. Questions for the user

1. ~~The plans and prices in §2~~ — agreed 2026-09-24, with a monthly free allowance
   instead of a trial.
2. ~~Payments now, or only plans?~~ — payments, in test mode, built so that going live is
   swapping settings, not code (2026-09-24). The user wants real money at the end.
3. ~~The legal pages?~~ — drafted in this slice, marked as drafts (2026-09-24): Stripe
   will not activate live mode without them.

## 8. Commits

1. The plan (this file).
2. Migration 0027: plans in `entitlements` (plan, two budgets, Stripe ids, period end);
   still writable by nobody through the API. RLS tests with two users: neither can
   raise their own plan or budget, nor see the other's.
3. `lib/plans.ts` and per-user budgets: every AI call takes its limit from the user's plan
   — a count of uses on Free, a dollar budget on Pro and Premium — capped by the
   environment's ceiling. Tests: the sixth free summary in a month is refused with how
   many are left and when they come back, a Pro cap holds, a broken row can't exceed the
   ceiling, Free has no web research.
4. The pricing page and the Your plan card.
5. Stripe Checkout (Managed Payments: Stripe is the seller), the customer portal, the
   webhook and the live-key guard. Tests: an unsigned or altered request is refused and
   changes nothing; a subscription sets the right plan; the same event twice is harmless;
   cancelling returns to Free and deletes nothing; an unknown price is refused; a live key
   outside production is refused.
6. The public pages, the sub-processor list and the DPA draft.
6b. Deleting an account ends everything it started, found while writing the privacy
   policy (2026-09-25): today it revokes Gmail at Google but not the Calendar
   permission, and a paid subscription keeps charging at Stripe. Delete everything
   cancels the subscription and revokes the calendar first, and deletes nothing if
   either fails, as it already does for Gmail.
7. `docs/release.md` (part B), privacy.md brought up to date, the plan's boxes ticked.

## Done when

- [x] A test user can go Free → Pro → cancel in Stripe test mode, and the app follows
      each step through the webhook alone.
- [x] Nobody can change their own plan or budget through the API (two-user RLS test).
- [x] A forged webhook call changes nothing (test).
- [x] Every AI feature spends from the user's own plan: Free's monthly allowance, or the
      paid plan's budget.
- [x] The pricing, privacy-policy, terms and sub-processors pages exist and fit 390px.
- [x] `docs/release.md` lists part B with costs and the go-live switch, and the app is
      still in testing mode.
- [x] Every Checkout is sold through Managed Payments (Stripe is the seller).

_All seven checked 2026-09-25. The Free → Pro → cancel run was twice: once through the
API with Stripe's test card, once by the user on Stripe's own Checkout page (49 kr, of
which 9.80 kr VAT, Managed Payments on), with the portal's cancellation running to the end
of the paid month. 1048 tests pass._
