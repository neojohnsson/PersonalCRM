-- 0002_gmail_sync.sql
--
-- What the sync writes (gmail_messages, gmail_sync_state) and what the people
-- list reads (the `people` view). Slice 1, Part 3 of docs/slice-1-plan.md.
--
-- Run in the Supabase dashboard → SQL Editor, same as 0001.
-- First run `select version();` — the view needs PostgreSQL 15 or newer.
--
-- tests/rls-gmail-sync.test.ts describes what this must do. `npm test`.


-- ── gmail_messages ──────────────────────────────────────────────────────────
--
-- One row per email. Headers only: no body, no snippet, no attachments, and
-- for now no subject (slice-1-plan.md, decision 4).

create table gmail_messages (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  gmail_message_id     text not null,
  thread_id            text not null,
  internal_date        timestamptz not null,
  from_email           text not null,
  from_name            text,
  to_emails            text[] not null default '{}',
  cc_emails            text[] not null default '{}',
  direction            text not null check (direction in ('inbound', 'outbound')),
  has_list_unsubscribe boolean not null default false,
  created_at           timestamptz not null default now(),

  unique (user_id, gmail_message_id)
);

-- `bigint identity`, not `uuid` like google_accounts: that table has one row
-- per user, this one has thousands. Random UUIDs as a primary key scatter
-- inserts across the index and slow a big table down.
--
-- The unique constraint does two jobs:
--   * a retried sync step upserts on it, so it can never double-count
--   * its index starts with user_id, so it is also the index the RLS policies
--     use to find a user's rows. No separate user_id index needed.
--
-- user_id points at auth.users, not google_accounts, on purpose: disconnecting
-- Gmail deletes the google_accounts row but keeps synced data (privacy.md).

alter table gmail_messages enable row level security;
revoke all on public.gmail_messages from anon;


-- ── gmail_sync_state ────────────────────────────────────────────────────────
--
-- One row per user: where the sync state machine is. Kept out of
-- google_accounts so the token table stays narrow.

create table gmail_sync_state (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  status              text not null default 'ready'
                        check (status in ('ready', 'backfilling', 'synced',
                                          'incremental', 'needs_reconnect', 'error')),
  backfill_page_token text,
  history_id          text,
  last_synced_at      timestamptz,
  last_error          text,
  message_count       integer not null default 0,
  updated_at          timestamptz not null default now()
);

-- `not_connected` from the state machine isn't a status: it's "no
-- google_accounts row". Only states a row can actually be in are allowed.
--
-- history_id is text: Gmail's ids are unsigned 64-bit, which can exceed
-- Postgres's largest integer type.

alter table gmail_sync_state enable row level security;
revoke all on public.gmail_sync_state from anon;


-- ── people ──────────────────────────────────────────────────────────────────
--
-- Everyone a user has exchanged mail with, and how much. A view, so it can
-- never drift out of step with the messages.
--
-- Who counts (decided 2026-09-15):
--   * mail you received → the sender
--   * mail you sent     → everyone in To and Cc
-- Someone in both To and Cc of one message counts once. Addresses are
-- compared lowercased.
--
-- Not filtered yet: no-reply senders, newsletters, your own aliases. That is
-- Slice 2 — don't cross the boundary.

create view people
with (security_invoker = true)
as
with contacts as (
  select
    user_id,
    lower(from_email) as email,
    from_name         as name,
    internal_date,
    direction
  from gmail_messages
  where direction = 'inbound'

  union all

  select
    m.user_id,
    r.email,
    null,
    m.internal_date,
    m.direction
  from gmail_messages m
  cross join lateral (
    select distinct lower(address) as email
    from unnest(m.to_emails || m.cc_emails) as address
  ) r
  where m.direction = 'outbound'
)
select
  user_id,
  email,
  (array_agg(name order by internal_date desc) filter (where name is not null))[1] as name,
  count(*)                                        as message_count,
  count(*) filter (where direction = 'outbound')  as sent_count,
  count(*) filter (where direction = 'inbound')   as received_count,
  max(internal_date)                              as last_contact_at
from contacts
group by user_id, email;

-- security_invoker = true is the whole security story for this view.
--
-- Without it, a view runs with the rights of whoever created it — in the SQL
-- Editor that's a role that bypasses RLS — so Bob would read Alice's people.
-- With it, the view runs as the person querying it, and gmail_messages'
-- policies filter the rows underneath. That's why the view gets no policies
-- of its own: it doesn't need any, and it can't have any.

revoke all on public.people from anon;


-- ── YOURS TO WRITE: the policies ────────────────────────────────────────────
-- AGENTS.md: "I write these by hand — RLS policies."
--
-- Same pattern as 0001: select, insert, update and delete, each one
-- `to authenticated` and comparing `(select auth.uid()) = user_id`.
-- Update needs both `using` and `with check`; insert takes `with check` only.
--
--   gmail_messages    — four policies
--   gmail_sync_state  — four policies
--   people            — none (see above)
--
-- Worth knowing before you start:
--
--   * The sync saves messages with an upsert. An upsert needs select, insert
--     AND update to be allowed — miss one and re-running a step fails.
--
--   * The sync claims its row with a conditional update ("set status to
--     backfilling where status is ready"). That is an ordinary update, so the
--     update policy covers it.
--
-- Until these exist, RLS is on with no policies, which denies everything —
-- so the tests fail. That's expected. Then: npm test.

create policy "Users can view their own Gmail messages"
on public.gmail_messages
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can save their own Gmail messages"
on public.gmail_messages
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own Gmail messages"
on public.gmail_messages
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own Gmail messages"
on public.gmail_messages
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- 

create policy "Users can view their own Gmail sync state"
on public.gmail_sync_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can save their own Gmail sync state"
on public.gmail_sync_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own Gmail sync state"
on public.gmail_sync_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own Gmail sync state"
on public.gmail_sync_state
for delete
to authenticated
using ((select auth.uid()) = user_id);