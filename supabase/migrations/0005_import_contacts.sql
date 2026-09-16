-- 0005_import_contacts.sql
--
-- Slice 2, step 3: everyone you've exchanged mail with in both directions
-- becomes a contact, automatically, when a sync finishes.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/import-contacts.test.ts describes what this must do. `npm test`.


-- ── import_contacts ─────────────────────────────────────────────────────────
--
-- For each person in person_tiers with tier 'contact' and no contact record:
-- create the contact (name split into first and last) and its primary address.
-- Returns how many contacts it created.
--
-- Why a database function and not two calls from TypeScript: the contact and
-- its address are created together, in one transaction. If anything fails
-- halfway, neither exists — there's never a contact without its address.
--
-- It never updates anything. A contact that already exists is left exactly as
-- it is, so what the user typed is never replaced by what a sync found.
--
-- security invoker: it runs as whoever calls it, so every table's RLS applies.
-- If Bob calls import_contacts(<Alice's id>), person_tiers shows him none of
-- Alice's people, and nothing is created. The scheduled sync later calls it
-- with the secret key, which is why the user id is a parameter rather than
-- auth.uid().
--
-- set search_path = '': every name below is written in full (public.contacts),
-- so a table someone creates in another schema can never be picked up instead.

create or replace function public.import_contacts(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  person        record;
  full_name     text;
  v_first_name  text;
  v_last_name   text;
  v_contact_id  uuid;
  v_imported    integer := 0;
begin
  for person in
    select t.email, t.name, t.last_thread_id
    from public.person_tiers t
    where t.user_id = p_user_id
      and t.tier = 'contact'
      and t.contact_id is null
  loop
    -- Split the name the way people write it in email:
    --   "Karin Lindqvist"   → Karin / Lindqvist
    --   "Anna Maria Ek"     → Anna Maria / Ek       (last word is the last name)
    --   "Lindqvist, Pelle"  → Pelle / Lindqvist     (comma: last name first)
    --   "Kim"               → Kim / —
    --   no name             → — / —                 (the address stands in)
    full_name := nullif(btrim(person.name), '');

    if full_name is null then
      v_first_name := null;
      v_last_name  := null;
    elsif strpos(full_name, ',') > 0 then
      v_last_name  := nullif(btrim(split_part(full_name, ',', 1)), '');
      v_first_name := nullif(btrim(substr(full_name, strpos(full_name, ',') + 1)), '');
    elsif full_name !~ '\s' then
      v_first_name := full_name;
      v_last_name  := null;
    else
      v_first_name := regexp_replace(full_name, '\s+\S+$', '');
      v_last_name  := substring(full_name from '(\S+)$');
    end if;

    insert into public.contacts (user_id, first_name, last_name, source, source_thread_id)
    values (p_user_id, v_first_name, v_last_name, 'gmail', person.last_thread_id)
    returning id into v_contact_id;

    -- Two imports running at once (two tabs finishing a sync together) can
    -- both get here for the same person. The address is unique per user, so
    -- only one of them can attach it. The other attaches nothing — and then
    -- removes the contact it just made, so no duplicate and no contact
    -- without an address is left behind.
    insert into public.contact_emails (user_id, contact_id, email, is_primary)
    values (p_user_id, v_contact_id, person.email, true)
    on conflict (user_id, email) do nothing;

    if found then
      v_imported := v_imported + 1;
    else
      delete from public.contacts where id = v_contact_id;
    end if;
  end loop;

  return v_imported;
end;
$$;

-- Supabase lets anyone call a function in `public` through the API unless told
-- otherwise. Signed-out visitors have no business importing anything.
revoke execute on function public.import_contacts(uuid) from public, anon;
grant execute on function public.import_contacts(uuid) to authenticated, service_role;
