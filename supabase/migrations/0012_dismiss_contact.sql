-- 0012_dismiss_contact.sql
--
-- Dismissing someone who is already a contact, from their contact page.
--
-- It means the same as Dismiss in Seen once (0007), and so it also removes
-- the contact: nothing is kept about a dismissed person beyond their address
-- (privacy.md). Taking a dismissal back needs no function — the policy "Users
-- can undo their own dismissals" in 0004 already lets you delete your own row.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/dismiss-contact.test.ts describes what this must do. `npm test`.


-- ── dismiss_contact ─────────────────────────────────────────────────────────
--
-- In one transaction — all of it happens, or none of it:
--
--   1. remember each of the contact's addresses in seen_once_dismissals, so
--      the sync skips their future mail and they don't come back as Seen once
--      or as a new contact
--   2. delete the messages they sent from those addresses. Mail the user sent
--      them is kept, as in 0007: it's the user's own mail
--   3. delete the contact. Its addresses, next touches and summaries go with
--      it (`on delete cascade` in 0004, 0009, 0010)
--
-- Two ways it refuses, and changes nothing when it does:
--
--   'Contact not found' (P0002)  the id isn't one of the caller's contacts —
--                                missing and someone else's look the same
--   'no_address'                 the contact has no email address. Then there
--                                is nothing to dismiss: this would only be a
--                                delete, and deleting contacts is slice 7
--
-- Returns how many addresses were remembered.
--
-- security invoker: runs as the caller, so RLS on every table applies. Someone
-- else's contact is invisible to the first query, and so "not found".

create or replace function public.dismiss_contact(p_user_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_emails     text[];
  v_contact    uuid;
begin
  -- Lock the contact's row, so an edit saved at the same moment can't add an
  -- address after we've read the list.
  select c.id
  into v_contact
  from public.contacts c
  where c.id = p_contact_id
    and c.user_id = p_user_id
  for update;

  if v_contact is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(ce.email), '{}')
  into v_emails
  from public.contact_emails ce
  where ce.contact_id = p_contact_id
    and ce.user_id = p_user_id;

  if cardinality(v_emails) = 0 then
    raise exception 'no_address';
  end if;

  insert into public.seen_once_dismissals (user_id, email)
  select p_user_id, e from unnest(v_emails) as e
  on conflict (user_id, email) do nothing;

  delete from public.gmail_messages m
  where m.user_id = p_user_id
    and m.direction = 'inbound'
    and lower(m.from_email) = any (v_emails);

  delete from public.contacts c
  where c.id = p_contact_id
    and c.user_id = p_user_id;

  return cardinality(v_emails);
end;
$$;


-- ── Who may run it ──────────────────────────────────────────────────────────

revoke execute on function public.dismiss_contact(uuid, uuid) from public, anon;
grant execute on function public.dismiss_contact(uuid, uuid) to authenticated, service_role;
