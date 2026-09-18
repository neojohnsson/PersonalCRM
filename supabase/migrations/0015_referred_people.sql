-- 0015_referred_people.sql
--
-- A referral can be to more than one person (docs/thread-context-plan.md,
-- Part 2). Real case: "Carl-Johan suggested contacting Oskar or Pontus" was
-- stored as one name, "Oskar or Pontus", so the check looked for a person by
-- that name and found nobody.
--
--   suggested_referrals  [{ "name": "Pontus", "email": "pontus@atea.se" }, …]
--                        email is null when the emails didn't give one.
--
-- The 0013 columns stay for the summaries already saved; new summaries write
-- this list. When it's set, it is what the page reads.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.

alter table contact_summaries
  add column suggested_referrals jsonb not null default '[]'
    check (jsonb_typeof(suggested_referrals) = 'array' and jsonb_array_length(suggested_referrals) <= 5);
