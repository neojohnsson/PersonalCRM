-- 0001_google_accounts.sql
--
-- One row per user, holding the Gmail connection. The refresh token in it is a
-- long-lived key to a real mailbox, which makes this the most sensitive table
-- in the project — and the first, so it sets the pattern the rest copy.
--
-- Run in the Supabase dashboard → SQL Editor. Written as it would run against
-- a fresh database: the NOT NULLs are inline here rather than the separate
-- ALTER you ran against the live project. Same end state.
--
-- tests/rls-google-accounts.test.ts describes what this must do. `npm test`.

create table google_accounts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users(id) on delete cascade,
  email                   text not null,
  refresh_token_encrypted text not null,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- No plaintext token column. Don't add one "for debugging".
--
-- user_id is NOT NULL because every policy below compares auth.uid() to it.
-- NULL compares to neither true nor false, so a row with a null user_id would
-- be invisible to everyone including its owner, and unreachable through the
-- API — an orphan holding a live Gmail token.

alter table google_accounts enable row level security;

-- On this project the "automatic RLS" event trigger already did that. Stated
-- explicitly anyway, so the file stands on its own against a fresh database.

revoke all on public.google_accounts from anon;

-- Supabase grants new tables in `public` to both `anon` and `authenticated` by
-- default. A table holding refresh tokens should not be reachable by a
-- signed-out visitor at all, RLS or no RLS. `authenticated` keeps its grants.


-- ── YOURS TO WRITE: the policies ────────────────────────────────────────────
-- AGENTS.md: "I write these by hand — RLS policies."
--
-- Four policies — select, insert, update, delete. Each one:
--
--   * targets the role explicitly:        to authenticated
--   * compares against the caller's id:   (select auth.uid()) = user_id
--
-- Four things that catch people out:
--
--   a) Wrap it as `(select auth.uid())`, not bare `auth.uid()`. Postgres then
--      evaluates it once per query instead of once per row.
--
--   b) `to authenticated` on its own is authentication without authorisation.
--      It proves someone is signed in, not that the row is theirs. Without the
--      user_id comparison every signed-in user reads every row — the exact bug
--      the test catches.
--
--   c) UPDATE needs BOTH `using` and `with check`. `using` decides which rows
--      you may update; `with check` decides what they may become. With only
--      `using`, a user can update their own row and set user_id to someone
--      else's, handing their row away. INSERT takes `with check` only.
--
--   d) Don't use `auth.role()`. It's deprecated, and it returns
--      'authenticated' for anonymous sign-ins too.
--
-- Then: npm test. Twelve passing means user B genuinely cannot read, change or
-- delete user A's Gmail token.
