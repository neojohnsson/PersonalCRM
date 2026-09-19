# Slice 6b — the weekly brief, and conversations going stale

_Draft plan, 2026-09-18. Correct it before any code gets written._

**Goal** (`plan.md` §3.9): "Monday morning: 5–8 people worth reconnecting with, each with
one line of why, and a one-click 'draft something'. This is the retention feature. A
personal CRM that you have to remember to open is a personal CRM you stop opening."

**What already exists**, from §3.8: "they asked you a question and you haven't answered"
is **Your turn** on `/`, and "you replied and they went quiet" is **Going quiet**. 6b
doesn't rebuild those. It adds the one thing missing — a short weekly list that mixes
every signal — plus the warning §6.11 asks for: **before** a relationship dies, not after.

**Still no AI.** Every line is computed from what's already stored, so the brief costs
nothing and can't be wrong about what someone said.

**Done when** a test proves it — not when it renders:

- [x] Picking tests pass: the mix and the order, one person per reason, never more than
      8, never someone you have already planned a next touch with this week
- [x] Each line says why in words that come from the data ("you replied 24 days ago and
      nothing came back"), and the same person is never listed twice
- [x] "About to go cold" catches a warm relationship before it crosses into cold, and
      not after
- [x] The week is Monday to Sunday in Swedish time, and "this week's brief" is the same
      list all week
- [x] On the preview with a real mailbox: a brief with real people and real reasons

## Part 1 — Who is in the brief

At most **8**, at least what there is, in this order — each person appears once, under
their strongest reason:

| Reason | Who it picks | The line |
|---|---|---|
| **Waiting on you longest** | Your turn, oldest first (max 3) | "They wrote 11 days ago and you haven't answered." |
| **Due this week** | An open next touch due Monday–Sunday | "You planned to get back to them on Thursday." |
| **Overdue** | An open next touch in the past | "You planned this for 4 days ago." |
| **Going quiet** | Their turn, 14+ days (max 2) | "You wrote 24 days ago and nothing came back." |
| **About to go cold** | Warmth still warm or cooling, but the last contact is 60–80 days old (`plan.md` §6.11) | "You've talked for months; it's been 68 days." |

Never included: contacts with no mail, anyone whose next touch is already set for later
than this week (you've decided), and anyone you wrote to in the last 3 days.

## Part 2 — The screen

- **`/brief`**, reached from the sidebar (a new entry, as the designs have icons for
  pages that exist) and from a line on `/` on Mondays: "Your week: 6 people worth a
  message."
- Each person: avatar, name, company, the one-line why, and two buttons — **Draft reply**
  (to their draft panel, as on `/`) and **Open**.
- Every line links to the contact, where the numbers behind it can be checked.
- No design covers this; it is built from `Main.dc.html`'s list cards, and says so.

## Part 3 — Same list all week

The brief is **computed**, not stored, but it must not shuffle as the week goes on.
The week runs **Monday to Sunday in Swedish time**, and every rule is measured against
**Monday of the current week**, so the same people stay in the list until Monday comes
round again. Acting on someone (answering, planning a touch) does remove them — that's
the point.

No migration: everything needed is already stored.

## Not in this slice

Email or push notifications of any kind (`plan.md` §4.3: "one weekly brief, that's the
budget", and the app cannot send). AI text in the brief. Promise detection across
threads — that's 6c.

## Commit order

1. This plan
2. Picking the brief, as pure functions with tests
3. `/brief`, the sidebar entry and the Monday line on `/`
4. Preview check, PR

## What the preview showed — 2026-09-18

The brief works as specified and the specification is too thin. On a real mailbox
it listed people who need nothing:

- a contact who handed the conversation to a colleague, after which the colleague
  was written to — the old thread is finished, but "they wrote 9 days ago" is still
  true, so he was Waiting on you;
- a contact whose own summary says to get back to him when the thesis period
  approaches, months away, listed as if he were owed a reply today;
- a contact no reply is owed to at all.

None of that is the picking rules. It's that whose-turn can only read message
headers, and nothing in the app can tell it otherwise: no way to say a thread is
finished, that a person is never chased, and a next touch silences the prompt only
inside the brief. That is slice 6c, `docs/slice-6c-plan.md`.
