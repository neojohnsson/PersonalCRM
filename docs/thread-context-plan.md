# Whole-thread context, and referrals to several people

_Plan, 2026-09-18. Found on real mail; rules agreed before any code._

Two complaints from the same conversation with Carl-Johan at Atea:

1. **A summary said "you are waiting for a reply" when he had already replied** — because
   he answered from a second address, and because Pontus, whom he copied in, is a
   different contact. Summaries and drafts read only messages **to or from that contact**,
   so the rest of the conversation is invisible.
2. **The referral said "nobody by that name"** for "Oskar or Pontus" — two people in one
   name, and a first name alone never matches, so the check never looked at the mail to
   Pontus Berglund.

**Done when** a test proves it:

- [ ] A thread with a third person in it is read whole: every message, each labelled with
      who wrote it, and mail from other threads is not mixed in
- [ ] Nothing about anyone else is stored: the labels come from the headers already
      synced, and bodies stay unstored as before
- [ ] A referral to two people becomes two people; each is checked on its own
- [ ] A first name matches when exactly one person in your mail fits, and says
      "can't tell" when several do
- [ ] The next touch keeps only the people you haven't written to; it disappears when
      you've written to all of them
- [ ] On the preview with real mail: Carl-Johan's summary sees his reply and Pontus's,
      and says Pontus has been contacted

## Part 1 — The whole thread, not just their messages

Today: `touchesByContact` keeps a message only when the contact sent it, or you sent it
to them. A message from a third person in the same thread is dropped.

Change, for **what the AI reads only**:

- Take the threads the contact appears in (as now), then read **every message in those
  threads**.
- Label each one: **from you**, **from them**, or **from Niklas Hedlund
  (niklas@…)** for anyone else, using the name already on the header.
- The most recent 20 messages across those threads, as now.

**Not changed:** whose turn, warmth, the contact list, Seen once. Those stay on the
touch rules — a third person's message isn't a touch between you and this contact
(`lib/relationship/touches.ts`), and changing that would change every score in the app.

**Privacy:** the same as today — bodies are read for that one request and never stored,
and only threads this contact is part of.

## Part 2 — Referrals to more than one person

- The model returns a **list** of referred people (name, and address when the emails give
  one), instead of one name. Migration `0015` keeps them as a small JSON list.
- Matching gains one rule: **a first name matches when exactly one person in your
  contacts and mail fits it.** Two Oskars → "can't tell", never a guess. Full names and
  addresses work as before.
- The card shows each person on their own line: "✓ You wrote to Pontus Berglund on 12
  Sep", "Oskar: two people in your mail have that name".
- The suggested next touch names only the people still outstanding, and disappears when
  none are.

## Not in this

The same person on two addresses is still two contacts. **Duplicate detection and merge
is slice 6** (`plan.md` §3.7): suggest, never merge on its own. A reply from a new
address inside your own thread is a strong signal to feed it there.

## Commit order

1. This plan
2. Whole-thread reading, with the labels — tests
3. Summaries and drafts use it
4. Migration `0015`: a list of referred people, with tests
5. The list, first-name matching, and the card
6. Preview check, PR
