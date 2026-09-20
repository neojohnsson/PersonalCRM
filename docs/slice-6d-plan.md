# Slice 6d — the promises sitting in your mail

_Draft plan, 2026-09-20. Correct it before any code gets written._

**Goal** (`plan.md` §3.4, §7): "Promise and deadline detection — the AI reads a thread and
proposes 'follow up after September 20' as a *suggested* date you confirm. Suggestion, never
a silent calendar entry." Across **every** thread, which is the part that doesn't exist yet.

**What already exists.** The summary (slice 4) suggests a next touch — but only for the one
contact whose page you opened, and only when you press Regenerate. Pär's summary said to get
back to him when the thesis period approaches and nothing acted on it, because nobody opened
his page. This slice goes looking instead of waiting.

**What it finds.** Sentences where somebody said they would do something:

| Who owes | Example | Becomes |
|---|---|---|
| **You** | "I'll send the report next week" | a next touch, dated, "You said you'd send the report" |
| **Them** | "I'll check with the team and come back to you" | a next touch, dated, "They said they'd come back to you" |

Both are worth catching. The second is the Pär case, and it is the one no other part of the
app can see.

## Part 1 — nothing is created, everything is suggested

`AGENTS.md`: every AI output lands in a pending state a human approves, and is dated,
editable, and links to its source. So a found promise is a **suggestion** in a review queue:

- **Accept** — it becomes an open next touch with that date and reason, the thing the rest of
  the app already understands.
- **Change the date** before accepting.
- **Not a promise** — dismissed, and never offered again for that message.

A promise never becomes a next touch, a draft, or anything else on its own.

## Part 2 — the negation problem, which is the whole risk

`plan.md` §5.3 names it: *"I **can't** get back to you before the 20th"* and *"get back to me
after the 20th"* produce the same date and opposite meanings. A model that reads 30 threads
will get some of these wrong, and a wrong promise is worse than no promise: it makes you
chase someone who owes you nothing.

Three things against it:

1. **The review screen shows the sentence itself**, not the AI's paraphrase of it — read
   live from Gmail when you open the queue, never stored (Part 4). You judge the words.
2. **The model must answer with the message it found the promise in**, and a promise whose
   source message isn't in the thread it was given is thrown away in code, not trusted.
3. **A negation test suite**: "can't before the 20th", "unless you hear from me", "no need to
   reply", "I'll let you know if anything changes" — every one of these must produce *no*
   promise. These are written as fixtures against the checking code, so they cost nothing to
   run and can't regress quietly.

If a sentence is ambiguous, the rule is the same as everywhere else in this app: say nothing.

## Part 3 — what it costs, and how that is kept small

Reading every thread for every contact, on every sync, forever, is exactly the cost mistake
`plan.md` §5.4 warns about. So:

- **On demand.** A **Look for promises** button on `/brief`, not a job that runs on sync.
- **Only contacts worth reading**: an open thread (not "No open thread"), not settled, not
  "just a contact", and **no open next touch already** — if you have a date for them, there
  is nothing to find.
- **Only what's changed**: `promises_scanned_at` per contact. A thread with no new message
  since the last scan is skipped entirely.
- **One request per contact**, over the latest thread only, reusing `loadThreadContext` and
  the same "last 20 messages" window the summary uses.
- **Five contacts per press** (decided while building, 2026-09-20). Reading one takes five to
  twelve seconds, nearly all of it waiting for the model, against a 60 second budget for the
  request. Reading everything and hoping fails in the worst way: the request is killed part
  way through, the spending is already recorded, and the promises from the contact it was in
  the middle of are never written. The button says how many are left for the next press.
- **One Gmail token for the whole scan.** `getAccessToken` refreshes against Google on every
  call, so asking per contact was a round trip per contact for a token good for all of them.
- The cheap model (`gpt-5.6-luna`), under the existing monthly cap — `withSpendCap` already
  reserves before the request and settles after, so a scan can never run past £2.
- The button says what it will cost before you press it: "23 contacts to read, about $0.04."

## Part 4 — message text is read, never stored

`AGENTS.md`: message bodies are not stored by default. A verbatim sentence from an email is
body text, so none is written to the database. What is stored is the AI's own short reason
("said he'd watch for openings"), the date, who owes, and the **message id**.

The review screen then reads that one message from Gmail as the page loads — the app already
does exactly this for drafting and summaries — and shows the sentence for as long as the
screen is open. Nothing verbatim is persisted, and the check you make is against the real
words rather than a paraphrase of them.

## Part 5 — the migration

`0019_promises.sql`:

- `promises` — `id`, `user_id`, `contact_id`, `thread_id`, `message_id`, `owed_by`
  (`you` | `them`), `due_on`, `reason`, `status` (`pending` | `accepted` | `dismissed`),
  `created_at`, `decided_at`, `next_touch_id` when accepted. Composite foreign key
  `(contact_id, user_id) → contacts (id, user_id)`, four RLS policies, and a partial unique
  index on `(user_id, message_id)` so re-scanning the same message never offers it twice.
- `alter table contacts add column promises_scanned_at timestamptz` — what "changed since the
  last scan" is measured against.

## Part 6 — the screen

`/promises`, from the sidebar, built on `design/ReviewQueue.dc.html` — the screen that exists
for exactly this shape of work, a queue of suggestions with accept and dismiss on each row.
Each row: the contact, who owes what, the date, the sentence read from Gmail, a link to the
message, and **Accept** / **Change date** / **Not a promise**.

A line on `/brief` says how many are waiting.

## Done when — a test proves it, not when it renders

- [ ] The negation fixtures all produce no promise
- [ ] A promise whose source message isn't in the thread given to the model is dropped
- [ ] Accepting creates an open next touch with that date and reason, and the promise is
      marked accepted and never offered again
- [ ] Dismissing keeps the row and never offers that message again, including after a rescan
- [ ] A scan skips contacts that are settled, never chased, have an open next touch, or have
      had no new message since `promises_scanned_at`
- [ ] The scan stops at the monthly cap, having spent nothing past it
- [ ] `promises` passes the two-user RLS test
- [ ] No verbatim message text is written to the database — asserted in code, like
      `tests/no-send.test.ts` asserts there is no send endpoint
- [ ] On the preview, with the real mailbox: a promise found, checked against the real
      sentence, accepted, and showing up as a next touch

## Not in this slice

- Scanning on a schedule, or any kind of notification (`plan.md` §4.3: one weekly brief is
  the budget, and the app cannot send).
- Meeting notes as a source (`plan.md` §6.5) — needs a notes source to exist first.
- Calendar.

## Commit order

1. This plan
2. Migration 0019, with its RLS test
3. Finding promises: the prompt, the schema and the checking, with the negation fixtures
4. The scan: which contacts, what it costs, the cap
5. `/promises`, the sidebar entry and the line on `/brief`
6. Preview check, PR
