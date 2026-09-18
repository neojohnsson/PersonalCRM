-- 0017_merge_contacts.sql
--
-- Slice 6a: joining two contacts that are the same person
-- (plan.md §3.7; docs/slice-6a-plan.md, Part 2).
--
--   merge_contacts        move one contact into another, in one transaction
--   duplicate_dismissals  pairs you said are not the same person
--
-- Nothing here runs on its own. A person presses the button, having seen both
-- records: "never auto-merge — a wrong merge is destructive and
-- near-impossible to undo."
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/merge-contacts.test.ts describes what this must do. `npm test`.


-- ── duplicate_dismissals ────────────────────────────────────────────────────
--
-- "Not the same person." The pair is kept smallest id first, so the answer
-- holds whichever way round the pair is seen next time.

create table duplicate_dismissals (
  user_id    uuid not null references auth.users (id) on delete cascade,
  contact_a  uuid not null,
  contact_b  uuid not null,
  created_at timestamptz not null default now(),

  primary key (user_id, contact_a, contact_b),
  constraint duplicate_dismissals_ordered check (contact_a < contact_b),

  -- Both contacts must be the caller's own, as everywhere else.
  foreign key (contact_a, user_id) references contacts (id, user_id) on delete cascade,
  foreign key (contact_b, user_id) references contacts (id, user_id) on delete cascade
);

alter table duplicate_dismissals enable row level security;
revoke all on public.duplicate_dismissals from anon;

create policy "Users can view their own dismissed pairs"
on public.duplicate_dismissals for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can dismiss their own pairs"
on public.duplicate_dismissals for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can change their own dismissed pairs"
on public.duplicate_dismissals for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can undismiss their own pairs"
on public.duplicate_dismissals for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── merge_contacts ──────────────────────────────────────────────────────────
--
-- p_keep_id is the contact you chose to keep. p_merge_id is folded into it and
-- then deleted. All of it in one transaction: both contacts change, or neither.
--
--   addresses      move across; the kept contact keeps its own primary
--   empty fields   filled from the other; a field with something in it is
--                  never overwritten
--   notes          the other's are appended, with a line saying where from
--   tags           the union, each once
--   summary /      taken over only where the kept contact has none of its own;
--   next touch /   the rest go with the deleted contact
--   draft
--   messages       untouched — mail belongs to addresses, and the addresses
--                  are now the kept contact's
--
-- security invoker: it runs as the caller, so RLS decides which contacts they
-- may touch at all. Raises no_data_found (P0002) when either contact isn't
-- theirs, and invalid_parameter_value (22023) when both ids are the same.

create or replace function public.merge_contacts(
  p_user_id  uuid,
  p_keep_id  uuid,
  p_merge_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keep  public.contacts%rowtype;
  v_merge public.contacts%rowtype;
begin
  if p_user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'same_contact' using errcode = '22023';
  end if;

  -- for update: nobody else may change either row while this runs.
  select * into v_keep from public.contacts
    where id = p_keep_id and user_id = p_user_id for update;
  select * into v_merge from public.contacts
    where id = p_merge_id and user_id = p_user_id for update;

  if v_keep.id is null or v_merge.id is null then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;

  -- The addresses first: they are what mail is matched by.
  update public.contact_emails
  set contact_id = p_keep_id, is_primary = false
  where user_id = p_user_id and contact_id = p_merge_id;

  -- Fill what's empty; never overwrite what the user wrote.
  update public.contacts
  set first_name = coalesce(nullif(btrim(v_keep.first_name), ''), v_merge.first_name),
      last_name  = coalesce(nullif(btrim(v_keep.last_name), ''),  v_merge.last_name),
      company    = coalesce(nullif(btrim(v_keep.company), ''),    v_merge.company),
      role       = coalesce(nullif(btrim(v_keep.role), ''),       v_merge.role),
      one_liner  = coalesce(nullif(btrim(v_keep.one_liner), ''),  v_merge.one_liner),
      how_known  = coalesce(nullif(btrim(v_keep.how_known), ''),  v_merge.how_known),
      phone      = coalesce(nullif(btrim(v_keep.phone), ''),      v_merge.phone),
      notes      = case
                     when nullif(btrim(v_merge.notes), '') is null then v_keep.notes
                     when nullif(btrim(v_keep.notes), '') is null then v_merge.notes
                     else v_keep.notes || E'\n\n— merged from the duplicate —\n' || v_merge.notes
                   end,
      tags       = (
                     select coalesce(array_agg(distinct tag), '{}')
                     from unnest(v_keep.tags || v_merge.tags) as tag
                   ),
      updated_at = now()
  where id = p_keep_id and user_id = p_user_id;

  -- The other's summary, next touch and draft only where the kept contact has
  -- none. Anything left is deleted with the contact, by the cascade.
  update public.contact_summaries
  set contact_id = p_keep_id
  where user_id = p_user_id and contact_id = p_merge_id
    and not exists (
      select 1 from public.contact_summaries kept
      where kept.user_id = p_user_id and kept.contact_id = p_keep_id
        and kept.status = public.contact_summaries.status
    );

  update public.next_touches
  set contact_id = p_keep_id
  where user_id = p_user_id and contact_id = p_merge_id and status = 'open'
    and not exists (
      select 1 from public.next_touches kept
      where kept.user_id = p_user_id and kept.contact_id = p_keep_id and kept.status = 'open'
    );

  update public.contact_drafts
  set contact_id = p_keep_id
  where user_id = p_user_id and contact_id = p_merge_id and status = 'pending'
    and not exists (
      select 1 from public.contact_drafts kept
      where kept.user_id = p_user_id and kept.contact_id = p_keep_id and kept.status = 'pending'
    );

  -- Anything that pointed at the merged contact and stayed behind goes with it.
  delete from public.contacts where id = p_merge_id and user_id = p_user_id;

  return p_keep_id;
end;
$$;

revoke execute on function public.merge_contacts(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, uuid) to authenticated, service_role;
