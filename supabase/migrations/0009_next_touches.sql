-- 0009_next_touches.sql
--
-- Slice 3, step 4: a date and a reason to get back in touch with a contact
-- (plan.md §3.4; docs/slice-3-plan.md, Part 3).
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/next-touches.test.ts describes what this must do. `npm test`.


-- ── next_touches ────────────────────────────────────────────────────────────

create table next_touches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  contact_id   uuid not null,
  due_on       date not null,
  reason       text check (char_length(reason) <= 300),
  status       text not null default 'open'
                 check (status in ('open', 'done', 'skipped')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Same as contact_emails: the contact AND its owner, checked together. A
  -- policy saying "user_id is me" alone would let someone hang a touch off
  -- another user's contact.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

-- `date`, not a timestamp: "check back on 20 September" is a day in the user's
-- calendar, not a moment in UTC.
--
-- Done and skipped touches are kept, so "Mark done" is a record that it
-- happened; deleting a contact deletes its touches with it.

-- At most one open touch per contact. A partial unique index: it only counts
-- rows where status is 'open', so a contact can have any number of old ones.
create unique index next_touches_one_open
  on next_touches (contact_id) where status = 'open';

-- "Coming up" on the home page reads a user's open touches by date.
create index next_touches_open_by_date
  on next_touches (user_id, due_on) where status = 'open';

alter table next_touches enable row level security;
revoke all on public.next_touches from anon;


-- ── Policies ────────────────────────────────────────────────────────────────
--
-- The same four as every table since 0001: to authenticated, and the row's
-- user_id must be the caller's. Update checks both the row as it is (using)
-- and as it becomes (with check).

create policy "Users can view their own next touches"
on public.next_touches for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own next touches"
on public.next_touches for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own next touches"
on public.next_touches for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own next touches"
on public.next_touches for delete to authenticated
using ((select auth.uid()) = user_id);
