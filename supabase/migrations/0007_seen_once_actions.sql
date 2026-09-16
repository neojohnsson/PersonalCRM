-- 0007_seen_once_actions.sql
--
-- Slice 2, step 5: what the Seen once queue's buttons do.
--
--   Add as contact  → add_seen_once_contacts(user, emails)
--   Dismiss         → dismiss_seen_once(user, emails)
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/seen-once.test.ts describes what this must do. `npm test`.


-- ── A schema the API can't reach ────────────────────────────────────────────
--
-- Supabase's API only exposes the `public` schema. Helpers that should only
-- ever be called by the functions below live in `private`, so nobody can call
-- them directly over the API.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;


-- ── private.split_name ──────────────────────────────────────────────────────
--
-- The name split from 0005, pulled out so the import and "Add as contact" can
-- never disagree about it:
--
--   "Karin Lindqvist"   → Karin / Lindqvist
--   "Anna Maria Ek"     → Anna Maria / Ek
--   "Lindqvist, Pelle"  → Pelle / Lindqvist
--   "Kim"               → Kim / —
--   no name             → — / —

create or replace function private.split_name(
  full_name text,
  out first_name text,
  out last_name text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(full_name), '');
begin
  if v_name is null then
    first_name := null;
    last_name  := null;
  elsif strpos(v_name, ',') > 0 then
    last_name  := nullif(btrim(split_part(v_name, ',', 1)), '');
    first_name := nullif(btrim(substr(v_name, strpos(v_name, ',') + 1)), '');
  elsif v_name !~ '\s' then
    first_name := v_name;
    last_name  := null;
  else
    first_name := regexp_replace(v_name, '\s+\S+$', '');
    last_name  := substring(v_name from '(\S+)$');
  end if;
end;
$$;


-- ── private.create_contacts ─────────────────────────────────────────────────
--
-- The body of 0005's import_contacts, shared: create a contact and its primary
-- address for each person in person_tiers who has no contact yet — limited to
-- one tier, and optionally to a list of addresses.
--
-- Same guarantees as before: contact and address in one transaction, never an
-- update, and a concurrent call that loses the race on the unique address
-- removes the contact it just made.
--
-- security invoker: it runs as the caller, so RLS on person_tiers decides whose
-- people it can see at all.

create or replace function private.create_contacts(
  p_user_id uuid,
  p_tier    text,
  p_emails  text[] default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  person        record;
  v_name        record;
  v_contact_id  uuid;
  v_created     integer := 0;
begin
  for person in
    select t.email, t.name, t.last_thread_id
    from public.person_tiers t
    where t.user_id = p_user_id
      and t.tier = p_tier
      and t.contact_id is null
      and (p_emails is null or t.email = any (p_emails))
  loop
    v_name := private.split_name(person.name);

    insert into public.contacts (user_id, first_name, last_name, source, source_thread_id)
    values (p_user_id, v_name.first_name, v_name.last_name, 'gmail', person.last_thread_id)
    returning id into v_contact_id;

    insert into public.contact_emails (user_id, contact_id, email, is_primary)
    values (p_user_id, v_contact_id, person.email, true)
    on conflict (user_id, email) do nothing;

    if found then
      v_created := v_created + 1;
    else
      delete from public.contacts where id = v_contact_id;
    end if;
  end loop;

  return v_created;
end;
$$;


-- ── import_contacts: now uses the shared body ───────────────────────────────
--
-- Same name, same parameter, same behaviour as in 0005 — every two-way person
-- without a contact becomes one.

create or replace function public.import_contacts(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.create_contacts(p_user_id, 'contact');
end;
$$;


-- ── add_seen_once_contacts ──────────────────────────────────────────────────
--
-- "Add as contact" in the Seen once queue. Only acts on addresses that are in
-- Seen once right now: an address that's already a contact, dismissed, or
-- unknown is quietly left alone. Returns how many contacts were created.

create or replace function public.add_seen_once_contacts(p_user_id uuid, p_emails text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.create_contacts(p_user_id, 'seen_once', p_emails);
end;
$$;


-- ── dismiss_seen_once ───────────────────────────────────────────────────────
--
-- "Dismiss" in the Seen once queue (slice-2-plan.md, decision A), in one
-- transaction:
--
--   1. remember the address in seen_once_dismissals, so the sync skips their
--      future mail and they never show up again
--   2. delete the messages they sent — "beyond a 'seen once' address", nothing
--      from mail you never replied to is kept (privacy.md)
--
-- Mail the user sent them is kept: it's the user's own mail, and it may have
-- gone to other people too.
--
-- The guard: only addresses in Seen once right now are touched. Without it, a
-- hand-made request could "dismiss" a real contact and wipe their messages.
-- Returns how many people were dismissed.

create or replace function public.dismiss_seen_once(p_user_id uuid, p_emails text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_emails     text[];
  v_dismissed  integer;
begin
  select coalesce(array_agg(t.email), '{}')
  into v_emails
  from public.person_tiers t
  where t.user_id = p_user_id
    and t.tier = 'seen_once'
    and t.contact_id is null
    and t.email = any (p_emails);

  insert into public.seen_once_dismissals (user_id, email)
  select p_user_id, e from unnest(v_emails) as e
  on conflict (user_id, email) do nothing;

  get diagnostics v_dismissed = row_count;

  delete from public.gmail_messages m
  where m.user_id = p_user_id
    and m.direction = 'inbound'
    and lower(m.from_email) = any (v_emails);

  return v_dismissed;
end;
$$;


-- ── Who may run what ────────────────────────────────────────────────────────
--
-- Supabase lets anyone call a function through the API unless told otherwise.
-- Signed-out visitors get none of these.

revoke execute on function private.split_name(text) from public, anon;
revoke execute on function private.create_contacts(uuid, text, text[]) from public, anon;
revoke execute on function public.add_seen_once_contacts(uuid, text[]) from public, anon;
revoke execute on function public.dismiss_seen_once(uuid, text[]) from public, anon;

grant execute on function private.split_name(text) to authenticated, service_role;
grant execute on function private.create_contacts(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.add_seen_once_contacts(uuid, text[]) to authenticated, service_role;
grant execute on function public.dismiss_seen_once(uuid, text[]) to authenticated, service_role;
