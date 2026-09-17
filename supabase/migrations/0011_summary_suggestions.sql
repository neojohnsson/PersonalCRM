-- 0011_summary_suggestions.sql
--
-- Slice 4, step 8: what a summary suggests for the contact itself
-- (docs/slice-4-plan.md, Part 7).
--
--   suggested_company       → the contact's Company, with one click
--   suggested_role          → the contact's Role, with one click
--   suggested_touch_reason  → the Next touch form, filled in for you to check
--   suggested_touch_on      → its date, only when the emails give one
--
-- Each suggestion's source messages go in the existing `sources` column, under
-- its own key ("company", "role", "next_touch").
--
-- They live on the summary row, so they're pending, approved, discarded and
-- replaced together with it. The table's RLS policies from 0010 already cover
-- the new columns: nobody can read or change another user's suggestions.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.

alter table contact_summaries
  -- Same limits as the contact fields they're meant for (lib/contacts/contact-form.ts)
  -- and as a next touch's reason (0009).
  add column suggested_company      text check (char_length(suggested_company) <= 200),
  add column suggested_role         text check (char_length(suggested_role) <= 200),
  add column suggested_touch_reason text check (char_length(suggested_touch_reason) <= 300),
  add column suggested_touch_on     date,

  -- A date with no reason says nothing a person can check.
  add constraint contact_summaries_touch_date_has_reason
    check (suggested_touch_on is null or suggested_touch_reason is not null);
