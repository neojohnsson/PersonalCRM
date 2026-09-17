-- 0013_suggested_referral.sql
--
-- The referral check (plan.md §3.4): when a summary's next step is "contact
-- someone they pointed you to", who that is and when it was said.
--
--   suggested_referral_name   "Niklas Hedlund", as the email wrote it
--   suggested_referral_email  their address, only if the emails gave one
--   suggested_referral_since  when the email with the referral was sent
--
-- Whether you've written to them since isn't stored: it's worked out each time
-- the contact page opens (lib/relationship/referral.ts), so writing to them
-- tomorrow shows up without regenerating anything. The RLS policies of 0010
-- cover the new columns.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.

alter table contact_summaries
  add column suggested_referral_name  text check (char_length(suggested_referral_name) <= 200),
  add column suggested_referral_email text check (char_length(suggested_referral_email) <= 320),
  add column suggested_referral_since timestamptz,

  -- An address or a date means nothing without the person's name.
  add constraint contact_summaries_referral_has_name
    check (
      suggested_referral_name is not null
      or (suggested_referral_email is null and suggested_referral_since is null)
    );
