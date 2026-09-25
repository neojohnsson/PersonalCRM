-- 0028_allowance.sql
--
-- Slice 13, commit 3: the free allowance (docs/slice-13-plan.md §2).
--
--   ai_usage.counts_as_use   whether this row is one "use" of the allowance:
--                            a summary, a draft, a scan, or the FIRST step of
--                            an Assistant question. The later steps of the
--                            same question, and Carry on, are false.
--   reserve_ai_use           reserve_ai_spend with one more check: a plan with
--                            an allowance is refused at its limit, counted
--                            inside the same lock
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.
-- tests/allowance.test.ts covers it with two users. `npm test`.


-- ── counts_as_use ──────────────────────────────────────────────────────────
--
-- Every row so far was one use, so true is right for them. Nobody can change
-- it through the API: 0010 revoked insert, update and delete on ai_usage from
-- `authenticated`, so the only writer is the function below.

alter table ai_usage add column counts_as_use boolean not null default true;

-- The allowance counts one user's uses of one purpose this month.
create index ai_usage_user_purpose_month on ai_usage (user_id, purpose, created_at);


-- ── How many uses this month ───────────────────────────────────────────────
--
-- A request that failed before it cost anything -- OpenAI down, a timeout --
-- settles at 0 and is not a use: you did not get a summary, so you did not
-- use one. One still under way (reserved) counts, so two presses at once
-- cannot both squeeze under the limit.

create or replace function private.ai_uses_this_month(p_user_id uuid, p_purpose text)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.ai_usage
  where user_id = p_user_id
    and purpose = p_purpose
    and counts_as_use
    and (status = 'reserved' or cost_usd > 0)
    and created_at >= (date_trunc('month', now() at time zone 'Europe/Stockholm')
                       at time zone 'Europe/Stockholm');
$$;

revoke execute on function private.ai_uses_this_month(uuid, text) from public, anon, authenticated;


-- ── reserve_ai_use ─────────────────────────────────────────────────────────
--
-- 0025's reserve_ai_spend, with the allowance added. A NEW name rather than a
-- changed one: production still calls reserve_ai_spend with six arguments,
-- and Postgres treats a seventh argument as a second function, which would
-- make that call ambiguous. So the old one stays until slice 13 is deployed.
--
-- The server says what the limits are (lib/plans/plans.ts, through the user's
-- plan). That is safe because calling this function does nothing on its own:
-- it writes a row in YOUR usage, and only the server holds the OpenAI key. A
-- person calling it directly with no limit reserves spending they can never
-- use -- they can only make their own budget smaller.
--
-- security definer, so the first check still matters most: the caller must be
-- the user they name.

create or replace function public.reserve_ai_use(
  p_user_id       uuid,
  p_contact_id    uuid,
  p_purpose       text,
  p_model         text,
  p_estimate      numeric,
  p_cap           numeric,
  p_max_uses      integer,
  p_counts_as_use boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent numeric;
  v_uses  integer;
  v_id    uuid;
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_estimate is null or p_estimate <= 0 or p_cap is null or p_cap < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if (p_max_uses is not null and p_max_uses < 0) or p_counts_as_use is null then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  -- The same lock as reserve_ai_spend, so the old and the new function wait
  -- for each other too. Inside it, "4 of 5 used" cannot be read by two
  -- requests at once: the second one waits, then sees 5.
  perform pg_advisory_xact_lock(hashtextextended('ai_spend:' || p_user_id::text, 0));

  -- The allowance: only a request that is a use is checked against it. A
  -- later step of an Assistant question belongs to a question already
  -- counted, and is held by the dollar limit below instead.
  if p_max_uses is not null and p_counts_as_use then
    v_uses := private.ai_uses_this_month(p_user_id, p_purpose);
    if v_uses >= p_max_uses then
      raise exception 'ai_allowance_used'
        using errcode = 'P0001', detail = v_uses::text, hint = p_max_uses::text;
    end if;
  end if;

  -- The dollar limit, exactly as before.
  v_spent := private.ai_spent_this_month(p_user_id, p_purpose = 'assistant');
  if v_spent + p_estimate > p_cap then
    raise exception 'ai_cap_reached'
      using errcode = 'P0001', detail = v_spent::text, hint = p_cap::text;
  end if;

  insert into public.ai_usage (user_id, contact_id, purpose, model, reserved_usd, counts_as_use)
  values (p_user_id, p_contact_id, p_purpose, p_model, p_estimate, p_counts_as_use)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.reserve_ai_use(uuid, uuid, text, text, numeric, numeric, integer, boolean) from public, anon;
grant execute on function public.reserve_ai_use(uuid, uuid, text, text, numeric, numeric, integer, boolean) to authenticated, service_role;
