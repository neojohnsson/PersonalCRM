-- 0019_promises.sql
--
-- Slice 6d: the promises sitting in your mail (plan.md §3.4;
-- docs/slice-6d-plan.md).
--
--   promises                    a sentence where somebody said they would do
--                               something, waiting for you to accept or reject
--   contacts.promises_scanned_at  when this contact's mail was last read for them
--
-- Every row here is an AI suggestion, so every row starts pending and a human
-- decides: accepting turns it into an open next touch, which is the thing the
-- rest of the app already understands. Nothing here ever becomes a next touch,
-- a draft, or anything else on its own (AGENTS.md).
--
-- No message text is stored. `reason` is the AI's own short line ("said he'd
-- watch for openings"); the sentence it came from is read from Gmail when the
-- review screen opens and is never written down (docs/slice-6d-plan.md, Part 4).
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/rls-promises.test.ts describes what this must do. `npm test`.


-- ── next_touches (id, user_id) ──────────────────────────────────────────────
--
-- So that promises can point at a touch with the composite foreign key this
-- codebase uses everywhere: the row AND its owner, checked together. Not needed
-- for lookups — id is already unique — it exists to be referenced.

alter table next_touches add constraint next_touches_id_user_id unique (id, user_id);


-- ── promises ────────────────────────────────────────────────────────────────

create table promises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  contact_id    uuid not null,

  -- Where it was said. thread_id is what the review screen links to in Gmail;
  -- message_id is the one message it reads to show you the actual sentence.
  thread_id     text not null,
  message_id    text not null,

  -- Who said they would do something. "them" is the Pär case: he said he would
  -- watch for openings, and nothing in the app could see it.
  owed_by       text not null check (owed_by in ('you', 'them')),

  -- `date`, like next_touches: a day in your calendar, not a moment in UTC.
  due_on        date not null,
  reason        text not null check (char_length(btrim(reason)) between 1 and 300),

  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'dismissed')),
  next_touch_id uuid,

  created_at    timestamptz not null default now(),
  decided_at    timestamptz,

  foreign key (contact_id, user_id) references contacts (id, user_id) on delete cascade,
  -- Set when accepted. If the touch is later deleted the promise stays, still
  -- marked accepted: it records that you decided, not what became of it.
  --
  -- Corrected by 0020: "set null" on a composite key nulls every column in it,
  -- user_id included, and that column is not null. Left as it was run.
  foreign key (next_touch_id, user_id) references next_touches (id, user_id) on delete set null,

  -- A decision has a date, and a pending promise hasn't been decided.
  constraint promises_decided_at_matches_status
    check ((status = 'pending') = (decided_at is null))
);

-- One promise per message per direction. A rescan of a message that has already
-- been offered does nothing — which is what makes "Not a promise" stick, and
-- what stops a second scan filling the queue with the same rows. One message
-- can still hold one promise each way ("I'll send it Friday if you confirm by
-- Thursday"), because those are two different things to remember.
create unique index promises_one_per_message
  on promises (user_id, message_id, owed_by);

-- The review queue: a user's pending promises, soonest first.
create index promises_pending_by_date
  on promises (user_id, due_on) where status = 'pending';

alter table promises enable row level security;
revoke all on public.promises from anon;


-- ── Policies ────────────────────────────────────────────────────────────────
--
-- The same four as every table since 0001: to authenticated, and the row's
-- user_id must be the caller's. Update checks both the row as it is (using)
-- and as it becomes (with check), so a promise can't be moved onto someone
-- else on its way through.

create policy "Users can view their own promises"
on public.promises for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can record their own promises"
on public.promises for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can decide their own promises"
on public.promises for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own promises"
on public.promises for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── ai_usage, a third purpose ───────────────────────────────────────────────
--
-- Every request the app pays for is recorded and counted against the monthly
-- cap. A scan is neither a summary nor a draft, and calling it one would make
-- the spending unreadable — "what did I spend on promises?" has to be
-- answerable, since a scan reads many contacts at once.

alter table ai_usage drop constraint ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check
  check (purpose in ('summary', 'draft', 'promises'));


-- ── contacts.promises_scanned_at ────────────────────────────────────────────
--
-- When this contact's mail was last read for promises. A contact whose newest
-- message is older than this is skipped entirely on the next scan, which is
-- most of them, most of the time — the reason a scan stays cheap (plan.md §5.4).
--
-- Null means never scanned.

alter table contacts add column promises_scanned_at timestamptz;
