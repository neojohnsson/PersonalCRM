# Personal CRM

**Turns Gmail into a contact list that tells you who's waiting on you.** Automatic import, relationship tracking, AI-drafted follow-ups — never sent automatically.

> **Status: in development.** Nothing below is finished yet. Checked boxes are built; unchecked ones are planned. I'd rather have a README that's honest than one that's impressive.

---

## Why

Professional contacts live in three places at once — your inbox, a spreadsheet, and your memory — and none of them answer the only question that matters: **who is waiting on me right now?**

Gmail tells you what was said. It can't tell you that someone replied eleven days ago and you never answered.

Storing contacts is the easy half; Google Contacts does it for free. The product here is the *timing*. And the automatic Gmail import isn't a convenience — it's what stops the list going stale, which is how every hand-maintained contact list dies.

---

## What it does

**Sync and import**

- [ ] Google sign-in and Gmail connection, with a plain-English explanation of what's read before the consent screen
- [ ] Incremental sync — no repeated full mailbox scans
- [ ] Person detection: filters out no-reply addresses, bulk senders, receipts, calendar noise
- [ ] Two-tier import — people you've actually exchanged mail with become contacts; everyone else waits in a pool you can promote

**Knowing where you stand**

- [ ] **Whose turn is it** — yours, theirs, or no open thread. Computed from the last message direction.
- [ ] Relationship warmth from real signals — reply rate, response time, recency, thread depth — with the signals always shown next to the score
- [ ] Stalled conversations, including the one that matters most: they asked you something and you haven't answered
- [ ] Next-touch date with a reason attached

**Where AI is used**

- [ ] Relationship summary — who they are, how you know them, what you discussed, what's next. Dated, editable, linked to source.
- [ ] Promise and deadline detection — "get back to me after the 20th" becomes a suggested date you confirm
- [ ] Duplicate detection with a merge you approve
- [ ] Draft the next email, in the language of the thread
- [ ] On-demand web research on one contact, every claim showing its source

**The weekly loop**

- [ ] A Monday brief: a handful of people worth reconnecting with, one line of why for each

---

## What it deliberately does not do

This list is part of the design, not a backlog.

| Not built | Why |
|---|---|
| **Sends email automatically** | There is no send button anywhere. A scheduler mailing a CEO on day 14 while you're in a lecture is the one failure that undoes everything the tool is for. |
| **Open tracking / read receipts** | Covert tracking of people who never agreed to it. |
| **LinkedIn scraping** | Against their terms, and there's no legitimate profile API for it. |
| **Data-broker enrichment** | Buying personal data on people who never consented is not a lawful basis. |
| **Stores your whole mailbox** | Metadata and summaries only. Bodies stay in Gmail. |
| **Judges how a relationship is going** | An AI guessing "they seem uninterested" about a named real person is both likely wrong and something that person can legally demand to see. |
| **Auto-merges duplicates** | Suggests, never merges. A wrong merge is effectively unrecoverable. |

---

## Principles

1. **It has to work with the AI switched off.** The first working version had none in it.
2. **A human approves anything that touches another human** — imports, merges, dates, drafts.
3. **Write every summary assuming its subject will read it.** Under GDPR they can ask for it.

Longer version, with the decisions behind them: [`docs/decisions.md`](docs/decisions.md)

---

## Getting started

Requires Node 20+, a Supabase project, and a Google Cloud project with the Gmail API enabled.

```bash
git clone https://github.com/neojohnsson/PersonalCRM.git personal-crm
cd personal-crm
npm install
cp .env.example .env.local    # fill in as each service comes online
npm run dev
```

Two things worth knowing before you touch `.env.local`:

- `NEXT_PUBLIC_` values are compiled into the browser bundle. Never prefix a secret.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses every row-level security policy. Server-side only.

Google setup, including the OAuth consent screen: [`docs/architecture.md`](docs/architecture.md)

---

## Stack

Next.js (App Router) · TypeScript · Supabase (Postgres + RLS) · Tailwind + shadcn/ui · Gmail API

---

## Roadmap

- [ ] **0** — Repo, Supabase project, Google Cloud project, OAuth consent screen
- [ ] **1** — Sign in, connect Gmail, sync 90 days of metadata, list people. No AI.
- [ ] **2** — Two-tier classification, review queue, contact record, manual edit
- [ ] **3** — Whose turn, next touch, warmth score ← *useful without any AI*
- [ ] **4** — AI relationship summary: editable, dated, sourced
- [ ] **5** — Draft generation into Gmail
- [ ] **6** — Weekly brief, promise detection, stalled threads, duplicate merge
- [ ] **7** — Privacy page, export, deletion, compliance write-up

Full plan with risks and trade-offs: [`docs/plan.md`](docs/plan.md)

---

## Privacy

The database holds names, addresses and notes about **real people who never signed up for this**. That shapes the whole design: read-only Gmail access plus drafts, no message bodies stored by default, full export and real deletion.

This app is **not publicly launched** — Gmail read access is a Google restricted scope, and public distribution requires OAuth verification plus a paid annual security assessment. The full reasoning: [`docs/privacy.md`](docs/privacy.md)

---

## Docs

- [`docs/plan.md`](docs/plan.md) — the full plan: features, risks, build order
- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit, and Google setup
- [`docs/decisions.md`](docs/decisions.md) — what was decided and why
- [`docs/privacy.md`](docs/privacy.md) — data handling and the compliance position

---

## About

Built by a systems science student in Växjö. I made a contact sheet by hand for a job search, watched it go stale, and wanted to find out what it takes to build the thing that would have maintained it — including the parts nobody demos: OAuth against someone else's API, per-user data isolation, and knowing when *not* to put an AI in front of something.

## License

MIT
