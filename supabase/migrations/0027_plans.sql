-- 0027_plans.sql
--
-- Slice 13: release, with plans (docs/slice-13-plan.md §2 and §4).
--
--   entitlements.plan                 'free', 'pro' or 'premium' -- the one
--                                     thing the app reads from now on
--   entitlements.stripe_customer_id   who you are at Stripe
--   entitlements.stripe_subscription_id
--   entitlements.current_period_end   when the paid month runs out
--   entitlements.withdrawal_waived_at when you ticked "start now, and I lose
--                                     the right of withdrawal" at Checkout
--
-- What a plan INCLUDES is not stored here: it lives in lib/plans.ts, one
-- reviewed file, so no single row can quietly carry a different budget.
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.
-- tests/plans-rls.test.ts covers it with two users. `npm test`.


-- ── The protection does not change, and that is the point ─────────────────
--
-- These are columns on 0025's table, so they inherit its whole protection:
-- a policy to READ your own row, no policy to insert, update or delete, and
-- the write privileges revoked from `authenticated` besides. Nobody makes
-- themselves Premium through the API, however the request is made. The one
-- writer is the Stripe webhook, with the secret key, after it has checked
-- Stripe's signature (slice 13, commit 5).

alter table entitlements
  add column plan text not null default 'free'
    constraint entitlements_plan_known check (plan in ('free', 'pro', 'premium')),
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text unique,
  add column current_period_end timestamptz,
  add column withdrawal_waived_at timestamptz;

comment on column entitlements.plan is
  'free, pro or premium. What each includes is lib/plans.ts. Written only by the Stripe webhook or the database owner.';


-- ── The hand-set switches become plans ─────────────────────────────────────
--
-- Until now two booleans were set by hand in the SQL Editor. A plan IS a set
-- of switches, so keeping both would let them disagree. Research on means
-- Premium (it is the only plan with research); the Assistant alone means Pro.

update entitlements
set plan = case when research then 'premium' when assistant then 'pro' else 'free' end,
    updated_at = now();


-- ── Why the old columns stay, for now ──────────────────────────────────────
--
-- Expand, then contract. Production runs main's code against this same
-- database, and main still reads `assistant` and `research`. Dropping them
-- here would break the live site from the moment this file runs until the
-- slice is merged and deployed. So they stay, unread by the new code, and a
-- later migration drops them once it is live.

comment on column entitlements.assistant is 'Replaced by plan (0027). Dropped once slice 13 is deployed.';
comment on column entitlements.research is 'Replaced by plan (0027). Dropped once slice 13 is deployed.';
