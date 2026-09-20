-- 0020_promise_touch_link.sql
--
-- Fixes a foreign key written in 0019, before it can do any harm.
--
-- promises.next_touch_id points at the touch a promise became, with the
-- composite key this codebase uses everywhere — the row AND its owner:
--
--   foreign key (next_touch_id, user_id) references next_touches (id, user_id)
--     on delete set null
--
-- "set null" on a composite key sets **every** column in it, so deleting a next
-- touch tried to null `user_id` as well. That column is `not null`, so the
-- delete failed with 23502 instead of quietly clearing the link, and a next
-- touch a promise had been accepted into could not be deleted at all.
--
-- Postgres 15 and later can name the column to null, which is what was meant.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/rls-promises.test.ts covers it: "links the next touch it became, and
-- outlives it". `npm test`.

alter table promises drop constraint promises_next_touch_id_user_id_fkey;

alter table promises add constraint promises_next_touch_id_user_id_fkey
  foreign key (next_touch_id, user_id) references next_touches (id, user_id)
  on delete set null (next_touch_id);
