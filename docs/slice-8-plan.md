# Slice 8 — the calendar signal, and the calendar page

_Draft plan, 2026-09-20. Correct it before any code gets written._

**Why now.** `plan.md` §6.4: "A meeting in the calendar is the strongest warmth signal that
exists — far stronger than email. One extra scope, big accuracy win. Also lets suggested
next-touch dates avoid full days and notice a meeting already booked with the person." It was
idea 4 of 12 under *later*, with a design and a written page spec
(`docs/calendar-and-profile.md`, `design/Calendar.dc.html`) but no slice. Scheduled as slice 8
on 2026-09-20 at the user's request; web research moves to 9 and release to 10.

**Why ahead of web research.** It improves what the app already does — whose turn it is, how
warm a relationship is, when to get back to someone — rather than adding another screen. The
next-touch date rules have been able to avoid a busy day since slice 5a; they have simply
never had a calendar to look at.

**Split in two, each ending with something that works:**

- **8a — the signal.** The connection, the meetings, warmth counting them, dates avoiding
  them. No new screen; the whole app gets better quietly.
- **8b — the page.** `/calendar` from the design.

## Part 1 — the connection (8a)

- **A separate connection with its own consent screen**, asked for only when wanted. The app
  must work fully without it — that is the rule `docs/calendar-and-profile.md` sets, and it is
  also what keeps Gmail working if calendar consent is refused.
- **The smallest scope that does the job**: `https://www.googleapis.com/auth/calendar.events.readonly`
  — "View events on all your calendars". Checked against Google's scope list on 2026-09-21,
  as the spec asked: it exists, and it is narrower than `calendar.readonly`, which also grants
  calendar properties and structure this app has no use for. `calendar.events.freebusy` would
  cover "is that day full" on its own, but not the guest addresses needed to match a meeting to
  a contact, so `events.readonly` is the one and it subsumes the other. Its verification tier
  is shown in the Google Cloud console when the scope is added to the consent screen; whatever
  it says, it is one more scope to declare when slice 10 comes.
- **Read-only, for good.** No create, no edit, no delete, no write scope requested. `plan.md`
  §3.4 already settled this: a follow-up date is "a suggestion, never a silent calendar
  entry". A next touch stays a date inside the app.

## Part 2 — what is read, and what is kept (8a)

Read: **start, end, title, guest addresses, and whether you accepted**. Never the description
or attachments — people paste private things into them, and the design's own footnote says so.

Kept: **only meetings with a contact**, and only what warmth needs — the contact, the event
id, and the start and end. **No titles are stored**, because nothing that is computed needs
one; the page fetches titles live when it draws the week, the same way message bodies are
read and thrown away.

`/privacy` gains a line for the new table, in the same plain words as the rest.

## Part 3 — warmth counts meetings (8a)

This is the accuracy win, and it touches `lib/relationship/warmth.ts` — the one piece of core
logic nothing has changed since slice 3. The four weights stay as they are; a meeting becomes
a **touch**, so:

- **Last contact** counts a meeting like a message. Met on Tuesday, and last contact is
  Tuesday, whatever the mail says.
- **Exchanges** count a meeting as two, because a meeting is both people turning up. This is
  the "far stronger than email" part, and it is one number to argue about rather than a fifth
  weight that would force all four to be rebalanced.
- **Reply rate and reply speed** ignore meetings entirely. They are about mail, and a meeting
  has no reply time.

The contact page says "met 2 days ago" next to the score, because the rule since slice 3 is
that the number is never shown without the signals behind it.

**Whose turn it is does not change.** It reads message headers and is the one thing in the app
that cannot be wrong; a meeting has no direction, and guessing one after a meeting would break
exactly the property that makes it trustworthy. What a meeting *can* say is "you met and
nothing has gone back since" — that is the design's **Met, no follow-up** card, and it belongs
to the page in 8b.

## Part 4 — dates that know your calendar (8a)

`lib/relationship/touch-date.ts` already moves a suggested date off a weekend. It learns one
more rule:

- **Don't suggest contacting someone you are about to meet.** A meeting already booked with
  them is the follow-up; the AI suggesting "get back to Karin on Tuesday" when you are seeing
  her on Monday is the kind of wrong that makes people stop trusting a tool.

**"Don't suggest a day you are already full" is dropped** (2026-09-21, while building). Two
reasons, and the second is the real one:

1. It needs every event in the day, and this slice deliberately stores only meetings with
   contacts. Making it work would mean a new table of busy minutes per day — more storage,
   for a rule nothing else needs.
2. A next touch means *write an email*, which takes ten minutes. "Your Tuesday is full of
   meetings" is a poor reason not to write one. The rule sounded useful in a plan and does
   not survive being asked what it is for.

If a version of it ever earns its place, it belongs where the data already is: 8b's page
reads the whole week live from Google to draw the grid.

## Part 5 — the page (8b)

`/calendar`, from `design/Calendar.dc.html`, exactly as `docs/calendar-and-profile.md`
describes it: the week grid with contacts' meetings coloured, the **Due** row of next touches,
**Before your 15:30**, and **Met, no follow-up**. No AI anywhere on it — plain computation,
like whose turn it is.

## The three questions the spec left open

`docs/calendar-and-profile.md` ends with three. Answered here:

1. **Does a meeting count the same as an email, or more?** More — two exchanges, and it sets
   last contact. See Part 3.
2. **A meeting with five guests where only one is a contact?** It counts, for that one
   contact. Two contacts in the room means it counts for both. But an event with **more than
   eight guests is ignored**: that is a lecture, a standup or a webinar, not a meeting with
   someone, and counting it would make warmth lie.
3. **An "Add to Google Calendar" button on a next touch?** No. It needs a write scope, and the
   answer to "should the app write to your calendar" has been no since §3.4.

## Migration

`0022_calendar.sql`:

- `google_calendar` — the separate connection: its own refresh token, encrypted, and the
  scopes granted. Kept apart from `google_accounts` so revoking one never touches the other.
- `calendar_meetings` — `user_id`, `contact_id`, `event_id`, `started_at`, `ended_at`, and
  `accepted`. Unique on `(user_id, contact_id, event_id)`. No title. Four RLS policies and the
  composite foreign key to `contacts (id, user_id)`.
- Both included in `delete_account`'s cascade by hanging off `auth.users`, and in
  `delete_all_contacts` — which the slice 7 test will prove without being edited, because it
  checks the privacy page's own table list.

## Done when — a test proves it, not when it renders

**8a**

- [x] A meeting with a contact sets their last contact date, and counts as two exchanges
- [x] Reply rate and reply speed are unchanged by meetings
- [x] An event with more than eight guests is ignored
- [x] An event with two contacts on it counts for both
- [x] Whose turn it is is byte-for-byte unchanged by any meeting
- [x] A suggested next-touch date is not offered at all when a meeting with that person is
      already booked, and is unchanged when the calendar is not connected. ("Skips a day
      already full" was dropped — see Part 4.)
- [x] `calendar_meetings` and `google_calendar` pass the two-user RLS test
- [x] No event description or attachment is ever read — asserted at the wire: a test reads
      the URL the app sends and fails if `description`, `summary`, `location`, `attachments`
      or `conference` appears in the `fields` parameter. Google cannot send back what it was
      never asked for
- [x] Deleting the account removes both new tables (slice 7's test, unedited)

**8b**

- [ ] The week grid shows meetings with contacts in their colour, and everything else grey
- [ ] "Met, no follow-up" lists a contact whose meeting has ended and who has had nothing from
      you since — and stops listing them the moment you write
- [ ] On the preview, with the real calendar

## Not in this slice

- Writing anything to Google Calendar, ever.
- Meeting notes (`plan.md` §6.5) — needs a notes source to exist first.
- Other calendar providers.

## Commit order

**8a**

1. This plan
2. Migration 0022, with its RLS test
3. The connection: consent, callback, token storage, disconnect
4. Reading meetings and storing the ones with contacts
5. Warmth and the date rules counting them, with tests
6. Preview check, PR

**8b**

7. `/calendar` from the design, the sidebar entry
8. Preview check, PR
