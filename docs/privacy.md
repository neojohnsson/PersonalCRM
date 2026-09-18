# Privacy and data

_Draft. Written alongside the plan, before the code — the point is that these constraints shape the build rather than getting bolted on at the end._

## The situation

The database holds names, email addresses, employers, phone numbers and notes about **real people who never signed up for this application**. Under GDPR that makes almost every design question a data-protection question, and it's the reason several obvious features are not built.

Roles, when other people use it: the user is the data controller, this application is the processor. Third-party LLM providers are sub-processors.

## What is stored

| Stored | Not stored |
|---|---|
| Contact details: name, email, phone, company, role | Message bodies, by default |
| Message metadata: sender, recipients, timestamp, subject, thread id | Attachments |
| Your own notes and tags | Anything from automated senders — newsletters, no-reply addresses, calendar invites |
| An editable AI relationship summary, with the message ids it came from | Anything from someone you dismissed, beyond their address |
| The summary's suggestions for company, role and next touch, until you take or discard them | The email text sent to the AI |
| Your Profile: what drafts may know about you, and how they should sound | Anything fetched from a link you added — the app never opens them |
| A draft reply, only while it waits for you. Once saved, Gmail holds the text and the app keeps the Gmail draft id | The text of a draft after it is in Gmail |
| What each AI request cost: model, token counts, dollars | |
| Touch history — when contact happened and in which direction | |

### What the Gmail sync keeps, person by person

_Since slice 2 (`docs/slice-2-plan.md`, decision A)._

| Who | What is kept |
|---|---|
| Automated senders — a no-reply address, a `List-Unsubscribe` header, a calendar invite | **Nothing.** The sync skips their messages and only counts how many it skipped |
| Seen once, not yet decided — they wrote to you, or you to them, but never both | The headers of those messages, so the queue can show who, when and the subject |
| Dismissed from Seen once | **Only their address**, so their future mail is skipped too. The messages they sent are deleted at the moment they're dismissed |
| Contacts — mail in both directions, or added from Seen once or by hand | Headers of every message, plus the contact record |

Mail you sent is always kept, including mail to someone you later dismissed: it's your own mail, and it may have gone to other people too.

The filters decide from the sender and the headers only — never from a message body.

Message bodies are fetched live from Gmail when they're needed and are not persisted, **except** for contacts where the user explicitly opts in (not built yet). That retention has a visible period and a delete control, and the period is enforced by a scheduled job — a retention policy that isn't actually enforced is a lie in a privacy policy.

### What the AI summary sends, and what it keeps

_Since slice 4 (`docs/slice-4-plan.md`, Parts 1 and 7)._

Nothing is sent until you press **Generate summary** on one contact. Then:

1. The server reads your **last 20 emails** with that contact from Gmail.
2. It keeps only what each sender wrote this time — **quoted replies and signatures are
   cut** — and at most 2,000 characters per email.
3. That text, the contact's name and email addresses, and today's date go to OpenAI in
   **one request**.
4. **Only the answer is saved**: four short parts, suggestions for company, role and a
   next touch, and which emails each came from. The email text was held in memory for
   that one request — never written to the database, never logged. A test checks that
   the code reading it has no way to write it anywhere.
5. The answer waits as **pending** until you approve it. Suggestions change the contact
   only when you press their button; a next touch only when you save its form.

The instructions tell the model to leave out health, family matters, religion, politics,
union membership, sexuality, ethnicity and money troubles, and to write as if the
person will read it. Code can't check that — you can, before approving.

Spending is capped per user per month (`LLM_MONTHLY_CAP_USD`, $2 to start), checked in
the database before any request is sent.

### What drafting sends, and what it keeps

_Since slice 5a (`docs/slice-5a-plan.md`)._

Nothing is sent until you press **Draft reply** on one contact. Then:

1. The server reads the **latest thread** with that contact from Gmail — its last
   messages, with quoted replies and signatures cut.
2. That text goes to OpenAI together with **your Profile**, your notes on the contact,
   and the approved summary if there is one. **Nothing else about you.** Other contacts'
   mail is never included.
3. The reply comes back and waits **in the app**, where you read and edit it. It is not
   in Gmail, and nobody but you can see it.
4. **Save to Gmail drafts** creates a draft in that thread, with your edited text. The
   app then deletes its copy: Gmail holds the draft, and the app keeps its id and the
   time.
5. **You press send in Gmail.** The app has no send endpoint, button or schedule, and
   `tests/no-send.test.ts` reads every source file to prove it.

The draft permission Google grants (`gmail.compose`) does technically permit sending.
The Connect screen says so before you grant it. You can untick it, and everything but
Draft reply keeps working.

## Gmail access

- **Read** (`gmail.readonly`) and **create drafts** (`gmail.compose`, since slice 5a). The application has no send path: no send endpoint, no send button, no scheduled send.
- The draft scope generally also permits sending. The application asks for a permission it never uses, and its own Connect screen says so plainly rather than hoping nobody notices. Which permissions were actually granted is stored on the connection, and drafting is refused without `gmail.compose`.
- The scope needed is set by the AI features, not by what is stored. Summarising a thread requires reading the body, so the metadata-only Gmail scope is not an option. Storing less is still worth doing — it just doesn't buy a narrower permission.

## Why this is not publicly launched

`gmail.readonly` and the draft scopes are Google **restricted scopes** — the highest tier. Publishing to the general public requires OAuth verification plus an annual independent security assessment (CASA), repeated every year and priced for companies.

With no revenue, that cost cannot be justified. So the application stays in Google's testing mode with a small manually-added user list. Refresh tokens issued in that mode expire after roughly a week, so testers reconnect regularly — that is Google's behaviour, not a defect.

_Google changes these rules. Verify current terms rather than trusting this paragraph._

Choosing not to launch is a deliberate decision recorded here, not an unfinished task.

## Rights of people in the database

Anyone whose details are stored can request a copy of what is held about them, and request deletion — including the AI-written summary. Two consequences for the design:

1. Summaries are written assuming their subject will read them. No speculation about intent, no assessment of how promising someone is.
2. Deletion has to actually delete — one contact, all contacts, or the whole account — rather than setting a flag.

Article 14 — informing people whose data was collected from a source other than themselves — is contested ground that every CRM leans on exemptions for. Worth knowing which argument is being relied on rather than not having thought about it.

## Special categories

Email threads mention sick leave, politics, union membership, religion. A summariser will faithfully include any of it. The summarisation prompt instructs against it, and that instruction will sometimes fail — which is a further reason summaries are editable and reviewed rather than authoritative.

## Sub-processors

Email content is sent to an LLM provider for summarising and drafting. That is a transfer to a third party, named explicitly in the privacy policy, covered by a data processing agreement.

| Sub-processor | What it gets | Since |
|---|---|---|
| **OpenAI** (API, `gpt-5.6-luna` by default) | The text of up to 20 emails with one contact, their name and addresses, per summary you ask for | Slice 4 |
| **OpenAI** (API, `gpt-5-mini` for drafts) | The last messages of one thread, your Profile, your notes on that contact and its approved summary, per draft you ask for | Slice 5a |

What OpenAI's API documentation says, checked 2026-09-17
(https://developers.openai.com/api/docs/guides/your-data):

- API data is **not used to train** their models unless the account opts in.
- Requests are sent with **`store: false`**, so the response isn't kept for later
  retrieval.
- They may keep request data **up to 30 days for abuse monitoring**. Zero data retention
  exists but has to be approved for the account.
- Most likely processed in the **United States** — a transfer outside the EU.

While the app has one user, its author, that user is sending their own mail. Before
anyone else uses it: sign OpenAI's data processing agreement, and name OpenAI in a real
privacy policy. _Verify OpenAI's current terms rather than trusting this list._

## User controls

- See exactly what is stored, in plain words
- Export everything as JSON or CSV
- Delete a single contact, all contacts, or the account
- Turn per-contact body retention on and off, with the period visible
- Disconnect Gmail without deleting data, and delete data without disconnecting
