-- 0025_assistant.sql
--
-- Slice 11: the Assistant (docs/slice-11-plan.md).
--
--   entitlements        whether the Assistant is switched on for you — the
--                       premium flag. You can READ it; nobody can write it
--                       through the API.
--   assistant_actions   what the Assistant did on its own, with the value
--                       before, so every one of them can be undone exactly
--   ai_usage            a fourth purpose, 'assistant', and its own budget line
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.
--
-- tests/assistant-rls.test.ts covers every part of it with two users.
-- `npm test`.


-- ── entitlements: the premium flag ─────────────────────────────────────────
--
-- The plan first put this on `profiles` as `assistant_enabled`. That would
-- have been a free upgrade for anyone who opened the browser's developer
-- tools: `profiles` has "Users can update their own profile" (0014), and the
-- publishable key is public by design. RLS decides WHICH ROW you may change,
-- never which column — so a user could set their own flag to true.
--
-- So it is a table of its own, and the important part is what it does NOT
-- have: there is a policy to read your own row, and no policy to insert,
-- update or delete one. With RLS on, anything no policy allows is refused.
-- The only way to change it is as the database owner — the SQL Editor today,
-- and slice 13's payment webhook (with the service role) later.

create table entitlements (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  assistant  boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table entitlements enable row level security;
revoke all on public.entitlements from anon;
-- Belt and braces: even if a policy were added by mistake, authenticated
-- users hold no privilege to write this table at all.
revoke insert, update, delete on public.entitlements from authenticated;

create policy "Users can see what they are entitled to"
on public.entitlements for select to authenticated
using ((select auth.uid()) = user_id);

comment on table entitlements is
  'Premium flags. Readable by the user, writable only by the database owner or the service role -- never through the API.';

-- Nobody is switched on by this file. It first granted everyone who existed,
-- and a trial run on 2026-09-23 found TWO real accounts on the project, not
-- one -- so "everyone" would have handed premium to an account nobody had
-- decided about. Switch yourself on with one line in the SQL Editor after
-- running this file, with your own address in it (never committed):
--
--   insert into entitlements (user_id, assistant)
--   select id, true from auth.users where email = '<your address>'
--   on conflict (user_id) do update set assistant = true, updated_at = now();


-- ── assistant_actions: what it did on its own ──────────────────────────────
--
-- The conversation is not stored (a transcript would hold quoted mail). This
-- is what is kept instead: each of the five things the Assistant may do
-- without asking (AGENTS.md, amended 2026-09-23), with the value before and
-- after. `before` is what makes Undo exact — putting a note back means
-- putting back THAT note, not guessing at it.
--
-- It holds your own notes, tags and dates, which the app already stores.
-- Never message text: the Assistant writes notes in its own words, and a
-- note copied out of a message would be a way to store message bodies.

create table assistant_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  contact_id  uuid not null,
  kind        text not null
                check (kind in ('note', 'tags', 'next_touch', 'conversation_done', 'reminders')),
  -- What the page says in the activity list: "Added a note to Karin".
  summary     text not null check (char_length(summary) between 1 and 300),
  before      jsonb not null,
  after       jsonb not null,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz,

  -- A note may be 10,000 characters; its before and after together fit well
  -- inside this. It stops the table being used as somewhere to put anything.
  check (pg_column_size(before) + pg_column_size(after) < 40000),

  -- The contact AND its owner, checked together, as in 0004, 0009 and 0010:
  -- an action can only ever be about one of your own contacts. Deleted with
  -- the contact, and with the account.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

create index assistant_actions_recent on assistant_actions (user_id, created_at desc);

alter table assistant_actions enable row level security;
revoke all on public.assistant_actions from anon;

create policy "Users can view what the Assistant did for them"
on public.assistant_actions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users' Assistant can record what it did"
on public.assistant_actions for insert to authenticated
with check ((select auth.uid()) = user_id);

-- Undo stamps undone_at. Editing your own log could only ever point an Undo
-- at a value you could have typed into the contact yourself, so this grants
-- nothing the contact form does not already.
create policy "Users can mark their own actions undone"
on public.assistant_actions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- No delete policy: the log goes with the contact or the account, not one
-- line at a time. A record of what an AI did that it could quietly erase
-- would not be much of a record.

comment on table assistant_actions is
  'What the Assistant did without asking, with the value before and after, for the activity list and Undo. Never message text.';


-- ── ai_usage: the Assistant's own budget line ──────────────────────────────
--
-- The Assistant gets about $10 a month, separate from the $2 summaries and
-- drafts share, so one long conversation cannot use up the budget for a
-- summary you need tomorrow. Two changes make that true:
--
--   1. 'assistant' is a purpose, so its spending is its own rows.
--   2. The monthly total the cap is checked against counts ONE line: the
--      Assistant's rows for an Assistant request, everyone else's for the
--      rest. The same lock, the same reservation, the same settle — only the
--      sum is split.

alter table ai_usage drop constraint ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check
  check (purpose in ('summary', 'draft', 'promises', 'assistant'));

-- The same as 0010's, for one budget line. The old one-argument version is
-- left in place and no longer called, rather than dropped, so a half-deployed
-- server cannot fail on a missing function.
create or replace function private.ai_spent_this_month(p_user_id uuid, p_assistant boolean)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when status = 'settled' then cost_usd else reserved_usd end), 0)
  from public.ai_usage
  where user_id = p_user_id
    and (purpose = 'assistant') = p_assistant
    and created_at >= (date_trunc('month', now() at time zone 'Europe/Stockholm')
                       at time zone 'Europe/Stockholm');
$$;

revoke execute on function private.ai_spent_this_month(uuid, boolean) from public, anon, authenticated;

-- 0010's function, word for word, except the one line that picks the budget.
-- security definer, so the first check still matters most: the caller must be
-- the user they name.
create or replace function public.reserve_ai_spend(
  p_user_id    uuid,
  p_contact_id uuid,
  p_purpose    text,
  p_model      text,
  p_estimate   numeric,
  p_cap        numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent numeric;
  v_id    uuid;
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_estimate is null or p_estimate <= 0 or p_cap is null or p_cap < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  -- One lock for both lines: an Assistant step and a summary starting at the
  -- same moment wait for each other, which costs nothing and keeps this the
  -- same function it was.
  perform pg_advisory_xact_lock(hashtextextended('ai_spend:' || p_user_id::text, 0));

  -- The only changed line: count the budget this request draws from.
  v_spent := private.ai_spent_this_month(p_user_id, p_purpose = 'assistant');

  if v_spent + p_estimate > p_cap then
    raise exception 'ai_cap_reached'
      using errcode = 'P0001', detail = v_spent::text, hint = p_cap::text;
  end if;

  insert into public.ai_usage (user_id, contact_id, purpose, model, reserved_usd)
  values (p_user_id, p_contact_id, p_purpose, p_model, p_estimate)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.reserve_ai_spend(uuid, uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.reserve_ai_spend(uuid, uuid, text, text, numeric, numeric) to authenticated, service_role;
