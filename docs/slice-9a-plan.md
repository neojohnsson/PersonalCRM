# Slice 9a — what the first real test found: the logic

_Draft plan, 2026-09-21. Correct it before any code gets written._

**Where this came from.** The first end-to-end test of the app by somebody who had not built
it, against the real mailbox and calendar with 25 contacts. It found four things wrong with
the *logic*, three of which are real and two of which are mine from named slices. 9a fixes
those. The interface problems it found — mobile navigation, the contact header, undo, the
thread timeline — are 9b.

Web research moves to slice 10 and release to 11. Numbered 9 rather than 8c because this is
its own body of work: the first slice written from evidence rather than from the plan.

## Part 1 — one answer to "who needs you" (P0-1)

**The bug.** `lib/relationship/list.ts`'s `matchesFilter(turn, filter)` takes only the turn.
The Contacts filters and their counts therefore know nothing about a settled conversation, a
person who is never chased, or a date already planned — all of which slice 6c invented. So
the app contradicts itself:

- Home: "7 people are waiting on a reply from you"
- Contacts: "Your turn 12"
- A contact whose own page says **Nothing owed** is still counted under *Your turn*
- A contact whose page says **Just a contact** still appears under *Going quiet*

This is mine. `docs/slice-6c-plan.md` says "the contact list's default order is unchanged: only
the words change" — I thought about its order and its words and never once about its filters.

**The fix.** `matchesFilter` takes a `Standing`, not a `Turn`. Every screen already has what
it needs to build one: `loadRelationships` returns `settledAt` and `neverChase`, and every
page loads its open next touches. The filters become:

| Chip | Who is in it |
|---|---|
| Your turn | standing is open **and** they wrote last |
| Their turn | standing is open **and** you wrote last |
| Going quiet | standing is open **and** you wrote last over two weeks ago |
| No open thread | the thread is closed, or there is no mail |
| **Nothing owed** | you settled it — *new chip* |
| **Planned** | a next touch is set for later — *new chip* |
| **Just a contact** | never chased — *new chip* |

Three new chips rather than hiding those people: "where did Linda go?" is a worse bug than
the one being fixed. The counts come from the same function, so they cannot drift again.

**Your week is allowed to differ, and has to say so.** It is capped at eight and measured from
Monday, so it is a *selection*, not a list — the report was right that this is invisible. It
gains one line: "The eight worth a message this week, from Monday." And one ordering fix: a
touch **due today** now outranks somebody who has been waiting three days, because "today"
is the more urgent word. Today's are what fell off the bottom of the eight.

## Part 2 — an auto-reply is not a person waiting (P0-2)

**The bug.** `lib/google/filter.ts` looks at the sender's address and `List-Unsubscribe`. An
out-of-office from `omsorgsnamnden@vaxjo.se` is, to the app, a real person writing to you: it
became a contact, took **Your turn · today**, and scored warmth 35 — above real people.

**Two fixes, because they cost different amounts.**

1. **Subject prefixes, which work on the data already stored.** `Autosvar`, `Automatiskt
   svar`, `Automatiskt genererat svar`, `Frånvaro`, `Ej på kontoret`, `Out of office`,
   `Automatic reply`, `Auto:`, `Autoreply`. Subject is already stored, so this fixes the 25
   contacts that exist today with no re-sync.
2. **The headers, which need a re-sync to help old mail.** `METADATA_HEADERS` gains
   `Auto-Submitted`, `Precedence`, `X-Autoreply` and `X-Autorespond`. An auto-reply is any
   message with `Auto-Submitted` other than `no`, or `Precedence` of `auto_reply`, `bulk` or
   `junk`, or either `X-Autoreply` header present.

**What an auto-reply must never do:** flip the turn, create a contact, count toward warmth, or
appear in the brief. It is still *stored* — deleting mail is not this app's habit — and marked,
so the existing "filtered out" count can say how many.

The rules are pure and get the fixture treatment the negation list got: every subject above
must be caught, and "Automatiseringsprojektet" and "Re: Autosvar hantering" — a real person
writing *about* auto-replies — must not be.

## Part 3 — waiting on somebody is not a task (P0-3)

**The bug.** The AI classifies its suggested timing as `waiting_on_them`, `reply_owed`,
`referral` and so on (slice 5a), and then `next_touches` stores only a date and a reason. The
kind is thrown away. So "Wait for Peter's response" arrives as a to-do with a **Draft reply**
button next to it, which is the app telling you to do the one thing you decided not to do.

**The fix.** Migration 0023 adds `next_touches.kind`, and `touchDate` already knows which kind
it used, so nothing new has to be guessed. A touch whose kind is a waiting one:

- says **Waiting on them · check again Fri 25 Sep**, not "get back to them"
- has no Draft reply button
- still appears in Coming up and on the contact page, because the date is the point: if
  nothing has arrived by then, *that* is when it becomes yours

Old rows have no kind, and a null kind behaves exactly as today. Nothing is re-guessed.

## Part 4 — the privacy page told the truth and then stopped (P1-11)

Mine, from 8b, three commits old. `/privacy` says of meetings: "No title, no description and
no other guests — the app never asks Google for them." The calendar page then asks for titles
and draws them. Both statements were true when written and the second one broke the first.

The page will say what the code does: **titles are read to draw the week and are never
stored.** And `docs/privacy.md` gets the same sentence, since it makes the same claim.

Two smaller ones from the same report, in the same commit, because they are the same kind of
lie: `/privacy` points end users at `docs/privacy.md` "in the repository", and Profile mentions
uploading a CV under "Files, which is coming soon" — a feature that is not in any slice.

## Done when — a test proves it, not when it renders

- [ ] One function decides "needs you", and Home, the Contacts chips, their counts, Your week
      and the Calendar Due row all use it — proven by a test that sets a contact settled and
      asserts every surface agrees
- [ ] A settled contact is counted under Nothing owed and nowhere else; never-chase under Just
      a contact; a future touch under Planned
- [ ] Every auto-reply subject in the fixture list is caught, and the two lookalikes are not
- [ ] An auto-reply does not flip the turn, does not count toward warmth, and does not make a
      contact
- [ ] A `waiting_on_them` touch offers no draft and says "Waiting on them"; a touch with no
      kind behaves exactly as it does today
- [ ] `/privacy` and `docs/privacy.md` say the same thing about titles as the code does
- [ ] With the real mailbox: the two Autosvar contacts stop being people waiting on a reply,
      and the Home and Contacts counts agree

## Not in this slice

- Everything in 9b: mobile navigation, the contact header, undo toasts, the thread timeline,
  names shown surname-first, the 404 page, sortable columns.
- Suggesting "Nothing owed" from a referral hand-off. Deferred on purpose in 6c — "wrong
  inference is what put these people in the brief" — and it comes back as a suggestion a human
  accepts, never as an automatic hide.
- The AI budget display. `spentThisMonth` sums settled costs and reserved estimates correctly;
  a draft costing fractions of a cent cannot move a figure shown to two decimals. Worth
  looking at with more precision before calling it a bug.

## Commit order

1. This plan
2. Migration 0023 (`next_touches.kind`), with its test
3. The shared standing-aware filters, chips and counts — with the cross-screen test
4. Auto-reply detection: subjects first, then the headers, with fixtures
5. Waiting-on-them touches: no draft button, different words
6. The privacy wording, in one commit with the two other dead references
7. Preview check with the real mailbox, PR
