-- 0010_ai_summaries.sql
--
-- Slice 4, step 2: where AI summaries and AI spending are kept
-- (docs/slice-4-plan.md, Parts 2, 4 and 5).
--
--   contact_summaries        a contact's summary: pending until a human approves
--   approve_contact_summary  make a pending summary the contact's summary
--   ai_usage                 every request to the AI, with what it cost
--   reserve_ai_spend         before a request: hold back its most possible cost,
--                            or refuse if that would pass the monthly cap
--   settle_ai_spend          after it: record what it really cost
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/ai-summaries.test.ts describes what this must do. `npm test`.


-- ── contact_summaries ───────────────────────────────────────────────────────

create table contact_summaries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  contact_id    uuid not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved')),

  -- The four parts (plan.md §3.6). Null: the messages didn't say.
  who_they_are  text check (char_length(who_they_are) <= 2000),
  how_you_know  text check (char_length(how_you_know) <= 2000),
  discussed     text check (char_length(discussed) <= 2000),
  next_step     text check (char_length(next_step) <= 2000),

  -- Which messages each part came from:
  -- {"discussed": [{"messageId": "…", "threadId": "…"}], …}
  sources       jsonb not null default '{}'
                  check (jsonb_typeof(sources) = 'object'),

  -- "As of 12 Sep": the newest message the summary read.
  as_of         timestamptz not null,
  -- True once a human has changed the words. A new AI version never replaces
  -- it on its own; it waits beside it as pending.
  edited        boolean not null default false,
  model         text not null check (char_length(model) <= 100),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  approved_at   timestamptz,

  -- The contact AND its owner, checked together, as in 0004 and 0009.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

-- At most one of each per contact: the summary, and the proposal waiting
-- beside it. Partial unique indexes only count rows with that status.
create unique index contact_summaries_one_pending
  on contact_summaries (contact_id) where status = 'pending';
create unique index contact_summaries_one_approved
  on contact_summaries (contact_id) where status = 'approved';

alter table contact_summaries enable row level security;
revoke all on public.contact_summaries from anon;


-- ── Policies ────────────────────────────────────────────────────────────────
--
-- The usual four, with one addition: a summary can only be CREATED as pending
-- and unedited. That's AGENTS.md's "every AI output lands in a pending state a
-- human approves", held by the database rather than only by the app's code.
-- Approving is an update, made by a person pressing a button.

create policy "Users can view their own summaries"
on public.contact_summaries for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own summaries, as pending"
on public.contact_summaries for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and edited = false
  and approved_at is null
);

create policy "Users can update their own summaries"
on public.contact_summaries for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own summaries"
on public.contact_summaries for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── approve_contact_summary ─────────────────────────────────────────────────
--
-- Approve: the pending summary becomes the contact's summary, and the one it
-- replaces is deleted — both or neither, in one transaction, so a contact is
-- never left with no summary or with two.
--
-- security invoker: runs as the caller, so the policies above decide which
-- summaries they can touch. Someone else's pending summary is simply not found.
--
-- Raises no_data_found (P0002) when there's no such pending summary.

create or replace function public.approve_contact_summary(
  p_user_id    uuid,
  p_summary_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contact_id uuid;
begin
  select contact_id into v_contact_id
  from public.contact_summaries
  where id = p_summary_id
    and user_id = p_user_id
    and status = 'pending'
  for update;

  if v_contact_id is null then
    raise exception 'summary_not_found' using errcode = 'P0002';
  end if;

  delete from public.contact_summaries
  where contact_id = v_contact_id
    and user_id = p_user_id
    and status = 'approved';

  update public.contact_summaries
  set status = 'approved', approved_at = now(), updated_at = now()
  where id = p_summary_id;

  return p_summary_id;
end;
$$;

revoke execute on function public.approve_contact_summary(uuid, uuid) from public, anon;
grant execute on function public.approve_contact_summary(uuid, uuid) to authenticated, service_role;


-- ── ai_usage ────────────────────────────────────────────────────────────────
--
-- One row per request to the AI. The monthly cap is checked against these.
--
-- A user can READ their rows but not write them: no insert, update or delete
-- policy, and the table privileges are taken away too. Otherwise anyone could
-- delete their own rows over the API and spend past the cap. Rows are only
-- written by the two functions below.

create table ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  contact_id    uuid,
  purpose       text not null check (purpose in ('summary')),
  model         text not null check (char_length(model) <= 100),

  -- reserved: the request is under way, and its most possible cost counts.
  -- settled:  it's over, and its real cost counts.
  status        text not null default 'reserved'
                  check (status in ('reserved', 'settled')),
  reserved_usd  numeric(12, 6) not null check (reserved_usd > 0),
  cost_usd      numeric(12, 6) check (cost_usd >= 0),
  input_tokens  integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),

  created_at    timestamptz not null default now(),
  settled_at    timestamptz,

  -- Deleting a contact keeps the spending record, without the contact.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete set null (contact_id)
);

-- The cap sums one user's rows for this month.
create index ai_usage_user_month on ai_usage (user_id, created_at);

alter table ai_usage enable row level security;
revoke all on public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_usage from authenticated;

create policy "Users can view their own AI usage"
on public.ai_usage for select to authenticated
using ((select auth.uid()) = user_id);


-- ── private.ai_spent_this_month ─────────────────────────────────────────────
--
-- What a user has spent this calendar month, in Swedish time: real costs of
-- finished requests, plus the reservations of ones still under way. A request
-- that never finished keeps counting at its reservation — the safe mistake.

create or replace function private.ai_spent_this_month(p_user_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when status = 'settled' then cost_usd else reserved_usd end), 0)
  from public.ai_usage
  where user_id = p_user_id
    and created_at >= (date_trunc('month', now() at time zone 'Europe/Stockholm')
                       at time zone 'Europe/Stockholm');
$$;

revoke execute on function private.ai_spent_this_month(uuid) from public, anon, authenticated;


-- ── reserve_ai_spend ────────────────────────────────────────────────────────
--
-- Called by the server before every AI request.
--
--   1. Lock this user's spending, so two requests at the same moment wait for
--      each other instead of both reading "$1.99 spent" and both going ahead.
--   2. Spent this month + this request's most possible cost > cap → refuse
--      with ai_cap_reached. No request is sent.
--   3. Otherwise write a 'reserved' row and return its id.
--
-- security definer: it runs with the table owner's rights, because users may
-- not write ai_usage themselves. That makes the first check essential: the
-- caller must be the user they name.
--
-- The cap comes from the server's LLM_MONTHLY_CAP_USD. Someone calling this
-- directly over the API with a bigger cap only writes a reservation; it sends
-- nothing to the AI and spends nothing. The request that costs money is only
-- ever made by the server, after its own call here with the real cap.

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

  -- Held until this transaction ends. hashtextextended gives a 64-bit key.
  perform pg_advisory_xact_lock(hashtextextended('ai_spend:' || p_user_id::text, 0));

  v_spent := private.ai_spent_this_month(p_user_id);

  if v_spent + p_estimate > p_cap then
    raise exception 'ai_cap_reached'
      using errcode = 'P0001', detail = v_spent::text, hint = p_cap::text;
  end if;

  -- The contact must be the caller's: the composite foreign key checks it.
  insert into public.ai_usage (user_id, contact_id, purpose, model, reserved_usd)
  values (p_user_id, p_contact_id, p_purpose, p_model, p_estimate)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.reserve_ai_spend(uuid, uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.reserve_ai_spend(uuid, uuid, text, text, numeric, numeric) to authenticated, service_role;


-- ── settle_ai_spend ─────────────────────────────────────────────────────────
--
-- Called by the server after the request: the real cost and token counts.
-- A failed request settles at what it cost — usually 0.
--
-- The cost can only go UP from what's already recorded (greatest). Someone
-- calling this directly with 0 can't make a finished request count for less:
-- if they get there first, the server's real figure still replaces the 0.

create or replace function public.settle_ai_spend(
  p_user_id       uuid,
  p_usage_id      uuid,
  p_cost          numeric,
  p_input_tokens  integer,
  p_output_tokens integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  update public.ai_usage
  set status        = 'settled',
      cost_usd      = greatest(coalesce(cost_usd, 0), p_cost),
      input_tokens  = greatest(coalesce(input_tokens, 0), coalesce(p_input_tokens, 0)),
      output_tokens = greatest(coalesce(output_tokens, 0), coalesce(p_output_tokens, 0)),
      settled_at    = now()
  where id = p_usage_id
    and user_id = p_user_id;

  if not found then
    raise exception 'usage_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.settle_ai_spend(uuid, uuid, numeric, integer, integer) from public, anon;
grant execute on function public.settle_ai_spend(uuid, uuid, numeric, integer, integer) to authenticated, service_role;
