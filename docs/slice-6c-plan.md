# Slice 6c — telling the app it's wrong

_Draft plan, 2026-09-19. Correct it before any code gets written._

**Why this slice exists.** Slice 6b's brief listed people who need nothing: a contact who
handed the conversation to a colleague you then wrote to, a contact whose own summary says
to get back to him when the thesis period approaches, and a contact no reply is owed to at
all. The picking rules aren't the problem. The problem is that whose-turn can only read
message headers, and **nothing in the app can tell it otherwise**.

So the app infers, and the person can never correct it. This slice gives them three ways to,
and stops the app phrasing a fact as an instruction.

## Part 1 — three things a person can say

| They say | Stored as | What stops |
|---|---|---|
| **Nothing owed here** — this conversation is finished, the relationship is fine | a row in `settled_threads` (contact + thread + when) | that thread stops counting as their turn, on `/`, in the brief and on the contact page |
| **Planned for later** — the right moment is months away | the open next touch that already exists | an open touch dated *after today* silences the prompt everywhere, not only in the brief |
| **Just a contact** — never chase this person | `contacts.never_chase` | every prompting surface, for good. They stay in the list and still count for warmth |

**A settle lapses on its own.** It records when you pressed the button. If a newer message
arrives in that thread, the newer message wins and the thread is open again — a new message
is a new fact, and saying "nothing owed" today must not make you blind next week.

**Nothing is automatic.** The app could notice that someone referred you on and that you
then wrote to the person they named, and hide the old thread by itself. It won't: wrong
inference is what put these people in the brief. That idea becomes a *suggestion* you
accept, in a later slice.

## Part 2 — one place decides whether to prompt

`whoseTurn` is left exactly as it is. "Who wrote last" is plain arithmetic over headers and
is the one thing in the app that cannot be wrong; the fix does not belong inside it.

A new pure module, `lib/relationship/standing.ts`, sits on top and answers a different
question — *what should the app say about this person, and should it ask anything of you?*

```ts
export type Standing =
  | { kind: "never_chase" }                  // just a contact
  | { kind: "planned"; dueOn: string }       // an open touch, dated later than today
  | { kind: "settled"; at: Date }            // this thread is finished
  | { kind: "open"; turn: Turn };            // nothing said: the plain fact

export function standingOf(input: StandingInput, today: string): Standing;
export function prompts(standing: Standing): boolean;
```

Precedence, when more than one is true: **never chase → planned → settled → the fact.**
Planned beats settled because a date you chose is more use to you than a thread you closed.

`whoNeedsYou` (`/`), `pickBrief` (`/brief`) and the contact page all ask `standingOf` instead
of reading `turn.kind` directly, so "do we prompt about this person" is decided once and
tested once.

`loadRelationships` grows two fields: `settledAt` for the latest thread, and `neverChase`.
Open next touches are already loaded separately by every page that needs them.

## Part 3 — the words

**Tried and reverted, 2026-09-19.** The first attempt replaced "Your turn" with "They
wrote last" and "Their turn" with "You wrote last", on the grounds that the app should
state the fact and not give orders. It states the fact, but it makes the reader work out
whose turn it is every single time — which is the one job the pill exists to do. The
design's words are back.

What was actually wrong was never the words. It was that "Your turn" was the *only* thing
the app could say, so it said it about conversations that were finished, days already
chosen, and people who are never chased. Parts 1 and 2 give those their own words, and
"Your turn" is left to mean what it says:

| Label | When |
|---|---|
| `Your turn · 6 days` | they wrote last and nothing has gone back |
| `Their turn · 3 days` | you wrote last, less than two weeks ago |
| `Going quiet · 24 days` | you wrote last, over two weeks ago |
| `No open thread` | the last message either way is over 30 days old |
| **`Nothing owed`** | you said so — until they write again |
| **`Planned for 3 March`** | a next touch you set, for a day that hasn't come |
| **`Just a contact`** | prompting is switched off for this person |

The three in bold are new, and they win over the first two. The contact list's default
order is unchanged: people whose turn it is still come first.

## Part 4 — the buttons

- **Not needed** — a ghost button on each brief row and on each `/` row (beside Draft reply,
  on hover, as that one already is). It settles the thread that row is about. This is
  `Calendar.dc.html`'s own button, so it isn't a new pattern.
- **Nothing owed here** — on the contact page, beside Edit and Draft reply. Once settled the
  pill beside the name reads **Nothing owed** and the button becomes **Reopen the thread**.
- **Just a contact** — not `Profile.dc.html`'s switch in the end, but the same ghost pill as
  its neighbours, filled in when it is on. A lone switch in a row of pills looked like a
  setting that had wandered onto the wrong screen, and the pill beside the name already says
  which state the contact is in.

Every one of these is a server action that checks the user itself, and every one is
reversible from the contact page. Nothing is deleted.

## Part 5 — the migration

`0018_settled_threads.sql`:

- `settled_threads` — `user_id`, `contact_id`, `thread_id`, `settled_at`. No `note` column:
  nothing writes one yet, and a column no code fills is a promise the schema can't keep.
  Keyed on the three ids, composite foreign key `(contact_id, user_id) → contacts(id, user_id)`
  as everywhere else, and four RLS policies.
- `alter table contacts add column never_chase boolean not null default false`.
- `create or replace view contact_list` with `never_chase` appended at the end, so the list
  can show it without a second query. Appending is the only change a view allows in place.

## Done when — a test proves it, not when it renders

- [ ] A settled thread stops prompting on `/`, in the brief and on the contact page — and a
      newer message in that thread re-opens it
- [ ] An open next touch dated after today silences every prompt; the contact page says
      "Planned for 3 March" instead of whose turn it is
- [ ] Never chase is never prompted anywhere, still appears in the contact list, and still
      counts toward warmth. A next touch is the exception and still shows, in Coming up and
      in the brief: it is a day *you* chose, and silencing it would only hide your own plan
      (decided while building, 2026-09-19)
- [ ] `settled_threads` passes the two-user RLS test: one user can neither see nor settle
      the other's threads
- [ ] Precedence is tested where several apply at once
- [ ] On the preview, with the real mailbox: the handed-off contact settles and leaves the
      brief, the spring conversation leaves it once it has a date, and the contact no reply
      is owed to settles

## Not in this slice

- Suggesting a handoff from a referral you have already acted on — later, and only ever as a
  suggestion.
- Re-ordering the contact list.
- Promise and deadline detection across every thread: that was 6c in the old numbering and
  becomes **6d**.

## Commit order

1. This plan
2. Migration 0018, with its RLS test
3. `standing.ts`, the loaders, and `/` and the brief honouring it — with tests
4. The wording pass
5. The buttons and the switch
6. Preview check, PR
