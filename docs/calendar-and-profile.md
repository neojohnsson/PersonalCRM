# Calendar and Profile — two later pages

_Written 2026-09-16, before any code. Designs: `design/Calendar.dc.html` and
`design/Profile.dc.html` (artboards 6 and 7 on the canvas). Neither page is in
slices 1-3. Profile is needed by slice 5 (drafting). Calendar is idea 4 in
`plan.md` §6 and does not have a slice yet._

---

## Calendar

### What it's for

The calendar page answers the same question as the rest of the app, *who needs
me*, but uses meetings as well as email. A meeting with someone is the strongest
sign that a relationship is warm (plan §6.4). Two things only a calendar can tell
you:

- **Before a meeting:** what's open with this person right now.
- **After a meeting:** you met someone and never followed up.

### How it's used

| Part of the page | What it shows | Where the data comes from |
|---|---|---|
| Week grid | Your Google Calendar events. Meetings with a contact get that contact's colour and initials; everything else is grey | Google Calendar events, with guest emails matched against your contacts |
| "Due" row | Next-touch dates that fall this week | The app's own next-touch dates (slice 3), **not** Google Calendar |
| Before your 15:30 | Your next meeting with a contact: whose turn it is, the open thread, your notes | Data the contact record already has. Nothing new is read |
| Met, no follow-up | A meeting with a contact has ended and you haven't emailed them since | Event end time compared with the last message you sent |
| Month / Agenda | Other views of the same data | — |

None of this uses AI. It is plain computation, like whose turn it is and warmth.

### Rules

- **Read-only.** Ask for the smallest Google scope that is enough
  (`calendar.events.readonly`, or `calendar.readonly` if listing calendars turns
  out to need it). Check the current scope names before building.
- **Read** the start time, end time, title and guest email addresses. **Don't
  read** event descriptions or attachments. People paste private things into
  them.
- **Never create, edit or delete an event.** The plan already says a detected
  follow-up date is "a suggestion, never a silent calendar entry". A next touch
  stays a date inside the app.
- **Store as little as possible.** For a meeting with a contact, store the date,
  time and which contact it was, because that counts toward warmth. Don't store
  other events. Fetch them live, the same way message bodies are handled.
- Calendar is a **separate connection** with its own consent screen. The app
  must still work fully without it.

### Effect on warmth

A meeting would count as a touch in the warmth calculation. The contact page
would have to say so next to the score, like "met 2 days ago". The warmth rule
is that the number is always shown with the signals that produced it.

### Still open

- Does a meeting count the same as an email exchange, or more?
- What about a meeting with five guests where only one is a contact?
- Should one "Add to Google Calendar" button exist on a next touch, pressed by a
  person? It would need a write scope, so the default answer is no.

---

## Profile

### What it's for

It holds everything the drafting AI is allowed to know about **you**. When a
draft is generated in slice 5, the AI gets the thread, your notes on the contact,
and this page. It gets nothing else about you. Keeping it all on one page also
makes it easy to see, edit and delete.

### How it's used

| Section | What you do there | How drafts use it |
|---|---|---|
| **About you** | Name, where you're based, what you do, what you're looking for, signature, languages | Every draft gets this as background |
| **Files** | Upload a CV or other document (PDF, Word, text, up to 10 MB). "Use in drafts" can be turned off per file | The text is read once, on upload. Drafts use approved facts, not the whole file (see the next row) |
| **Read from your CV** | The AI pulls short facts out of an uploaded file. Each fact shows its page. You approve, edit or discard it | Only **approved** facts go into drafts |
| **How drafts sound** | Pick a tone: Professional, Friendly, Casual or Brief. Set length, how people are addressed, the sign-off, and a "never write" list | Turned into instructions for the drafting AI. Can be changed for a single draft |
| **Links** | Add LinkedIn, GitHub and similar links, and choose which go in the signature | The AI gets the **address as text**. It can write "my LinkedIn is …" |

Language is not a setting. A draft always uses the language of the thread
(plan §1).

### Why it's built this way (the hard rules)

- **Facts from a CV are AI output.** They wait for your approval like every
  other AI output. Each one is dated ("read 14 Aug"), editable, and links to its
  source page.
- **No LinkedIn scraping.** The app never opens a link, so pasting your LinkedIn
  URL is safe. This is written on the page so nobody assumes otherwise.
- **Nothing goes to the AI until you ask for a draft.** The page header says so.
- **Files contain personal data.** A CV has your phone number, address and
  sometimes a photo. Store files in Supabase Storage in a private bucket, with
  RLS so only the owner can read them. Test that with two users, like every
  other policy. Deleting a file also deletes its extracted text and any facts
  that came from it.
- **No send capability** is unaffected. Settings shape a draft, and a person
  still presses send in Gmail.

### What gets stored

| Stored | Not stored |
|---|---|
| Your profile fields and draft-style settings | The AI's raw output before you approve it (only pending facts) |
| Uploaded files, in a private bucket | Anything fetched from a link |
| Text extracted from each file | |
| Facts, each with its status (waiting / approved / discarded), source file, page and date | |

### Still open

- Scanned PDFs have no text layer. Leave OCR out and show "couldn't read text
  from this file".
- Should "Friendly" tone also have a few example emails you wrote yourself?
  That might match your voice better than a label, but it means storing email
  text you wrote, which goes against "bodies are not stored by default".
- The design's size limit is 10 MB. Adjust it to whatever the storage plan
  allows.

---

## Navigation

Both pages are already in the sidebar of the existing designs. The calendar
icon opens Calendar, and the avatar at the bottom opens Profile. The designs show
each one in its active state.
