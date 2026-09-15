-- 0003_sync_page_token.sql
--
-- One page token for both kinds of sync.
--
-- 0002 named the column backfill_page_token, but the incremental sync pages
-- through Gmail's history too, and needs somewhere to remember its place.
-- One column serves both: the status says which kind of page it is.
--
-- Run in the Supabase dashboard → SQL Editor.
--
-- Policies are unaffected: they only look at user_id.

alter table gmail_sync_state
  rename column backfill_page_token to page_token;
