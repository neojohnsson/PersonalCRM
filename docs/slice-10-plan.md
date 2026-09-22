# Slice 10 — the calendar can be written to

_Plan, 2026-09-22. Correct it before any code gets written._

**What this reverses.** Slice 8a shipped yesterday with "read-only, for good. No create, no
edit, no delete, no write scope requested" (`docs/slice-8-plan.md`, Part 1), and said so on
four screens. You asked for the opposite on 2026-09-22: the whole app should be able to put
things in your calendar, not only the Assistant. So this is its own slice, and it says out
loud what it is undoing rather than quietly editing yesterday's promise.

**What survives.** `plan.md` §3.4 — "Suggestion, never a silent calendar entry" — survives
whole, because the *silent* is the part that matters: nothing here creates an event without a
press.

---

## The decisions

### 1. The scope, and where events land

`calendar.events` — "view and edit events on all your calendars" — joins the existing
`calendar.events.readonly` on a re-consent. **Your choice, 2026-09-22**, asked because it
changes what you see in Google Calendar:

| | |
|---|---|
| **Chosen** | Events land on your own calendar, with everything else. |
| Not chosen | A separate "Contact Hub" calendar with `calendar.app.created`, which cannot touch anything the app did not create. |

Said plainly, because a permission you don't know you granted is the thing this project keeps
refusing to do: **the app will hold permission to change or delete any event in your
calendar.** Nothing in the code does either, and a test fails if that ever changes — the same
shape of trust as the Gmail draft scope, which also permits sending.

### 2. No guests, ever

An event with a guest list makes Google **email an invitation** to each guest. That is the app
causing mail to reach a real person, which is what "No send capability… Ever" exists to
prevent — so it is not a matter of the prompt being careful:

- the request body never carries `attendees`, and a test reads the source to prove it
- `sendUpdates=none` on every insert as well, which is belt and braces for a body that has no
  guests in it anyway
- the UI says so where you press: "No guests — add them in Google Calendar yourself."

### 3. Create only

The scope allows update and delete. The app has neither, and the guard test bans the API paths
for both, plus `quickAdd` and `import`. One writing path exists: `POST …/events`.

**So a created event has no Undo**, which is a deliberate break with Part 3 of slice 9b, where
five actions got one. Undo here would mean holding a delete path for the sake of eight seconds,
and the honest alternative is one press away: the toast links to the event in Google Calendar,
where you can change or delete it with the tool that owns it. Written down because it is a
inconsistency somebody will notice.

### 4. Nothing is created without a press

Both entry points are a small form you confirm, never a one-click "Book it":

- **`/calendar`** — a Create event button, for a day you are looking at.
- **A contact page** — "Book time with Karin", prefilled with their name.

The Assistant (slice 11) gets the same thing through its own must-ask card, which is why this
slice comes first.

### 5. Every page that promises read-only is corrected in the same slice

Not afterwards, and not "we'll get to the docs": slice 8b's lesson was a privacy page and a
piece of code that disagreed for a day.

- `app/connect/page.tsx` — the callout that says it "cannot create, change or delete anything
  in your calendar, because it never asks for the permission that would allow it"
- `app/calendar/page.tsx` — "read-only · nothing is ever created or changed", and the design's
  own note at the foot of the page
- `app/privacy/page.tsx` — what leaves the app, and what Google keeps
- `docs/privacy.md` §"The calendar, from slice 8"
- `lib/google/scopes.ts` — its own comment says "there never will be", which is now false
- `docs/plan.md` §3.4 and §8 — a line each saying what changed and when

### 6. The guard narrows, it does not disappear

`tests/calendar-scopes.test.ts` currently fails if any source file mentions **any** calendar
write scope. Rewritten, it fails unless:

- `REQUESTED_CALENDAR_SCOPES` is exactly `calendar.events`, `calendar.events.readonly`,
  `userinfo.email` — nothing else, in that order
- none of the other five write scopes appears anywhere (`calendar`, `calendar.events.owned`,
  `calendar.app.created`, `calendar.calendars`, `calendar.acls`)
- no source file mentions `attendees`, `sendUpdates=all`, `quickAdd`, `events/import`, or a
  PATCH, PUT or DELETE against an event

A guard that gets deleted the day it becomes inconvenient was never a guard.

### 7. The re-consent

Your existing calendar connection has only the read scope, and `google_calendar.scopes`
records that — so no migration. The pages read it:

- `canWriteCalendar(scopes)` is false → the Create buttons are absent, and the calendar page
  says one line: "Reconnect your calendar to create events."
- connecting again asks for all three scopes; Google's screen lets you untick, and everything
  built before this slice keeps working if you do.

---

## Done when — a test proves it, not when it renders

- [ ] `REQUESTED_CALENDAR_SCOPES` is those three, pinned exactly, and the other five write
      scopes appear nowhere
- [ ] No source file can add a guest, send an invitation, update, delete, quick-add or import
      an event — each its own case
- [ ] An event is created on the primary calendar with no `attendees` and `sendUpdates=none`,
      proved against a faked Google (the pattern of `tests/calendar-read.test.ts`)
- [ ] The Create buttons are absent until the calendar is reconnected with the write scope
- [ ] Two users: neither can create an event on the other's calendar
- [ ] Not one screen or document still says the calendar is read-only
- [ ] The new event appears on `/calendar` after the next read

## Not in this slice

- Editing or deleting an event from this app. Google Calendar owns that.
- Guests, invitations, rooms, conferencing links, recurrence.
- Writing a description or notes into an event: the app reads no descriptions
  (`docs/privacy.md`), and writing them would be a new claim to make.
- The Assistant proposing an event. That is slice 11, and it calls this slice's code.

## Commit order

1. This plan
2. The scope, the re-consent, and the narrowed guard — no UI yet
3. `createEvent`: one insert, no guests, with its tests
4. The Create form on `/calendar` and on a contact
5. Every read-only promise corrected, in one commit so the diff reads as one decision
6. Preview check, PR
