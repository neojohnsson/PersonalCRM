-- 0004_contacts.sql
--
-- Slice 2: contacts, their addresses, dismissals from Seen once, and the view
-- that sorts people into tiers. See docs/slice-2-plan.md.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file at once.
--
-- ⚠ This clears every stored Gmail message and resets every sync to `ready`
-- (slice-2-plan.md, Part 3). They were saved under slice 1's rules —
-- newsletters included, no subjects. The next Sync now reads them again.
--
-- tests/rls-contacts.test.ts describes what this must do. `npm test`.


-- ── Messages: subjects, and a count of what the filters skip ────────────────

alter table gmail_messages add column subject text;

alter table gmail_sync_state
  add column filtered_count integer not null default 0;

delete from gmail_messages;

update gmail_sync_state
set status = 'ready',
    page_token = null,
    history_id = null,
    message_count = 0,
    filtered_count = 0,
    last_synced_at = null,
    last_error = null,
    updated_at = now();


-- ── people: add the latest subject and thread ───────────────────────────────
--
-- Same view as 0002, with two columns added at the end (Postgres only lets
-- `create or replace view` append columns). The inner query is renamed from
-- `contacts` to `touches` so it can't be confused with the new table.

create or replace view people
with (security_invoker = true)
as
with touches as (
  select
    user_id,
    lower(from_email) as email,
    from_name         as name,
    internal_date,
    direction,
    subject,
    thread_id
  from gmail_messages
  where direction = 'inbound'

  union all

  select
    m.user_id,
    r.email,
    null,
    m.internal_date,
    m.direction,
    m.subject,
    m.thread_id
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
  max(internal_date)                              as last_contact_at,
  (array_agg(subject order by internal_date desc))[1]   as last_subject,
  (array_agg(thread_id order by internal_date desc))[1] as last_thread_id
from touches
group by user_id, email;


-- ── contacts ────────────────────────────────────────────────────────────────
--
-- The record from plan.md §3.2 and nothing more (decision C). Every field but
-- the source can be empty: a contact imported from Gmail may have no name yet,
-- and a contact added by hand may have no email.

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  first_name       text,
  last_name        text,
  company          text,
  role             text,
  one_liner        text,
  how_known        text,
  phone            text,
  notes            text,
  tags             text[] not null default '{}',
  source           text not null check (source in ('gmail', 'manual')),
  source_thread_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Not needed for lookups (id is already unique). It exists so that
  -- contact_emails can point at (id, user_id) together — see below.
  unique (id, user_id)
);

-- uuid, not bigint: the id appears in the address bar (/contacts/<id>), and a
-- counting number would say how many contacts there are. A few hundred rows
-- per user is nowhere near where random uuids slow an index down.

create index contacts_user_id_idx on contacts (user_id);

alter table contacts enable row level security;
revoke all on public.contacts from anon;


-- ── contact_emails ──────────────────────────────────────────────────────────

create table contact_emails (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  contact_id uuid not null,
  email      text not null check (email = lower(email) and email like '%_@_%'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),

  -- An address belongs to at most one of *your* contacts, so a message always
  -- finds its person. Someone else can have the same address in their CRM.
  unique (user_id, email),

  -- The foreign key checks the contact AND its owner together.
  --
  -- A policy saying "user_id is me" is not enough on its own: Bob could
  -- insert a row with his own user_id but Alice's contact_id, hanging his
  -- address off her contact. Pointing at (id, user_id) makes the database
  -- require that the contact exists *and* belongs to the same user.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

create index contact_emails_contact_id_idx on contact_emails (contact_id, user_id);

-- At most one primary address per contact. A partial unique index: it only
-- counts rows where is_primary is true.
create unique index contact_emails_one_primary
  on contact_emails (contact_id) where is_primary;

alter table contact_emails enable row level security;
revoke all on public.contact_emails from anon;


-- ── seen_once_dismissals ────────────────────────────────────────────────────
--
-- "Beyond a 'seen once' address" (privacy.md): the address, and when. The
-- dismissed person's messages are deleted by the app when this row is made,
-- and the sync skips their future mail.

create table seen_once_dismissals (
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text not null check (email = lower(email)),
  dismissed_at timestamptz not null default now(),

  primary key (user_id, email)
);

alter table seen_once_dismissals enable row level security;
revoke all on public.seen_once_dismissals from anon;


-- ── person_tiers ────────────────────────────────────────────────────────────
--
-- Everyone in `people`, sorted into a tier:
--
--   contact    at least one message from them and one from you
--   seen_once  everyone else
--
-- Left out entirely:
--   * your own addresses — anything you've sent mail *from* (catches aliases)
--   * anyone you dismissed from Seen once
--
-- contact_id is filled in once they have a contact record. So:
--   Seen once queue   = tier 'seen_once' and contact_id is null
--   still to import   = tier 'contact'   and contact_id is null
--
-- security_invoker, like `people`: it runs as the person asking, so every
-- table underneath applies its own RLS.

create view person_tiers
with (security_invoker = true)
as
select
  p.user_id,
  p.email,
  p.name,
  p.message_count,
  p.sent_count,
  p.received_count,
  p.last_contact_at,
  p.last_subject,
  p.last_thread_id,
  case
    when p.sent_count > 0 and p.received_count > 0 then 'contact'
    else 'seen_once'
  end as tier,
  ce.contact_id
from people p
left join contact_emails ce
  on ce.user_id = p.user_id and ce.email = p.email
where not exists (
    select 1 from gmail_messages own
    where own.user_id = p.user_id
      and own.direction = 'outbound'
      and lower(own.from_email) = p.email
  )
  and not exists (
    select 1 from seen_once_dismissals d
    where d.user_id = p.user_id and d.email = p.email
  );

revoke all on public.person_tiers from anon;


-- ── Policies ────────────────────────────────────────────────────────────────
--
-- The same pattern as 0001 and 0002: to authenticated, and the row's user_id
-- must be the caller's. (select auth.uid()) is evaluated once per query rather
-- than once per row. Update needs both `using` (which rows you may touch) and
-- `with check` (what they may become), or a row could be handed to someone else.

create policy "Users can view their own contacts"
on public.contacts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own contacts"
on public.contacts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own contacts"
on public.contacts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own contacts"
on public.contacts for delete to authenticated
using ((select auth.uid()) = user_id);


create policy "Users can view their own contact emails"
on public.contact_emails for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add emails to their own contacts"
on public.contact_emails for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own contact emails"
on public.contact_emails for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own contact emails"
on public.contact_emails for delete to authenticated
using ((select auth.uid()) = user_id);


-- Dismissals: no update policy, on purpose. Nothing ever needs to change a
-- dismissal — it's made, or it's taken back by deleting it — and without a
-- policy, RLS refuses every update.

create policy "Users can view their own dismissals"
on public.seen_once_dismissals for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can dismiss people from their own Seen once"
on public.seen_once_dismissals for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can undo their own dismissals"
on public.seen_once_dismissals for delete to authenticated
using ((select auth.uid()) = user_id);
