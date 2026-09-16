# Slice 2 — it has contacts

_Draft plan, 2026-09-16. Correct it before any code gets written._

**Goal** (from `plan.md` §7): two-tier classification, the review queue, the contact
record, manual add and edit.

**Done when** a test proves it — not when it renders:

- [ ] Two-user RLS tests pass for every new table and view
- [ ] Filter tests pass: automated senders are never stored; your own addresses are
      never a person
- [ ] Classification tests pass: two-way → contact, one-way → seen once, dismissed →
      gone and not stored again
- [ ] Contact form tests pass: required fields, email format, edits kept exactly as typed
- [ ] On the Vercel preview with a real mailbox: sync → contacts appear on their own,
      Seen once holds the rest, add and dismiss work, a contact added and edited by hand

**Who writes what** (`AGENTS.md`): Claude writes the code. Every piece is explained
before it's built and walked through after. The most depth goes to the RLS policies for
contacts and to the filter and classification rules — together they decide who ends up
in the database about whom.

---

## The privacy promise this slice keeps

`docs/privacy.md` lists as **not stored**: _"Anything from mail you never replied to,
beyond a 'seen once' address."_ Slice 1 stored header data for every message, including
newsletters. After slice 2:

| Who | What's stored |
|---|---|
| Automated senders (Part 1) | **Nothing** — the sync skips their messages and keeps only a count |
| Seen once — not yet decided | Their messages' headers, so the queue can show counts, subject and date |
| Seen once — dismissed | **Only the address**, so future mail from them is skipped too. Their stored messages are deleted |
| Contacts | Headers of every message, plus the contact record |

`privacy.md` gets updated to say exactly this.

---

## Part 1 — Who is a person (filtered during the sync)

A message from an automated sender is never saved (decision A). The rules look at the
sender only. Each one is conservative on purpose: a real person filtered out never shows
up anywhere, so a newsletter that slips through (and gets dismissed by hand) is the
cheaper mistake.

| Rule | Catches | Why this way |
|---|---|---|
| Local part is `noreply`, `no-reply`, `donotreply`, `do-not-reply`, `mailer-daemon`, `postmaster`, `bounce(s)`, `notification(s)` | automated senders | Unambiguous words only. `info@` and `hello@` are left alone — at small companies they're a real person |
| The message carries `List-Unsubscribe` | newsletters, bulk mail | Captured in slice 1 for exactly this |
| `calendar-notification@google.com` and similar calendar senders | calendar invites | The sender, not the content — bodies aren't read |
| A dismissed address | people you said no to | Decision A, applied to Seen once |

Only **incoming** mail is filtered. Mail you sent is always yours to keep.

**Your own addresses are never a person:** every `From` on mail you sent (which catches
aliases, via Gmail's `SENT` label) is left out of both tiers.

**Not filtered in slice 2:** receipts from a normal-looking address. Telling those apart
needs the body. Most carry `List-Unsubscribe` or come from a no-reply address anyway; the
rest land in Seen once, one click from dismissed.

## Part 2 — The two tiers

- **Contact (Tier A)** — at least one message from them _and_ one from you. Created
  automatically when a sync finishes.
- **Seen once (Tier B)** — everyone else who isn't already a contact and hasn't been
  dismissed. Shown in the review queue until you add or dismiss them.

**Import never overwrites.** It only creates contacts that don't exist yet. Once a
contact exists, nothing automatic changes it — what you type is never replaced by what a
sync found.

## Part 3 — Database (migration `0004`)

| Change | What | Why |
|---|---|---|
| `gmail_messages.subject` | the Subject header, decoded like names | Decision B: the Seen once rows and the contact page show it. `privacy.md` already lists subject as stored |
| `gmail_sync_state.filtered_count` | how many messages the rules skipped | The queue's "N automated messages filtered out" without storing who sent them |
| `contacts` | first name, last name, company, role, one line on what they do, how you know them, phone, notes, tags, source (`gmail` or `manual`), source thread | Decision C: the record from `plan.md` §3.2 and nothing more |
| `contact_emails` | the contact's addresses, one marked primary | People change jobs. One address belongs to at most one contact, so a message always finds its person |
| `seen_once_dismissals` | an address you dismissed, and when | So it stays out of the queue, and out of the database, after the next sync |
| `person_tiers` view | applies Part 2 on top of `people` | Classification in one place, tested once. `security_invoker`, like `people` |

Every table: `user_id`, RLS on, `anon` revoked, the same four policies as `0002`, two-user
tests first.

**The migration also clears `gmail_messages` and resets every sync to `ready`.** The
messages already stored were saved under slice 1's rules — newsletters included, no
subjects. The next Sync now re-reads the last 90 days the new way (about 4 minutes for a
mailbox like yours). Nothing is lost: Gmail still has all of it.

## Part 4 — Screens, from the designs

| Route | Design | What's in it | Left out, and why |
|---|---|---|---|
| `/` | `ContactList.dc.html` | `Contacts N · Seen once N` tabs, search (name, company, email), **Add contact**, table: name, company, messages, last contact — most recent first | Whose turn and Warmth columns, filter chips (slice 3) |
| `/seen-once` | `ReviewQueue.dc.html` | "N automated messages filtered out", checkbox rows: name, address, "1 from them · 0 from you", latest subject and date, bulk and per-row **Add as contact** / **Dismiss** | The design says "senders"; slice 2 counts messages, because counting senders would mean storing their addresses |
| `/contacts/[id]` | `ContactDetail.dc.html` | Header card (initials, name, role · company, emails, phone, tags), notes, latest thread's subject with **Open in Gmail** | Website and city (decision C), warmth, timeline, next touch, the Overview/Timeline/Threads tabs (slice 3) |
| `/contacts/new`, edit | none | The form | No design exists: built from `ContactDetail`'s card and the Connect page's form patterns, and said so in a comment |

## Part 5 — Not in slice 2

Whose turn, warmth, next touch, timeline (slice 3) · duplicate detection and merge
(slice 6) · deleting contacts and export (slice 7) · anything AI (slice 4+).

---

## Commit order

1. Filter rules + subject parsing, as pure functions with tests — not yet wired into the
   sync, because the columns they fill arrive in `0004`
2. Migration `0004` (columns, tables, view, reset) + RLS and classification tests →
   policies → green; the sync then skips filtered mail, counts it and saves subjects
3. Import after sync + tests
4. Contact list with tabs and search
5. Seen once queue: add, dismiss (deleting their messages), bulk
6. Contact page, add and edit forms + form tests
7. `privacy.md` updated; preview check with a real mailbox, fix what breaks, PR

## Decisions (agreed 2026-09-16)

- **A. Automated senders are not stored.** The sync skips their messages and keeps a
  count. Dismissing someone from Seen once deletes their messages and skips their future
  mail.
- **B. Subjects are stored.** Needed by the Seen once queue and the contact page.
- **C. Contact fields are `plan.md` §3.2's list only.** No website or city.
