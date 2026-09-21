-- 0023_touch_kind.sql
--
-- Slice 9a: waiting on somebody is not a task (docs/slice-9a-plan.md, Part 3).
--
--   next_touches.kind                 what sort of next touch this is
--   contact_summaries.suggested_touch_kind  the same, for a suggestion not yet
--                                     accepted
--
-- The AI has classified its suggested timing since slice 5a — reply_owed,
-- referral, waiting_on_them, they_will_get_back, later_event, stated_date — and
-- lib/relationship/touch-date.ts turns that kind into a day. Then the kind was
-- thrown away and only the day was stored.
--
-- So "Wait for Peter's response" arrived on the brief as a to-do with a **Draft
-- reply** button beside it: the app telling you to do the one thing you had
-- decided not to do. Found by the first outside test of the app, 2026-09-21.
--
-- Null means no kind was recorded — every touch that exists today, and every
-- one a person types in by hand. A null kind behaves exactly as it does now, so
-- nothing is re-guessed for old rows.
--
-- Run in the Supabase dashboard → SQL Editor, the whole file.
--
-- tests/next-touches.test.ts and tests/ai-summaries.test.ts cover it. `npm test`.


-- ── next_touches.kind ───────────────────────────────────────────────────────
--
-- The same six the AI may answer with (lib/relationship/touch-date.ts's
-- TIMINGS, less "nothing_open", which never becomes a touch). Checked here as
-- well as in code: a kind the app does not understand would be shown to you as
-- if it did.

alter table next_touches
  add column kind text
    check (kind in (
      'stated_date',
      'reply_owed',
      'referral',
      'waiting_on_them',
      'they_will_get_back',
      'later_event'
    ));

comment on column next_touches.kind is
  'What sort of touch this is. waiting_on_them and they_will_get_back mean the next move is theirs, so the app must not offer to draft anything. Null: not recorded, and treated as yours to act on.';


-- ── contact_summaries.suggested_touch_kind ──────────────────────────────────
--
-- A suggestion carries its kind too, so accepting one keeps it. Without this
-- the kind would be lost in the gap between the AI answering and a human
-- pressing the button, which is the gap it is needed across.

alter table contact_summaries
  add column suggested_touch_kind text
    check (suggested_touch_kind in (
      'stated_date',
      'reply_owed',
      'referral',
      'waiting_on_them',
      'they_will_get_back',
      'later_event'
    ));
