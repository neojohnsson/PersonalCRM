-- 0006_contact_list.sql
--
-- Slice 2, step 4: what the contact list shows, in one query.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/rls-contact-list.test.ts describes what this must do. `npm test`.


-- ── contact_list ────────────────────────────────────────────────────────────
--
-- One row per contact:
--
--   primary_email     the address marked primary, or null (a contact added by
--                     hand may have none)
--   emails            every address, primary first
--   message_count     messages with ANY of the contact's addresses — someone
--   last_contact_at   who writes from work and from Gmail is one person
--   search_text       name, company, role, tags and addresses, lowercased, so
--                     a single search matches any of them
--
-- security_invoker, like people and person_tiers: it runs as the person asking,
-- so the RLS on contacts, contact_emails and gmail_messages decides what they
-- see. The view needs no policies of its own.

create view contact_list
with (security_invoker = true)
as
with addresses as (
  select
    contact_id,
    user_id,
    max(email) filter (where is_primary)              as primary_email,
    array_agg(email order by is_primary desc, email)  as emails
  from contact_emails
  group by contact_id, user_id
),
activity as (
  select
    ce.contact_id,
    ce.user_id,
    sum(p.message_count)::integer as message_count,
    max(p.last_contact_at)        as last_contact_at
  from contact_emails ce
  join people p
    on p.user_id = ce.user_id and p.email = ce.email
  group by ce.contact_id, ce.user_id
)
select
  c.id,
  c.user_id,
  c.first_name,
  c.last_name,
  c.company,
  c.role,
  c.tags,
  c.source,
  c.created_at,
  a.primary_email,
  coalesce(a.emails, '{}')         as emails,
  coalesce(act.message_count, 0)   as message_count,
  act.last_contact_at,
  lower(concat_ws(' ',
    c.first_name,
    c.last_name,
    c.company,
    c.role,
    array_to_string(c.tags, ' '),
    array_to_string(a.emails, ' ')
  )) as search_text
from contacts c
left join addresses a
  on a.contact_id = c.id and a.user_id = c.user_id
left join activity act
  on act.contact_id = c.id and act.user_id = c.user_id;

-- concat_ws skips nulls, so a contact with no company or no address still gets
-- a clean search_text.

revoke all on public.contact_list from anon;
