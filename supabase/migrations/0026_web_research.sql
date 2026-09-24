-- 0026_web_research.sql
--
-- Slice 12: web research on a contact (docs/slice-12-plan.md).
--
--   entitlements.research   whether web research is switched on for you.
--                           Readable by you, writable by nobody through the
--                           API -- the same rule as the Assistant's flag.
--   contact_research        what a search found about a contact: a waiting
--                           set you tick through, and the facts you kept
--   ai_usage                a fifth purpose, 'research', on the ordinary
--                           budget line (the one summaries and drafts share)
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.
--
-- tests/research-rls.test.ts covers every part of it with two users.
-- `npm test`.


-- ── entitlements.research: the switch ──────────────────────────────────────
--
-- A column on 0025's table, so it inherits that table's whole protection: a
-- policy to read your own row, none to write it, and write privileges
-- revoked from `authenticated` as well. You cannot turn research on for
-- yourself through the API, however the request is made.

alter table entitlements add column research boolean not null default false;

-- Nobody is switched on by this file, as in 0025. After running it, one line
-- in the SQL Editor with your own address (never committed):
--
--   insert into entitlements (user_id, research)
--   select id, true from auth.users where email = '<your address>'
--   on conflict (user_id) do update set research = true, updated_at = now();


-- ── contact_research: what a search found ──────────────────────────────────
--
-- One row is one press of "Research this person":
--
--   pending   the set is waiting for you to tick through. At most ONE per
--             contact (the unique index below): researching again replaces
--             what is waiting, it never piles up.
--   kept      the facts you ticked. Researching again adds a new pending set
--             and never touches what you kept.
--
-- What is stored is what the plan says and no more: each fact's sentence (at
-- most 240 characters), the link it came from and that page's title; whether
-- it is the same person, and why, in a sentence; when, and which model.
-- Never a page's text. Discarding deletes the row -- a fact you said no to is
-- not kept somewhere "just in case".

create table contact_research (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  contact_id    uuid not null,
  status        text not null default 'pending' check (status in ('pending', 'kept')),
  identity      text not null check (identity in ('sure', 'likely', 'unsure')),
  identity_why  text not null check (char_length(identity_why) between 1 and 300),
  -- [{ "text": ..., "url": ..., "title": ... }, ...] -- checked in the app
  -- (lib/research/*), bounded here so the column cannot be used as storage.
  facts         jsonb not null
                  check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) between 1 and 8),
  model         text not null check (char_length(model) <= 100),
  found_at      timestamptz not null default now(),
  decided_at    timestamptz,

  check (pg_column_size(facts) < 16000),

  -- The contact AND its owner, checked together, as in 0004, 0010 and 0025:
  -- research can only ever be about one of your own contacts. Deleted with
  -- the contact, and with the account.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

-- One waiting set per contact.
create unique index contact_research_one_pending
  on contact_research (user_id, contact_id)
  where status = 'pending';

create index contact_research_by_contact on contact_research (user_id, contact_id);

alter table contact_research enable row level security;
revoke all on public.contact_research from anon;

-- Four policies, all the same test: the row is yours. RLS is the whole
-- security model here -- the publishable key is public, so these lines are
-- what stops one person reading or changing another's research.
create policy "Users can see their own research"
on public.contact_research for select to authenticated
using ((select auth.uid()) = user_id);

-- The server writes a set as you, after checking it (the links, the blocked
-- domains, the lengths). Writing one by hand through the API would only put
-- sentences you chose onto your own contact -- nothing the notes field does
-- not already allow.
create policy "Users can add research to their own contacts"
on public.contact_research for insert to authenticated
with check ((select auth.uid()) = user_id);

-- Keeping the ticked facts, and removing one kept fact with its x.
create policy "Users can decide on their own research"
on public.contact_research for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Discard all, and removing the last kept fact: deleted, not hidden.
create policy "Users can delete their own research"
on public.contact_research for delete to authenticated
using ((select auth.uid()) = user_id);

comment on table contact_research is
  'Facts found on the public web about a contact: pending until the user ticks them, kept if they do. Each fact is a sentence, its link and the page title -- never the page itself.';


-- ── ai_usage: research spends on the ordinary line ─────────────────────────
--
-- 0025 split the monthly budget in two: the Assistant's rows, and everyone
-- else's. 'research' is one of everyone else's, so it shares the ordinary
-- line with summaries and drafts -- only the purpose list needs to grow.

alter table ai_usage drop constraint ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check
  check (purpose in ('summary', 'draft', 'promises', 'assistant', 'research'));
