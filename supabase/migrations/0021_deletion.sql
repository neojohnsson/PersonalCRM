-- 0021_deletion.sql
--
-- Slice 7: deletion that actually deletes (plan.md §3.12;
-- docs/slice-7-plan.md, Part 3).
--
--   delete_all_contacts  every contact and all the mail, keeping the account
--   delete_account       everything, including the login itself
--
-- "Delete one contact, delete all contacts, delete account — and it actually
-- deletes." A privacy page that promises deletion and leaves rows behind is
-- worse than no privacy page, so both of these are one statement each in one
-- transaction: it all goes, or none of it does.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/privacy-delete.test.ts describes what this must do. `npm test`.


-- ── delete_all_contacts ─────────────────────────────────────────────────────
--
-- The contacts, everything hanging off them by cascade (addresses, summaries,
-- next touches, promises, settled threads, drafts), and the stored mail.
--
-- The sync state goes too, so the next sync starts from the beginning rather
-- than carrying on from a history id for messages that are no longer here.
--
-- Two things are deliberately kept:
--   seen_once_dismissals  your decisions that those addresses are not people
--                         you know. Deleting them would only hand you the same
--                         list to dismiss again.
--   ai_usage              what was spent, which is your record, not theirs.
--                         Its contact_id is already set to null by 0010.
--
-- security invoker: it runs as the caller, so RLS decides whose rows these are.

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
end;
$$;

revoke execute on function public.delete_all_contacts(uuid) from public, anon;
grant execute on function public.delete_all_contacts(uuid) to authenticated;


-- ── delete_account ──────────────────────────────────────────────────────────
--
-- Everything, and the login with it. One delete is enough: every table in this
-- app hangs off auth.users, either directly or through contacts, and every one
-- of those foreign keys is `on delete cascade`. Nothing is listed here by name,
-- which means a table added by a later migration is covered the day it is
-- created rather than the day somebody remembers to add it.
--
-- security definer, because deleting from auth.users is not something an
-- ordinary user may do. That makes the first line the important one: the
-- function refuses to delete anybody but the caller. `set search_path = ''`
-- keeps a definer function from being tricked into calling something else's
-- code by a search path it didn't choose.
--
-- The Gmail refresh token is revoked at Google by the app *before* this runs
-- (app/privacy/actions.ts). Deleting the row here only makes the app forget it;
-- Google has to be told separately, and a token left alive after "delete
-- everything" would be the worst bug this app could have.

create or replace function public.delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke execute on function public.delete_account(uuid) from public, anon;
grant execute on function public.delete_account(uuid) to authenticated;
