-- 0018_settled_threads.sql
--
-- Slice 6c: the two things a person can tell the app about a contact
-- (plan.md §3.3; docs/slice-6c-plan.md, Part 1).
--
--   settled_threads       "nothing owed here" — this conversation is finished
--   contacts.never_chase  "just a contact" — never prompt me about this person
--
-- The third thing, "the right moment is months away", needs no storage: it is
-- the open next touch that already exists. Slice 6c only makes the rest of the
-- app honour it.
--
-- Why this exists: whose-turn reads message headers and nothing else, so it
-- cannot know that a conversation was handed to a colleague or that no reply is
-- owed. It was never wrong about who wrote last — it was wrong to assume that
-- means something is owed. These two are how a person says otherwise.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/rls-settled-threads.test.ts describes what this must do. `npm test`.


-- ── settled_threads ─────────────────────────────────────────────────────────
--
-- One row per contact and Gmail thread you have said needs nothing more.
--
-- settled_at is the point in time it was said, and that is the whole trick: a
-- message in that thread that arrives *after* settled_at re-opens it. Saying
-- "we're done here" today must not make you blind to what they write next week,
-- so the app never needs a way to un-settle by itself — a newer fact wins.
--
-- Keyed by (user_id, contact_id, thread_id): the same thread can be settled for
-- one person in it and still open for another, which is exactly the handed-off
-- case — nothing more is owed to the person who referred you on, while the
-- colleague they named is a live conversation.

create table settled_threads (
  user_id    uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null,
  thread_id  text not null,
  settled_at timestamptz not null default now(),

  primary key (user_id, contact_id, thread_id),

  -- The contact must be the caller's own, as everywhere else. The composite
  -- key means a row can never point at somebody else's contact.
  foreign key (contact_id, user_id) references contacts (id, user_id) on delete cascade
);

alter table settled_threads enable row level security;
revoke all on public.settled_threads from anon;

-- The four policies are the security model: every statement is rewritten with
-- these conditions, so a query can only ever see or change rows whose user_id
-- is the caller's. `(select auth.uid())` is wrapped so Postgres works it out
-- once per statement instead of once per row.

create policy "Users can view their own settled threads"
on public.settled_threads for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can settle their own threads"
on public.settled_threads for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can change their own settled threads"
on public.settled_threads for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Undo. Nothing is ever deleted on the app's own initiative.
create policy "Users can unsettle their own threads"
on public.settled_threads for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── contacts.never_chase ────────────────────────────────────────────────────
--
-- "Just a contact": keep the record, never prompt about them again. They stay
-- in the contact list and still count toward warmth — this hides prompts, it
-- doesn't hide the person.
--
-- Default false, so every contact that exists today is unchanged.

alter table contacts add column never_chase boolean not null default false;


-- ── contact_list, again ─────────────────────────────────────────────────────
--
-- The view the contact list reads (0006). `create or replace view` can only
-- append columns — every existing one must keep its name, type and position —
-- so the body below is 0006's, unchanged, with never_chase added at the end.

create or replace view contact_list
with (security_invoker = true)
as
with addresses as (
  select
    contact_id,
    user_id,
    max(email) filter (where is_primary)              as primary_email,
    array_agg(email order by is_primary desc, email)  as emails
  from contact_emails
  group by contact_id, user_id
),
activity as (
  select
    ce.contact_id,
    ce.user_id,
    sum(p.message_count)::integer as message_count,
    max(p.last_contact_at)        as last_contact_at
  from contact_emails ce
  join people p
    on p.user_id = ce.user_id and p.email = ce.email
  group by ce.contact_id, ce.user_id
)
select
  c.id,
  c.user_id,
  c.first_name,
  c.last_name,
  c.company,
  c.role,
  c.tags,
  c.source,
  c.created_at,
  a.primary_email,
  coalesce(a.emails, '{}')         as emails,
  coalesce(act.message_count, 0)   as message_count,
  act.last_contact_at,
  lower(concat_ws(' ',
    c.first_name,
    c.last_name,
    c.company,
    c.role,
    array_to_string(c.tags, ' '),
    array_to_string(a.emails, ' ')
  )) as search_text,
  c.never_chase
from contacts c
left join addresses a
  on a.contact_id = c.id and a.user_id = c.user_id
left join activity act
  on act.contact_id = c.id and act.user_id = c.user_id;

revoke all on public.contact_list from anon;
