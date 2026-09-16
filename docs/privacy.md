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
| An editable AI relationship summary | Anything from someone you dismissed, beyond their address |
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

Message bodies are fetched live from Gmail when they're needed on screen and are not persisted, **except** for contacts where the user explicitly opts in. That retention has a visible period and a delete control, and the period is enforced by a scheduled job — a retention policy that isn't actually enforced is a lie in a privacy policy.

## Gmail access

- **Read** and **create drafts**. The application has no send path: no send endpoint, no send button, no scheduled send.
- The draft scope generally also permits sending. The application asks for a permission it never uses, and the consent screen says so plainly rather than hoping nobody notices.
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

## User controls

- See exactly what is stored, in plain words
- Export everything as JSON or CSV
- Delete a single contact, all contacts, or the account
- Turn per-contact body retention on and off, with the period visible
- Disconnect Gmail without deleting data, and delete data without disconnecting
