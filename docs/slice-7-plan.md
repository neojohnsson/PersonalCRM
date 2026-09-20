# Slice 7 — the privacy work, and the thing that makes it a portfolio piece

_Draft plan, 2026-09-20. Correct it before any code gets written._

**Goal** (`plan.md` §3.12): "Privacy controls — a real feature, not a footer link. A page that
shows, in plain words, exactly what is stored about you and about the people in your list.
Export everything. Delete one contact, delete all contacts, delete account — and it actually
deletes. A real privacy policy written for humans."

**Why this one matters most** (`plan.md` §5.2): "This is the part most student projects ignore
and the part that would most impress someone at Combitech if you get it right." The database
is full of people who never signed up. A CRM that can show what it holds on them, hand it
over, and really delete it is a different class of project from one that can't.

**What already exists.** `docs/privacy.md` is written and honest — what the sync keeps, what
the AI is sent, what drafting sends, sub-processors, the Article 14 position. What does not
exist is any of it *in the app*, where the person can act on it.

## Part 1 — `/privacy`, built from the real numbers

Not a static page. It counts what is actually in the database, this minute:

> **21 contacts. 61 message headers. 21 AI summaries. 2 drafts in Gmail.**
> No message bodies are stored. Nothing is shared with anyone except the two services below.

Then, in plain words and in this order: what is kept about **you** (Google account, refresh
token, encrypted), what is kept about **each person in your list**, what is sent to OpenAI and
when, what is sent to Google and when, and how long each of those keeps it.

Every number links to where it came from, so it can be checked rather than believed.

No design covers this; it reuses `Profile.dc.html`'s sections and rows, and says so.

## Part 2 — export everything

- **Everything, as JSON** — one file, every table this user owns: contacts, addresses,
  message metadata, summaries, next touches, promises, settled threads, drafts, AI usage.
- **Contacts as CSV** — the one people actually open, for a spreadsheet or another CRM.
- **One person, as JSON** — from a contact's page. This is the one that answers a subject
  access request: everything the app holds about *that person*, including the AI summary and
  what it was based on, in a form you can hand over.

Downloaded from the browser, generated on the server, never stored anywhere.

## Part 3 — deletion that actually deletes

| | What goes |
|---|---|
| **One contact** | exists already (`dismiss_contact`, migration 0012): the contact, their mail, their summaries, touches, promises. Their address is kept so the sync doesn't re-import them |
| **All contacts** | every contact and everything hanging off them. The Gmail connection and the account stay |
| **Everything, and the account** | all of the above, the Gmail connection with its refresh token **revoked at Google**, the profile, the AI usage records, and the auth user itself |

**Decided 2026-09-20: deletion goes all the way**, including the Supabase auth user — signing
in again would start a new, empty account. That is what "and it actually deletes" means.

Account deletion needs a confirm step that names what goes and cannot be undone, and it has
to revoke the Google token — leaving a valid refresh token behind after "delete everything"
would be the single worst bug this app could have.

## Part 4 — the rights of the people in the list

`plan.md` §5.2: "A person in your database can demand a copy of what you hold on them, and
demand deletion — from you. Including the AI summary."

So the contact page gets **Export this person** and the existing Dismiss becomes the documented
answer to an erasure request. `/privacy` explains both in a sentence each, and `docs/privacy.md`
gains the procedure: what to do when someone writes and asks.

## Part 5 — what this slice does NOT build, and why

**Per-contact opt-in body retention** (§3.12's fifth bullet). It is the only item on that list
that *adds* data rather than removing it, and the app's current position — message bodies are
never stored, they are read per request and thrown away — is stronger than any retention
policy could be. `plan.md` §5.2 says it itself: "a retention period that isn't actually
enforced by a scheduled job is a lie in your privacy policy", and there is no scheduler.

**Decided 2026-09-20: leave it unbuilt**, and say so plainly on `/privacy` — "message bodies
are never stored" is a stronger claim than any retention period, and it is already true. If it
is ever wanted, it belongs with slice 9's release work, next to the retention job that would
make it honest.

## Done when — a test proves it, not when it renders

- [x] The counts on `/privacy` match what is really in the database, for that user only
- [x] Export contains every table the user owns, and nothing of anyone else's — proven with
      two users
- [x] One person's export contains their summary, their messages' metadata and their sources
- [x] "Delete all contacts" leaves the account and the Gmail connection working
- [x] "Delete everything" leaves no row anywhere with that user's id, and the Google refresh
      token is revoked at Google, not merely deleted locally
- [x] Deleting is refused unless the confirm step was completed
- [x] A second user's data is untouched by every one of the above

## Not in this slice

- Body retention and the job that would enforce it (Part 5).
- The processor-side paperwork — DPA, records of processing, sub-processor list as a public
  document. That is slice 9, and only if the app is released.
- The 90-second demo recording, which comes after this merges.

## Commit order

1. This plan
2. `/privacy`, the counts and the plain-words sections
3. Export: everything, contacts CSV, one person
4. Deletion: all contacts, then the account, with its confirm step and the Google revoke
5. `docs/privacy.md` updated to match what the app now does
6. Preview check, PR
