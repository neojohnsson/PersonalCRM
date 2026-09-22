# The Assistant — a workspace, not a chatbot

_Decisions taken 2026-09-22, before any code. Two slices: the calendar write it depends on,
then the Assistant itself._

**What you asked for.** A tab with real UI where you can talk to an AI that makes changes in
the app for you — drafts email, puts things in your calendar, and does the work — and where
you can also click things rather than only type. It replaces Your week and Promises, and it is
what a **premium** plan would charge for.

**What this document is.** The answers you gave to the questions that decide the shape, so
they survive the gap between planning and building. Nothing here is built yet.

---

## The rules it has to live inside

Three lines of `AGENTS.md` decide most of the design, and one of them has to bend:

| Rule | What it means here |
|---|---|
| "No send capability… Ever." | Unchanged. The Assistant drafts into Gmail; a human presses send in Gmail. There is no path in this design by which the app sends an email. |
| "Every AI output lands in a pending state a human approves." | **Bends, deliberately.** You chose: the Assistant does the safe, reversible things on its own and asks for the rest. Written down below, and `AGENTS.md` gets the amendment rather than the code quietly disagreeing with it. |
| "Message bodies are not stored by default." | Unchanged, and it is why the conversation is not saved. |

### What it may do without asking

Reversible, mine-only, invisible to anybody else — and every one of them already has an undo
built in 6c or 9b:

- notes and tags on a contact
- set, move or clear a next touch
- mark a conversation done (settled)
- "just a contact" on or off
- anything read-only: contacts, mail metadata, summaries, warmth, the calendar

Each one appears in an **activity list with Undo**, so "what did it just do" is answerable
without trusting the chat transcript.

### What it must ask for

Anything that leaves the app or costs real money:

- **a Gmail draft** — written, shown, and saved to Gmail only when you press Save
- **a calendar event** — proposed, created only when you press create
- **an expensive read** — a summary or a promise scan, with the price shown first

### What it may never do

- send an email, by any route
- create a calendar event **with guests**, because Google emails an invitation to each of
  them and that is the app causing mail to reach a real person. Events land on your own
  calendar with no guest list; you add guests in Google yourself if you want to invite
- delete a contact, delete all contacts, delete the account
- merge two contacts (a wrong merge is destructive and near-impossible to undo — `plan.md`
  §3.7 says never automatically, and an AI pressing the button is automatic)
- change the profile or the privacy settings

---

## Slice A — the calendar can be written to

The Assistant cannot propose an event until the app can make one, and you want the **whole
app** to be able to, not only the Assistant.

This reverses a decision that shipped on 2026-09-21, so it is its own slice and it says so out
loud:

- `calendar.events` (write) joins `calendar.events.readonly`, on a re-consent. `plan.md` §3.4
  said "a suggestion, never a silent calendar entry" — the suggestion part survives, because
  nothing is created without a press.
- `tests/calendar-scopes.test.ts` currently **fails if any code asks for a write scope**. It
  is rewritten to allow exactly `calendar.events` and still ban the other five, so the guard
  narrows rather than disappearing.
- **No guests, ever** — enforced in code and tested, not left to the prompt.
- `/privacy`, `docs/privacy.md` and the Connect and Calendar pages all currently promise
  read-only in plain words. Every one of them is corrected in the same slice as the change.
- A **Create event** button on the calendar page and on a contact ("book time with Karin"),
  because "the whole website" is what you asked for.

## Slice B — the Assistant

### The shape

A page at `/assistant`, and the sidebar goes from six entries to five: **Home · Assistant ·
Calendar · Contacts · Seen once**.

**Cards first, chat underneath.** The cards are built from the data the app already computes,
so the page is useful before a single token is spent — and if the AI is off or the cap is
reached, the cards still work.

| Card | Built from |
|---|---|
| **Who needs you** | `whoNeedsYou` and `pickBrief` — the people waiting, going quiet, or due today, each with a one-click draft or "mark done". This is what Your week did. |
| **Today and this week** | the calendar: your next meeting with a contact, what is open with them, and anyone you met and never followed up |
| **Things to decide** | duplicates to merge, summaries waiting for approval, promises found and not yet decided. What the review queues do, in one place. |

A slim strip under the cards — not a card of its own — shows **this month's spend, this
conversation's cost, and the activity list with Undo**. You did not pick it as a card, and it
is required by the budget and the "safe things alone" decisions, so it is there but quiet.

**No design covers this page.** It reuses `Main.dc.html`'s list cards and
`Calendar.dc.html`'s right-hand column, with every difference written down where it happens —
the same rule `/brief`, `/promises` and `/privacy` followed.

### The conversation

- **Not stored.** It lives in the browser and is gone when you leave. A transcript would hold
  quoted mail, and "message bodies are not stored" is the claim the whole privacy page rests
  on. The activity list carries what actually happened, which is the part worth keeping.
- **Streamed**, because a tool-using answer takes many seconds and "Writing…" on a button was
  already the worst wait in the app.
- **A stronger model than the rest of the app.** Summaries keep `gpt-5.6-luna` and drafts keep
  `gpt-5-mini`; this gets a better one, because calling the wrong tool is how cheap models
  fail at this and a wrong tool call here writes to a contact record.

### The money

- The cap rises to about **$10/month** for this tab, with its own line so a runaway
  conversation cannot starve summaries and drafts.
- The page shows what the conversation has cost **as it goes**, and stops at the cap.
- `withSpendCap` already reserves before a request and settles after; an agent loop reserves
  per step, so stopping mid-conversation leaves the spending recorded honestly.

### Premium

One boolean on the profile decides whether the tab exists — `profiles.assistant_enabled`, on
for you. No payments, no tiers. Slice 11 (release) wires real subscriptions to the same flag
without touching the feature. With it off, the sidebar entry is absent and `/assistant`
redirects.

### What happens to Your week and Promises

Deleted in this slice, when their replacement is on screen: the two page directories, the
Monday line on Home, and their tests. `lib/relationship/brief.ts` and `lib/ai/promise*.ts`
**stay** — the cards are built on them, and running a promise scan is one of the things you
asked the Assistant to be able to do. The `promises` table stays for the same reason.

In 9b they only leave the sidebar, so nothing disappears before the cards exist.

---

## The risks, named now

1. **A tool-using loop is the first thing in this app that acts on its own.** Everything
   before it proposed and waited. The safe-list above is deliberately small and every item on
   it is one row or one column, reversible, and logged.
2. **Cost is unbounded in shape, not just in amount.** One badly phrased question can cause
   twenty tool calls. Per-step reservation plus a hard per-conversation ceiling, and the
   ceiling is visible while you talk.
3. **The model will call the wrong tool sometimes.** Which is why the tools that matter ask
   first, and why merging and deleting are not tools at all.
4. **It could become the only way to use the app.** The cards exist so that the page is a
   better Home even with the AI switched off. If the chat box disappeared tomorrow the page
   should still be worth opening.

## Still open

- Which tool names and shapes the model sees (a JSON schema each, like the summary's).
- Whether the cards refresh live or on navigation.
- What the empty state says before you have asked anything.
