# Slice 3 — it's useful

_Draft plan, 2026-09-16. Correct it before any code gets written._

**Goal** (from `plan.md` §7): whose turn it is, a next-touch date, and a warmth score
with its signals shown. **Still no AI.** This is the demo checkpoint: "if it's useful to
you at slice 3, the project is a success and everything after is upside."

**Done when** a test proves it — not when it renders:

- [x] Whose-turn tests pass: from fake message histories — they wrote last, you wrote
      last, a stale thread, a person with several addresses, mail you only Cc'd them on
- [x] Warmth tests pass: each of the four signals on its own, the score from them, and
      the same history always giving the same score
- [x] Next-touch tests pass: two-user RLS, and snooze / skip / mark done
- [x] On the Vercel preview with a real mailbox: `/` shows who is waiting on you today,
      and a contact's warmth shows the numbers it came from

**Who writes what** (`AGENTS.md`): Claude writes the code, explained before and walked
through after. The **warmth calculation** gets the most explanation — `AGENTS.md` names
it as core logic the user must be able to explain.

---

## Part 1 — Whose turn (`plan.md` §3.3)

Per contact, from the messages already stored:

1. Take every message **with** them — from any of their addresses, or to or Cc any of them.
2. Find the most recent one.
3. **Your turn** if they sent it. **Their turn** if you did.
4. **No open thread** if that message is older than the cut-off (decision A).
5. **Waiting** = days since that message.

**Going quiet** (the design's second list on `Main`) = their turn for more than 14 days:
"you spoke last and nothing came back".

Plain computation, no database changes: a pure function over a contact's messages,
tested on its own. `plan.md` §3.3: "costs nothing, uses no AI, is never wrong".

## Part 2 — Warmth (`plan.md` §3.5)

A 0–100 score from **four signals, always shown next to it** — the four in
`ContactDetail.dc.html`, whose annotation says "the 78 is these four numbers and nothing
else":

| Signal | What it is | Shown as |
|---|---|---|
| **Reply rate** | Of your last (up to) 10 messages to them, how many got a message back from them later in the same thread | "3 of 4 — they answered 3 of your last 4" |
| **Usually replies** | The median time between your message and their reply in the same thread | "within a day — median across 6 replies" |
| **Last contact** | Days since the most recent message either way | "6 days ago — they wrote, you didn't" |
| **Exchanges** | How many times the conversation changed direction (you → them or them → you) | "14 — since 4 March 2026" |

The score (decision B) is a weighted sum; every weight is a named constant in one file,
so the number can always be explained from the four signals.

**Bands**, coloured as in the designs: **warm** (green), **cooling** (amber), **cold**
(grey). With no mail at all (a contact added by hand), there is no score — "no mail
yet" — rather than a made-up zero.

What warmth never does (`plan.md` §4.3, §5.3): tell you someone "seems uninterested", or
nag. It summarises countable facts; the facts sit next to it so a human can overrule it.

## Part 3 — Next touch (`plan.md` §3.4)

A date and a reason, per contact, set by hand:

- **Snooze** moves the date a week later.
- **Skip** drops this touch without doing it.
- **Mark done** records that it happened.

Migration `0009`: a `next_touches` table — contact, date, reason, status (`open`,
`done`, `skipped`) — at most one open touch per contact, the same composite foreign key
as `contact_emails` so a touch can only hang off your own contact, RLS, two-user tests.

Not in slice 3: **promise detection** ("follow up after September 20" read from a thread)
— that's AI, and waits for slice 6.

## Part 4 — Screens

| Route | Design | What's in it |
|---|---|---|
| `/` | `Main.dc.html` | **Who needs you today** (decision C): the status line and date; **Your turn** — people waiting on you, longest wait first; **Going quiet**; **Coming up** — next touches due soon or overdue; the **Seen once** card |
| `/contacts` | `ContactList.dc.html` | The contact list moves here, with real **Whose turn** and **Warmth** columns, the filter chips (All · Your turn · Their turn · No open thread · Going quiet · tags), and whose turn as the default sort |
| `/contacts/[id]` | `ContactDetail.dc.html` | The **Your turn · 6 days** pill, the warmth **stat strip** with its explanation line, and the **Next touch** card |

The sidebar gains **Home**, as in the designs.

**Left out, and why:**

- The one-line "what's waiting" under each person on `Main` ("Asked about your thesis
  timeline") reads a message body — AI, slice 4. Slice 3 shows the thread's subject.
- **Draft reply**: slice 5.
- The contact page's **Every touch** timeline (decision D).

---

## Commit order

1. Whose turn: pure function + tests
2. Warmth: pure function + tests
3. Loading a user's messages grouped by contact, once per page
4. Migration `0009` next touches + RLS tests; snooze / skip / done actions + tests
5. Contact list at `/contacts`: whose turn and warmth columns, chips, sort
6. Contact page: turn pill, stat strip, next touch card
7. `/` Who needs you today
8. Preview check with a real mailbox, PR

## Decisions (agreed 2026-09-16)

- **A. No open thread after 30 days.** A latest message more than 30 whole days old is
  no longer "your turn" or "their turn". (The design's 31-day "their turn" example
  becomes "no open thread" under this rule — a one-day edge in mock data.)
- **B. Balanced warmth.**

  | Signal | Points |
  |---|---|
  | Last contact | 35 × (1 − days ÷ 90), never below 0 |
  | Reply rate | 30 × answered ÷ sent, over your last 10 messages; 0 if you never wrote |
  | Reply speed | 20 if they usually reply within a day · 12 within 3 days · 6 within a week · 0 slower or never |
  | Exchanges | 15 × changes of direction ÷ 10, at most 15 |

  Rounded to a whole number. **Warm** ≥ 60 · **Cooling** 35–59 · **Cold** < 35. No mail
  at all → no score.
- **C. `/` is Who needs you today**; the contact list moves to `/contacts`.
- **D. The Every touch timeline waits** (`plan.md` §6.8).
