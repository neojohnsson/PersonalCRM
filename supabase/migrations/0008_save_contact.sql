-- 0008_save_contact.sql
--
-- Slice 2, step 6: saving a contact from the add and edit forms.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/save-contact.test.ts describes what this must do. `npm test`.


-- ── save_contact ────────────────────────────────────────────────────────────
--
-- Creates a contact (p_contact_id null) or updates one, and sets its addresses
-- to exactly p_emails — the first one primary — all in one transaction.
-- Returns the contact's id.
--
-- p_contact holds the fields: first_name, last_name, company, role,
-- one_liner, how_known, phone, notes (text or null) and tags (an array).
-- They're saved as given; the app has already trimmed and checked them.
--
-- Two ways it refuses, and saves nothing when it does:
--
--   'Contact not found' (P0002)  the id isn't one of the caller's contacts —
--                                missing and someone else's look the same
--   'address_taken'              an address belongs to another of the
--                                caller's contacts. DETAIL is the address,
--                                HINT is that contact's name, so the form can
--                                say whose it is.
--
-- A contact created here has source 'manual'. Editing never changes a
-- contact's source.
--
-- security invoker: runs as the caller, so RLS on contacts and contact_emails
-- applies to every read and write.

create or replace function public.save_contact(
  p_user_id    uuid,
  p_contact_id uuid,
  p_contact    jsonb,
  p_emails     text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      uuid;
  v_emails  text[] := coalesce(p_emails, '{}');
  v_tags    text[] := coalesce(
                        array(select jsonb_array_elements_text(p_contact -> 'tags')),
                        '{}'
                      );
  v_taken   record;
begin
  if p_contact_id is null then
    insert into public.contacts (
      user_id, first_name, last_name, company, role,
      one_liner, how_known, phone, notes, tags, source
    )
    values (
      p_user_id,
      p_contact ->> 'first_name',
      p_contact ->> 'last_name',
      p_contact ->> 'company',
      p_contact ->> 'role',
      p_contact ->> 'one_liner',
      p_contact ->> 'how_known',
      p_contact ->> 'phone',
      p_contact ->> 'notes',
      v_tags,
      'manual'
    )
    returning id into v_id;
  else
    update public.contacts
    set first_name = p_contact ->> 'first_name',
        last_name  = p_contact ->> 'last_name',
        company    = p_contact ->> 'company',
        role       = p_contact ->> 'role',
        one_liner  = p_contact ->> 'one_liner',
        how_known  = p_contact ->> 'how_known',
        phone      = p_contact ->> 'phone',
        notes      = p_contact ->> 'notes',
        tags       = v_tags,
        updated_at = now()
    where id = p_contact_id
      and user_id = p_user_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Contact not found' using errcode = 'P0002';
    end if;
  end if;

  -- An address may belong to only one of your contacts. Check first, so the
  -- error can say whose it is — the unique index would only say "duplicate".
  select ce.email, c.first_name, c.last_name
  into v_taken
  from public.contact_emails ce
  join public.contacts c
    on c.id = ce.contact_id and c.user_id = ce.user_id
  where ce.user_id = p_user_id
    and ce.contact_id <> v_id
    and ce.email = any (v_emails)
  limit 1;

  if found then
    raise exception 'address_taken'
      using detail = v_taken.email,
            hint = coalesce(
              nullif(btrim(concat_ws(' ', v_taken.first_name, v_taken.last_name)), ''),
              v_taken.email
            );
  end if;

  -- Addresses no longer on the form go.
  delete from public.contact_emails
  where contact_id = v_id
    and user_id = p_user_id
    and not (email = any (v_emails));

  -- Clear the primary flag before setting it again: at most one primary per
  -- contact is enforced by a unique index, even for a moment.
  update public.contact_emails
  set is_primary = false
  where contact_id = v_id
    and user_id = p_user_id
    and is_primary;

  -- Add the new ones; the first address in the list is primary.
  insert into public.contact_emails (user_id, contact_id, email, is_primary)
  select p_user_id, v_id, e.email, e.position = 1
  from unnest(v_emails) with ordinality as e(email, position)
  on conflict (user_id, email) do update
    set is_primary = excluded.is_primary
    where public.contact_emails.contact_id = excluded.contact_id;

  return v_id;
end;
$$;

revoke execute on function public.save_contact(uuid, uuid, jsonb, text[]) from public, anon;
grant execute on function public.save_contact(uuid, uuid, jsonb, text[]) to authenticated, service_role;
