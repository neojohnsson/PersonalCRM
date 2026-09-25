-- 0029_autonomous_contact_creation.sql
--
-- The Assistant may create a contact from explicit user-provided details.
-- It records the creation and can undo it only while the contact still matches
-- the creation snapshot. This is not a general delete capability.

alter table public.assistant_actions
  drop constraint assistant_actions_kind_check;

alter table public.assistant_actions
  add constraint assistant_actions_kind_check
    check (kind in ('note', 'tags', 'next_touch', 'conversation_done', 'reminders', 'contact_creation'));
