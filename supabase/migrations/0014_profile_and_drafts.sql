-- 0014_profile_and_drafts.sql
--
-- Slice 5a, step 2: what drafting needs (docs/slice-5a-plan.md, Part 5).
--
--   profiles          what the drafting AI may know about you — and nothing else
--   contact_drafts    a reply the AI wrote: pending in the app until you save it
--                     to Gmail drafts
--   google_accounts   + scopes: which Gmail permissions were granted
--   ai_usage          + purpose 'draft'
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/profile-drafts.test.ts describes what this must do. `npm test`.


-- ── profiles ────────────────────────────────────────────────────────────────
--
-- One row per user, from design/Profile.dc.html (without Files, slice 5b).
-- The row is keyed by user_id itself, so there can't be two.

create table profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,

  -- About you
  display_name text check (char_length(display_name) <= 100),
  based_in     text check (char_length(based_in) <= 100),
  what_you_do  text check (char_length(what_you_do) <= 500),
  looking_for  text check (char_length(looking_for) <= 500),
  signature    text check (char_length(signature) <= 500),
  languages    text[] not null default '{}' check (cardinality(languages) <= 10),

  -- How drafts sound
  tone         text not null default 'friendly'
                 check (tone in ('professional', 'friendly', 'casual', 'brief')),
  length       text not null default 'medium'
                 check (length in ('short', 'medium', 'long')),
  address_by   text not null default 'first_name'
                 check (address_by in ('first_name', 'full_name')),
  sign_off     text check (char_length(sign_off) <= 100),
  never_write  text[] not null default '{}' check (cardinality(never_write) <= 20),

  -- Links: [{ "label": "GitHub", "url": "github.com/…", "in_signature": true }].
  -- Text the AI sees. The app never opens them.
  links        jsonb not null default '[]'
                 check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Each item's own length (a language, a never-write phrase, a link's fields)
-- is checked by the app's form (lib/profile/profile-form.ts), which is the only
-- writer; the checks above keep a runaway list out of the table regardless.

alter table profiles enable row level security;
revoke all on public.profiles from anon;

create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own profile"
on public.profiles for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── contact_drafts ──────────────────────────────────────────────────────────
--
-- A reply the AI wrote to a contact's latest thread.
--
--   pending  in the app: subject and body, editable. Nothing is in Gmail.
--   saved    you pressed "Save to Gmail drafts". Gmail holds the text now, so the
--            body is cleared here; only the Gmail draft id and the time remain.
--
-- There is no 'sent' status, because the app never sends (AGENTS.md).

create table contact_drafts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  contact_id     uuid not null,
  thread_id      text not null check (char_length(thread_id) <= 100),
  status         text not null default 'pending'
                   check (status in ('pending', 'saved')),
  subject        text check (char_length(subject) <= 500),
  body           text check (char_length(body) <= 20000),
  language       text check (char_length(language) <= 40),
  tone           text not null
                   check (tone in ('professional', 'friendly', 'casual', 'brief')),
  gmail_draft_id text check (char_length(gmail_draft_id) <= 100),
  model          text not null check (char_length(model) <= 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  saved_at       timestamptz,

  -- Pending holds the text and isn't in Gmail; saved is in Gmail and holds no text.
  constraint contact_drafts_state check (
    (status = 'pending' and body is not null and gmail_draft_id is null and saved_at is null)
    or
    (status = 'saved' and body is null and gmail_draft_id is not null and saved_at is not null)
  ),

  -- The contact AND its owner, checked together, as in 0004, 0009 and 0010.
  foreign key (contact_id, user_id)
    references contacts (id, user_id) on delete cascade
);

-- One pending draft per contact.
create unique index contact_drafts_one_pending
  on contact_drafts (contact_id) where status = 'pending';

alter table contact_drafts enable row level security;
revoke all on public.contact_drafts from anon;

-- As for summaries: a draft can only be CREATED as pending — AI output lands
-- where a person reviews it first (AGENTS.md). Saving to Gmail is an update,
-- made when a person presses the button.

create policy "Users can view their own drafts"
on public.contact_drafts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own drafts, as pending"
on public.contact_drafts for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending');

create policy "Users can update their own drafts"
on public.contact_drafts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own drafts"
on public.contact_drafts for delete to authenticated
using ((select auth.uid()) = user_id);


-- ── google_accounts: which permissions were granted ─────────────────────────
--
-- Google returns the granted scopes with the tokens. Stored so the app knows
-- whether it may create drafts (gmail.compose) without asking Google first.
-- Connections made before this migration have none recorded: they count as
-- read-only until the user reconnects.

alter table google_accounts
  add column scopes text[] not null default '{}';


-- ── ai_usage: drafts count against the same monthly cap ─────────────────────

alter table ai_usage drop constraint ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check check (purpose in ('summary', 'draft'));
