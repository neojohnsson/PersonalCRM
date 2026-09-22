-- 0024_discarded_drafts.sql
--
-- Slice 9b, Part 3: Discard can be undone (docs/slice-9b-plan.md).
--
-- Discard deleted the row. A draft costs real money and a minute of waiting,
-- and the button sat next to "Save to Gmail drafts" with nothing in between --
-- the first outside test of the app called it the most expensive misclick in
-- here. Now the row stays, as a third status, and Undo puts it back.
--
--   pending    in the app: subject and body, editable. Nothing is in Gmail.
--   saved      you pressed Save. Gmail holds the text; the body is cleared here.
--   discarded  you pressed Discard. The body is cleared here too, and the
--              text you were looking at goes back with the Undo press.
--
-- **The body is still cleared.** The text is not kept on the chance you change
-- your mind: the browser you pressed it in holds the draft it was showing, and
-- Undo sends that text back. So a discarded row is metadata -- when it was
-- written, which model, what it cost -- and no message text at all, which is
-- the same promise the rest of the app makes (AGENTS.md: "Message bodies are
-- not stored by default").
--
-- There is still no 'sent' status, because the app never sends.
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.
--
-- tests/draft-save.test.ts covers it with two users. `npm test`.


-- ── status: a third one ─────────────────────────────────────────────────────

alter table contact_drafts drop constraint contact_drafts_status_check;

alter table contact_drafts
  add constraint contact_drafts_status_check
    check (status in ('pending', 'saved', 'discarded'));


-- ── which columns each status may hold ──────────────────────────────────────
--
-- As before for pending and saved. A discarded draft holds no body and no
-- Gmail id: it was never in Gmail, and the text is gone.

alter table contact_drafts drop constraint contact_drafts_state;

alter table contact_drafts
  add constraint contact_drafts_state check (
    (status = 'pending' and body is not null and gmail_draft_id is null and saved_at is null)
    or
    (status = 'saved' and body is null and gmail_draft_id is not null and saved_at is not null)
    or
    (status = 'discarded' and body is null and gmail_draft_id is null and saved_at is null)
  );


-- ── discarded_at ────────────────────────────────────────────────────────────
--
-- When you pressed Discard. Nothing enforces a window on the undo -- the
-- offer lives in the toast, which is gone in eight seconds -- but a row that
-- says when it was discarded is the difference between "this was thrown away"
-- and "this was never finished".

alter table contact_drafts
  add column discarded_at timestamptz;

comment on column contact_drafts.discarded_at is
  'When Discard was pressed. The body was cleared at the same moment; Undo puts back the text the browser still had.';


-- The one-pending-per-contact index (migration 0014) needs no change: it only
-- counts rows where status = 'pending', so a discarded draft never blocks a
-- new one -- and Undo of a discard fails against that index if a new draft has
-- been written since, which is exactly right. lib/ai/draft-save.ts turns that
-- into a sentence instead of an error.
