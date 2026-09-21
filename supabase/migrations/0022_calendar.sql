-- 0022_calendar.sql
--
-- Slice 8a: the calendar signal (plan.md §6.4; docs/slice-8-plan.md).
--
--   google_calendar    the Calendar connection, kept apart from Gmail's
--   calendar_meetings  meetings with a contact, and nothing else
--
-- plan.md §6.4: "A meeting in the calendar is the strongest warmth signal that
-- exists — far stronger than email." This is where that signal is kept.
--
-- Read-only, for good. No write scope is ever requested, so nothing in this
-- app can create, change or delete an event. §3.4 settled it: a follow-up date
-- is "a suggestion, never a silent calendar entry".
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/rls-calendar.test.ts describes what this must do. `npm test`.


-- ── google_calendar ─────────────────────────────────────────────────────────
--
-- Its own table rather than more columns on google_accounts, because it is its
-- own consent: granting Calendar must not touch Gmail, revoking Calendar must
-- not break the sync, and the app has to work fully with one and not the other
-- (docs/calendar-and-profile.md).
--
-- Same shape as google_accounts (0001) so there is one pattern to understand,
-- including `scopes` from 0014 — Google returns what it actually granted, which
-- can be less than what was asked for, and the app checks the list rather than
-- assuming the request succeeded.

create table google_calendar (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users (id) on delete cascade,
  email                   text not null,
  refresh_token_encrypted text not null,
  scopes                  text[] not null default '{}',

  -- Where the last read got to, so the next one asks Google for a narrow window
  -- instead of the whole year again. Null means nothing has been read yet.
  synced_through          timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table google_calendar enable row level security;
revoke all on public.google_calendar from anon;

create policy "Users can view their own calendar connection"
on public.google_calendar for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can connect their own calendar"
on public.google_calendar for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can change their own calendar connection"
on public.google_calendar for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can disconnect their own calendar"
on public.google_calendar for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── calendar_meetings ───────────────────────────────────────────────────────
--
-- One row per meeting per contact. A meeting with two contacts in it makes two
-- rows, because it is a fact about each of them.
--
-- What is NOT here is the point of the table:
--
--   no title        nothing computed needs one. The page reads titles live from
--                   Google when it draws the week, the way message bodies are
--                   read and thrown away
--   no description  people paste private things into them, and this app never
--                   asks Google for them at all
--   no guest list   only that one guest was this contact
--
-- So the most this table could ever leak about a contact is that you were in a
-- meeting together, and when.
--
-- accepted: whether *you* accepted. A meeting you declined is not contact, and
-- counting it would make warmth lie in the one direction nobody would check.

create table calendar_meetings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null,

  -- Google's event id. The same event read twice must not become two meetings.
  event_id   text not null,

  started_at timestamptz not null,
  ended_at   timestamptz not null,
  accepted   boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (user_id, contact_id, event_id),
  constraint calendar_meetings_ends_after_it_starts check (ended_at >= started_at),

  -- The contact AND its owner, checked together, as everywhere else.
  foreign key (contact_id, user_id) references contacts (id, user_id) on delete cascade
);

-- Warmth asks for one contact's meetings, newest first.
create index calendar_meetings_by_contact
  on calendar_meetings (user_id, contact_id, started_at desc);

-- The week grid and "is that day full" ask by date across all contacts.
create index calendar_meetings_by_day
  on calendar_meetings (user_id, started_at);

alter table calendar_meetings enable row level security;
revoke all on public.calendar_meetings from anon;

create policy "Users can view their own meetings"
on public.calendar_meetings for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can record their own meetings"
on public.calendar_meetings for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can change their own meetings"
on public.calendar_meetings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Disconnecting Calendar deletes the meetings it read.
create policy "Users can delete their own meetings"
on public.calendar_meetings for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── delete_all_contacts, again ──────────────────────────────────────────────
--
-- 0021's version names the tables it clears. Meetings hang off contacts and go
-- with them by cascade, but the calendar's read position has to be reset too —
-- otherwise the next read would skip everything it had already seen and leave
-- the meetings gone for good.
--
-- delete_account needs no change: google_calendar and calendar_meetings both
-- hang off auth.users, and slice 7's test proves that without being edited,
-- because it checks the privacy page's own list of tables.

create or replace function public.delete_all_contacts(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.contacts where user_id = p_user_id;
  delete from public.gmail_messages where user_id = p_user_id;
  delete from public.gmail_sync_state where user_id = p_user_id;

  -- Keep the connection, forget where it got to.
  update public.google_calendar set synced_through = null, updated_at = now()
  where user_id = p_user_id;
end;
$$;
