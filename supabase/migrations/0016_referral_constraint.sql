-- 0016_referral_constraint.sql
--
-- 0013 said: a referral's address or date means nothing without a name, and
-- the name lived in its own column. Since 0015 the names live in the
-- `suggested_referrals` list, so a summary with a list and a date but no
-- `suggested_referral_name` was refused.
--
-- The rule is the same, now counting the list too.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.

alter table contact_summaries
  drop constraint contact_summaries_referral_has_name;

alter table contact_summaries
  add constraint contact_summaries_referral_has_name
    check (
      suggested_referral_name is not null
      or jsonb_array_length(suggested_referrals) > 0
      or (suggested_referral_email is null and suggested_referral_since is null)
    );
