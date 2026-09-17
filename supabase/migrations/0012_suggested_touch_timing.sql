-- 0012_suggested_touch_timing.sql
--
-- Next-touch dates when the emails give none (docs/next-touch-dates-plan.md).
--
--   suggested_touch_why    the AI's one sentence on why that timing, shown next to the date
--   suggested_touch_rough  true when the date is only a rough guess (a later event with
--                          no month named): the page says "pick a better date"
--
-- The date itself is still suggested_touch_on (0011), now worked out by the rules in
-- lib/relationship/touch-date.ts. The RLS policies of 0010 cover the new columns.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.

alter table contact_summaries
  add column suggested_touch_why   text check (char_length(suggested_touch_why) <= 300),
  add column suggested_touch_rough boolean not null default false;
