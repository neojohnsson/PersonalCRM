# Slice 9b — what the first real test found: the interface

_Draft plan, 2026-09-22. Correct it before any code gets written._

**Where this came from.** The same outside test of the app that produced 9a. 9a fixed the
logic; this fixes what you can see. Its own summary of the worst of it:

> "There is no navigation on mobile. The contact page also scrolls sideways at 390px, and the
> row actions only show on hover, so touch users can't reach them."
> "The contact page header has 7 unclear buttons. 'Dismiss' actually deletes the contact, and
> the top 'Draft reply' doesn't draft anything."

## Part 1 — mobile is unusable (P0-4)

At 390px the sidebar is hidden and **nothing replaces it**. No hamburger, no bottom bar: zero
navigation. That is my own comment in `app-shell.tsx`, written approvingly —

> "Below the sm breakpoint the sidebar is hidden and the app name shows in the header
> instead, so lists keep the width on a phone."

— which is true about the lists and says nothing about how you would reach another page.

- **A bottom bar below `sm`**, with the same entries as the rail and their labels: Home,
  Assistant (Your week until then), Calendar, Contacts, Seen once. Labels, because the report
  could not tell the icons apart even on desktop, where they at least have tooltips.
- **Labels and tooltips on the rail too.** Every `NavItem` already has an `sr-only` label and
  a `title`; the report says the `title` was not enough. The rail widens on hover to show the
  words, which the design's 56px rail does not do — and a nav nobody can read is worse than a
  nav that changes width.
- **The contact page stops scrolling sideways.** `scrollWidth 869` against `clientWidth 380`
  is the seven-button header; Part 2 removes the cause rather than adding an overflow rule.
- **Row actions on touch.** Draft reply and Not needed appear on hover, which does not exist
  on a phone. They become always visible under `hover: none` — Tailwind's `hover-none:` — and
  stay hover-revealed on a pointer, where nine black pills in a column would be noise.
- **Disconnect Gmail leaves the mobile header.** A rare, destructive action does not belong
  where it is the first thing a thumb reaches. It moves to Profile, next to the calendar's
  disconnect, which is where somebody looking for it would go.

## Part 2 — the contact page header (P1-1, P1-2)

Seven controls in a row: the status pill, Edit, Draft reply, Nothing owed here, Just a
contact, Export, Dismiss. Each one arrived in a different slice, each defensible on its own,
and together they are a wall.

**What stays visible:** the status pill, **Draft reply**, **Edit**.

**What moves into a "⋯" menu**, with words instead of jargon:

| Now | In the menu |
|---|---|
| Nothing owed here | Mark this conversation done |
| Just a contact | Stop reminding me about this person · *Reminders off · turn back on* |
| Export | Download everything about them |
| Dismiss | **Delete contact and their mail…** (in red) |

Three things the report was right about and I had defended without noticing:

1. **"Dismiss" does not say that it deletes.** The confirm panel does — "Dismiss and delete" —
   but by then you have already decided. The menu item says it, and the confirm button turns
   red instead of the same black as every other primary action.
2. **"Nothing owed here", "Not needed" and "Nothing more is owed in this conversation" are
   three names for one action.** One name everywhere: **Mark conversation done**.
3. **"Just a contact" looks like Draft reply when it is on**, because "on" is a filled black
   pill and so is the primary button. In a menu it is a line of text with its state in words.

**The header's Draft reply will draft.** It is `href="#draft"` today: on a page where the
draft card is already visible, pressing it does nothing at all. It becomes a button that
starts generating and scrolls to the card, and it is hidden when no draft is possible instead
of sitting there black and dead next to a disabled one.

## Part 3 — undo, and no silent destruction (P1-3)

Five actions destroy or change something with one click and no way back: **Not needed**,
**Skip**, **Snooze**, **Discard** a paid draft, and **Just a contact**.

- A **toast with Undo**, about eight seconds, after each one. Undo is not a new mechanism:
  everything here is one row written or one column changed, and 6c built every one of them to
  be reversible already. The toast just surfaces what was always possible.
- **Not needed** also has to stop dismissing two people by accident: the row vanishes and the
  next one slides under the cursor. The row stays in place, greyed, until the toast expires.
- **Snooze** asks how long: Tomorrow · Next week · Next month · Pick a date. It silently
  added seven days, which on a touch 133 days away means nothing.
- **Skip and Mark done** are never explained. The menu says which is which: "Mark done — it
  happened" and "Skip — it didn't, and I'm not rescheduling".

## Part 4 — read the conversation without leaving (P1-4)

The contact page shows stats, an AI summary, and a link to Gmail — and **not one email**. No
sender, no date, no subject, no first line. The one screen about a person does not show the
thing the person said.

- A **thread timeline**: who, when, the subject and the first line, newest first, read from
  Gmail when the page opens and never stored — the same rule as the promise queue and the
  calendar's titles.
- **Source numbering becomes per-contact.** "email 1" under *Who they are* and "email 1" under
  *How you know them* are currently two different messages. One numbering for the whole page.

## Part 5 — names that look like a mail log (P1-5)

Eleven of 25 contacts show as a bare address, and several as "Jönsson Linda" — the Outlook and
municipality style, surname first. The AI already writes "Follow up with **Björn**" in the
same summary whose contact is called `bjorn.andersson@nordlo.com`.

- **Suggest a swap** when a display name looks like "Lastname Firstname": two words, and the
  second is a common given name or matches the address's local part.
- **Guess a name from `first.last@`**, marked as a guess, as one of the existing
  "Suggested for the contact" rows with a one-click Accept. Nothing is renamed without a
  press: a guessed name written silently into a record is exactly what §5.2 warns about.

## Part 6 — the small lies (P1-6, P1-9, P1-12, P2)

- **Controls that are not controls.** "Sorted by Whose turn" is a static span that looks like
  a dropdown; the column headers are not sortable; "and 6 more later" is not a link; tags on
  the contact page are not clickable while tag chips exist on the list. Each one either works
  or stops looking interactive. Sorting by column is worth having; the rest become plain text.
- **"Edited 17 September" above "No notes yet."** The timestamp is the contact's `updated_at`,
  not the note's. It says "Cleared 17 Sep" when the note is empty, or nothing at all.
- **A real 404.** `/contacts/not-a-uuid` is Next.js's default black page with no way back. A
  `not-found.tsx` that keeps the app shell and says "This contact doesn't exist or was
  deleted", with a link to Contacts.
- **Editing loses work.** Clearing a name and pressing the back link discards everything with
  no warning. A guard before leaving with unsaved changes, the first field focused, and a
  failed submit scrolls to the error instead of putting it at the top of a page you are at the
  bottom of.
- **Dates for humans.** The date input shows `mm/dd/yyyy` to somebody in Växjö, and AI text
  leaks ISO dates ("on 2026-09-21"). `lang="sv"` on the inputs, and the AI told to write dates
  the way people say them.

## Part 7 — Your week and Promises leave the sidebar

You have said twice that you want both gone, and the Assistant (`docs/assistant-plan.md`)
replaces what they do with cards. But its cards do not exist yet, and deleting the pages now
would take those signals away in the meantime.

So in 9b they **leave the sidebar** and keep working at their addresses. The pages, and the
Monday line on Home that points at the brief, are deleted in the Assistant slice, when their
replacement is on screen. `lib/relationship/brief.ts` and `lib/ai/promise*.ts` are not touched
at all: the Assistant's cards are built on them, and the promise scan is one of the things you
asked the Assistant to be able to run.

## Done when — a test proves it, not when it renders

- [x] Every page is reachable at 390px, and the contact page does not scroll sideways
      — measured: 378px wide in a 378px viewport, down from 872
- [x] Row actions are reachable without a pointer
- [x] The contact header has three controls and a menu, and the menu's delete says delete
- [x] The header's Draft reply generates a draft, and is absent when no draft is possible
- [x] Conversation done, Skip, Snooze, Discard and the reminders switch can each be
      undone from a toast (migration 0024 for Discard)
- [x] Snooze asks how long
- [x] The contact page lists the conversation, read live and never stored
- [x] Source numbers are unique per contact
- [x] A surname-first name and a `first.last@` address each produce a *suggestion*, and nothing
      is renamed without a press
- [x] `/contacts/not-a-uuid` shows the app's own 404 with a way out
- [x] Leaving an edited form warns; a failed submit focuses the first error
- [x] Your week and Promises are not in the sidebar, and both still work at their addresses

### The sweep at the end

Eleven pages at 390px and eight at 1280px, in a real browser (2026-09-22):
no page scrolls sideways at either width, the bottom bar is on every page on
a phone, and on desktop the header's switcher is there with the right entry
marked and the bottom bar hidden. 774 tests pass.

## Not in this slice

- Deleting the two pages. That happens in the Assistant slice, with their replacement.
- The AI output quality notes (P2-5): circular next steps, summaries that say nothing, a draft
  that ignores being 11 days late. Prompt work, and it belongs with the Assistant, which
  rewrites how the AI is asked for things.
- Streaming the draft (P2-10) — it needs the Assistant's streaming anyway.
- Sortable columns beyond one click per header; no multi-sort.

## Commit order

1. This plan
2. Mobile: the bottom bar, the labelled rail, touch-visible row actions, Disconnect moved
3. The contact header: three controls and a menu, and Draft reply that drafts
4. Undo toasts, and Snooze with a duration
5. The thread timeline and per-contact source numbers
6. Name suggestions
7. The small lies: fake controls, the notes timestamp, the 404, the form guard, dates
8. Your week and Promises out of the sidebar
9. Preview check at 390px and on desktop, PR

### What actually happened, and why it differs

- **Part 7 came first.** The bottom bar and the header switcher both have to
  list the same pages, and building them with seven entries only to delete two
  is wasted work. So the rail dropped to four entries plus Profile before
  anything else was built.
- **The header's centred page switcher was added** (not in this plan). Asked
  for on 2026-09-22; it is in five of the designs and had been left out of all
  of them. The word variant, because the icons could not be read.
- **Part 3 became two commits.** Discard needs migration 0024, and a commit
  that leaves the suite red until somebody runs SQL should say so on its own.
- **Skip and Mark done keep their pills** rather than moving into a menu as
  this plan said: three pills is the design's own row, and a menu to explain
  two buttons is a menu too many. They say which is which in a title and in
  what the toast says afterwards.
- **The rail's labels float beside the icons** rather than widening the rail,
  which would shove every list sideways as the pointer crossed it.
