# Slice 6a — duplicate contacts, merged by hand

_Draft plan, 2026-09-18. Correct it before any code gets written._

**Goal** (`plan.md` §3.7): "Detect by email, by name + company, by phone. **Suggest a
merge, show both records side by side, you press merge.** Never auto-merge — a wrong
merge is destructive and near-impossible to undo."

Found on real mail: you wrote to `carl-johan.hultenheim@atea.se`, he answered from
`@atea.com`, and the sync made **two contacts** — one named, holding his reply, one
unnamed, holding your message. Whose turn, warmth and every summary are then wrong for
both halves.

Split from slice 6 at the user's choice: **6b** is stalled conversations and the weekly
brief, **6c** is promise detection across every thread.

**Done when** a test proves it — not when it renders:

- [ ] Detection tests pass: the same name; a reply from a new address inside your own
      thread; the same phone; and **no** suggestion for two people who merely share a
      first name or a company
- [ ] Merge tests pass, with two users: addresses move, empty fields fill, the kept
      contact's own summary, next touch and draft stay, and the other contact is gone
- [ ] Nothing is merged without a person pressing the button, and a merge is written in
      one transaction — both contacts or neither
- [ ] Two-user RLS: nobody can merge another user's contacts, in either direction
- [ ] On the preview with a real mailbox: the two Carl-Johans are suggested, merged, and
      his whose-turn and warmth are then right

## Part 1 — Finding duplicates (no AI)

Plain rules over data already stored. A pair is suggested when **any** of these holds:

| Signal | Why it is safe |
|---|---|
| **Same full name** (ignoring case and accents) | "Carl-Johan Hultenheim" twice is one person, near enough to ask |
| **A reply from a new address in your own thread** | Only together with one of the others — sharing a thread alone is not evidence, since Pontus is in Carl-Johan's thread and is a different person. With a matching name it is the strongest signal there is, and exactly the Atea case |
| **Same phone number** (digits only, last 9) | Typed by you, so it means what it says |
| **Same name built from the address** — `carl-johan.hultenheim@` on both sides | Catches the unnamed half a sync creates |

**Never** on a shared first name, a shared company, or a similar-looking address alone.
The plan's warning stands: a wrong merge is destructive.

Each suggestion carries **why**, in those words, and both contacts' details.

## Part 2 — What a merge does (decision B)

You pick which contact to **keep**. Then, in one database transaction:

- **Addresses** move to the kept contact; it keeps its own primary.
- **Empty fields** on the kept contact are filled from the other — company, role, phone,
  one-liner, how you know them, notes appended with a line saying where they came from.
  A field with something in it is **never** overwritten.
- **Tags** are the union of both.
- **Summary, next touch, draft:** the kept contact's own are left alone. The other's are
  taken only where the kept contact has none; anything else is deleted with the contact.
- **The other contact row is deleted.** Its messages are untouched: mail belongs to
  addresses, not contacts, so the merged contact now has the whole history.
- **Undo:** none. That's why it asks first, shows both, and never merges on its own.

## Part 3 — Where it appears

- **Contacts page:** a quiet line above the table — "2 possible duplicates" — leading to
  `/contacts/duplicates`.
- **`/contacts/duplicates`:** each pair side by side with the reason, the addresses, and
  the counts (messages, summary, next touch). Two buttons: **Keep this one** on each
  side, and **Not the same person**.
- **Dismissed pairs stay dismissed** (a small table), so the list doesn't nag.
- No design exists for this screen; it is built from the contact list's card and the
  summary card's side-by-side, and says so in a comment.

## Part 4 — Database

`0017_duplicates.sql`:

- `merge_contacts(p_user_id, p_keep_id, p_merge_id)` — security invoker,
  `search_path = ''`, doing Part 2 in one transaction and raising `P0002` when either
  contact isn't the caller's.
- `duplicate_dismissals` — the pairs you said aren't the same person, with the usual four
  RLS policies.

## Not in this slice

Merging three or more at once (merge twice) · undo · finding duplicates by fuzzy name
("Carl Johan" vs "Carl-Johan") · anything AI.

## Commit order

1. This plan
2. Detection rules, as pure functions with tests
3. Migration `0017`: merge and dismissals, with two-user tests
4. The duplicates page and the contact list's line
5. Preview check, PR
