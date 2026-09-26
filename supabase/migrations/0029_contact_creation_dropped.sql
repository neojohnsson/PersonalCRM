-- 0029_contact_creation_dropped.sql
--
-- Puts the Assistant's log back to its five kinds (0025).
--
-- On 2026-09-25 a branch that was never merged (ui-polish) let the Assistant
-- create contacts on its own, and its own 0029 was run here by hand: it added
-- 'contact_creation' to this check. The user decided on 2026-09-26 not to keep
-- that -- the Assistant offers a new contact as a card you press, as slice 11b
-- built it -- so the check goes back to what the code can write. No row was
-- ever logged with that kind, so nothing here is refused by it.
--
-- Run in the Supabase dashboard -> SQL Editor, the whole file.

alter table public.assistant_actions
  drop constraint assistant_actions_kind_check;

alter table public.assistant_actions
  add constraint assistant_actions_kind_check
    check (kind in ('note', 'tags', 'next_touch', 'conversation_done', 'reminders'));
