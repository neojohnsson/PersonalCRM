# Contact Hub — project plan

_Planning doc, not code. Written 2026-09-11 from the Notion page "PROJECT: Keep Contants Together with Automatic Import from Gmail" plus four rounds of decisions._

---

## 1. What we decided

| Question | Decision |
|---|---|
| Who it's for | A real product shape, and first **a portfolio piece that works**. _Changed 2026-09-17:_ a public release with paid plans later is a goal too — built for, not chased yet (slice 9). |
| First user type | **Researchers / networkers** — people keeping loose professional contacts warm |
| Relation to DealFlow | **Totally separate project** |
| Gmail permissions | **Read + create drafts.** Never sends on its own. |
| Contact scope | Everything professional |
| Import policy | **Two tiers** — 2-way conversations become real contacts, everyone else lands in a "seen once" pool |
| Email storage | **Metadata + editable AI summaries.** Bodies stay in Gmail. Optional opt-in retention per contact, with a delete control. |
| Progress model | **Relationship-warmth score from real signals** — not an AI opinion |
| Stack | Next.js + Supabase + Vercel |
| Pace | Sprint to a demo, then slow down |
| Language | English UI, drafts in the thread's language |

**One-sentence definition:** _Contact Hub watches your mail, turns the people you actually talk to into a contact you can trust, and tells you who is waiting on you._

That sentence is the test. Every feature below either serves it or gets cut.

---

## 2. What the program actually is

There are three things in the box, and it matters that you keep them separate in your head:

1. **A sync engine.** Reads Gmail, works out who is a person, who you actually have a relationship with, and who wrote last. No AI needed. This is the hard, boring, valuable part.
2. **A contact record.** Facts you can trust, that you can always edit by hand.
3. **A decision layer.** Whose turn it is, when to touch base next, who is going cold. This is what makes someone open the app on a Tuesday.

The AI is a garnish on all three. If the AI were switched off tomorrow, the app should still be useful. If it isn't, you built a demo, not a product.

---

## 3. Core functions — the MVP

### 3.1 Connect and sync

- **Google sign-in + Gmail connect**, with a plain-English screen explaining exactly what is read and what is stored *before* the Google consent screen appears.
- **Incremental sync** (Gmail History API, not a full re-scan). Initial backfill window is user-chosen — default 12 months, not "everything".
- **Person detection**: strip no-reply addresses, bulk senders (List-Unsubscribe header), automated domains, calendar invites, receipts, your own aliases.
- **Two-tier classification:**
  - **Tier A — Contacts.** At least one message from them *and* one from you. These import automatically.
  - **Tier B — Seen once.** Everyone else. Sits in a separate pool, promotable in one click, never clutters the main list.
- **Sync status that doesn't lie.** "Last synced 4 minutes ago · 312 messages · 18 new people." If a sync fails, say so.

### 3.2 The contact record

Straight from your Notion list, plus what the sheet you already built by hand needs:

- First name, last name
- Email (plus alternates — people change jobs)
- Phone
- Company + role/title
- **One line on what they do** — short and precise, as you wrote
- How you know them / where they came from (link back to the source thread)
- Tags (`växjö`, `LNU`, `recruiter`, `client`)
- Free-text notes
- **Everything editable by hand, everywhere.** Any AI-written field shows an "edited by you" state and stops being overwritten once you touch it.
- **Manual add** — a contact that never came from an email at all.

### 3.3 Whose turn is it — the actual killer feature

- Computed from the last message direction in the thread: **Your turn / Their turn / No open thread**.
- Costs nothing, uses no AI, is never wrong, and is the single most useful thing in your Notion list.
- Sort the whole contact list by it. That view alone is worth building the app for.

### 3.4 Next touch

- **Next contact date + a reason** ("said to check back after the budget in October").
- Snooze, skip, mark done.
- **Promise and deadline detection** — the AI reads a thread and proposes "follow up after September 20" as a *suggested* date you confirm. Suggestion, never a silent calendar entry. _Still true after slice 10, which can write to the calendar: the writing happens when you fill in a form and press Create, never on its own._
- **Suggested dates when the emails give none** (added 2026-09-17, the user's request) — the AI names the kind of timing and why ("a referral: follow up soon"), and plain rules in code turn that into a date, skipping weekends. Same case, same date; the form still decides.
- **Referrals checked against your own mail** (added 2026-09-17) — "Martin referred you to Niklas Hedlund": the AI picks out the referral, and code — not the AI — checks whether you've written to Niklas since. Done → no touch; not done → "Contact Niklas Hedlund (Martin's referral)". Other contacts' mail is never sent to the AI for this. _Built early, 2026-09-17 (branch `referral-check`): a referral named in a summary is checked each time the contact page opens._
- Overdue list on the front page.

### 3.5 Relationship warmth

- A 0–100 score from signals only: reply rate, median response time, days since last contact, number of exchanges, whether they ever initiated.
- **The signals are always shown next to the score.** "Warm (72): replied 3 of 4 times, usually within a day, last contact 11 days ago."
- A score with no explanation is an opinion. A score with its inputs shown is a summary. Only build the second one.

### 3.6 The AI relationship summary

- Four things, as you specified: who they are, how you know them, what you discussed, what the next step is.
- **Stamped with a date** — "as of 8 Sep" — and a "regenerate" button.
- **Always editable.** Once you edit, it's yours, and the AI proposes changes as a diff rather than overwriting.
- **Links back to the source messages** so you can verify any claim in one click.
- Generated on demand or on new mail — not for all 400 contacts on signup (see cost, §5.4).

### 3.7 Duplicates

- Detect by email, by name + company, by phone.
- **Suggest a merge, show both records side by side, you press merge.** Never auto-merge — a wrong merge is destructive and near-impossible to undo.

### 3.8 Stalled conversations

- "You replied 24 days ago and they went quiet."
- "They asked you a question 6 days ago and you haven't answered." ← this one saves real relationships.

### 3.9 The weekly brief

- Monday morning: 5–8 people worth reconnecting with, each with one line of why, and a one-click "draft something".
- This is the retention feature. A personal CRM that you have to remember to open is a personal CRM you stop opening.

### 3.10 Drafting

- Generates the next email **into Gmail as a draft**, in the thread's language, using the thread history and your notes.
- Never sends. There is no send button anywhere in v1.
- A tone setting, because your outreach voice (student who programs a lot in his free time) is not the default LLM voice.

### 3.11 Web research on a contact

You asked for this one specifically, and it's the feature with the sharpest edges, so it gets rules:

- **On demand, one contact at a time.** A "research this person" button — never a background job over the whole list.
- **Public web search only.** No LinkedIn scraping, no data brokers (§4.1).
- **Every claim shows its source link.** A researched fact with no source is a rumour in a database.
- **It lands in a draft state you approve**, exactly like the import queue — because the failure mode here is confidently merging a different Martin Ryd into your contact.
- **It's dated**, like the summary, because "Head of Development at Fortnox" stops being true without warning.

This is what you were doing by hand when you built the Växjö sheet — including the part where you checked, doubted, and marked four people 🚩 _do not send blind_. The app should keep that instinct, not automate it away.

### 3.12 Privacy controls — a real feature, not a footer link

- A page that shows, in plain words, exactly what is stored about you and about the people in your list.
- Export everything as JSON/CSV.
- Delete one contact, delete all contacts, delete account — and it actually deletes.
- Per-contact opt-in body retention, with the retention period visible and a delete button.
- A real privacy policy written for humans.

**That's the MVP.** Fifteen items. It is already more than a sprint.

---

## 4. Functions that sound great and are bad

You asked specifically for this list. These are ordered by how tempting they are.

### 4.1 Never build these

| Feature | Why not |
|---|---|
| **Automatic sending of follow-ups** | A scheduler mailing a CEO on day 14 while you're in a lecture. One bad automated email to Tommy Eklund undoes the whole reason you built this. There is no version of this that is worth the risk, and you already decided against it — keep deciding against it when it gets tempting in month three. |
| **Open tracking / read receipts** | Wildly tempting for outreach ("did they read it?"). It is covert tracking of people who never consented, it needs consent under ePrivacy rules, tracking pixels hurt deliverability, and if a recipient finds out, you are the student who bugged their inbox. Hard no. |
| **LinkedIn scraping or auto-connect** | Against their terms, actively litigated, and they block hard. There is no profile API you can legitimately use for this. |
| **Data-broker enrichment** (Apollo/Hunter-style lookups) | The fastest way for an EU solo developer to end up processing personal data with no lawful basis. Commercial tools carry legal teams for exactly this. You don't. |
| **A full mailbox mirror** | You already ruled it out. Holding other people's private mail on a hobby server is the worst risk/reward in the project. |
| **AI judging "how it's going"** | You ruled this out too, correctly. "Seems uninterested" attached to a real named person is both likely wrong and something that person can legally demand to see. |
| **Sharing contact profiles with other users** | The moment two users can see each other's notes on the same person, you are running a people database, not a personal tool. Different product, different law. |

### 4.2 Not in v1 — right idea, wrong time

| Feature | Why it waits |
|---|---|
| **Chat with your inbox** | Demos beautifully, costs a lot, and answers confidently wrong. Build it when the boring parts are solid. |
| **Mobile app** | A responsive web app is enough. Native is weeks of work for zero portfolio gain. |
| **Team / shared workspaces** | Multiplies auth, permissions and legal complexity. Nobody asked. |
| **Calendar, Slack, WhatsApp, Notion integrations** | Each one is another OAuth flow, another consent screen, another thing to maintain. Calendar is the only one that earns its place later (§6). |
| **Enriching every contact on signup** | A batch job over 400 contacts on day one is a cost bomb and a privacy bomb at the same moment your user trusts you least. |
| **Import from other mail providers** | Outlook doubles the sync engine. Stay on Gmail until Gmail is finished. |
| **Bulk mass mailing** | The instant you can send 30 emails at once you are a cold-email tool, with all the spam and legal baggage that implies. |
| **Auto-merging duplicates** | Suggest yes, auto no. |

### 4.3 Things that will quietly hurt you

- **Notification nagging.** "You haven't contacted Martin in 40 days!" turns a useful tool into a guilt machine and gets muted in week two. One weekly brief. That's the budget.
- **A score you can't explain.** If you can't say why someone is a 34, don't show a 34.
- **Stale summaries.** A summary from March that reads as current is worse than no summary, because it's trusted. Hence the date stamp.
- **Fields nobody fills.** Every field you add to the contact form is one more thing that's empty and makes the record look broken. Your Notion list is already the right length. Resist adding to it.
- **Two half-finished list views.** The two-tier import means two lists to design, empty-state, paginate and search. It's the right call, but budget for it being twice the UI work you think.

---

## 5. Every negative part — the honest list

You asked for all of it. Here it is.

### 5.1 Google will be the hardest part, and it is not a coding problem

- `gmail.readonly` and the draft/compose scopes are **restricted scopes**. That is Google's highest tier.
- To publish an app using them to the general public, Google requires **OAuth verification plus an annual independent security assessment (CASA)**. That is a paid third-party audit, repeated every year, priced for companies and not for students.
- While the app stays in **Testing** publishing status, you get a limited number of manually-added test users — and, critically, **refresh tokens expire after about a week**, so testers have to reconnect Gmail repeatedly. That's fine for you. It is not fine for strangers.
- **Verify the current rules before you commit to anything** — Google changes these terms regularly, and the exact numbers today are not the numbers from last year.
- **What this means for your plan:** the "portfolio piece that works" answer is the right one, and it should be an explicit design decision, not an accident. Build it properly, run it for yourself and a handful of invited people in test mode, and *write up the production compliance path as part of the portfolio*. "Here is what it would cost to launch this, and here is why I didn't" is a more mature answer than a half-verified app.
- One more sharp edge: **the scope you need is set by the AI features, not by what you store.** Summarising a thread requires reading the body, so the metadata-only scope isn't available to you. Storing less is still worth doing — it just doesn't buy you a smaller permission.
- And: **the draft scope generally also permits sending.** You will be asking for the ability to send even though your app never will. Say that out loud on your own consent screen, because a careful user will notice.

### 5.2 GDPR, and you are in Sweden

This is the part most student projects ignore and the part that would most impress someone at Combitech if you get it right.

- Your database is full of **people who never signed up and never consented** — their names, employers, phone numbers, and an AI's description of them.
- With other people using it, **they are the data controller and you are the processor**. That means a data processing agreement, a records-of-processing obligation, and being contactable.
- **Article 14 problem**: when you collect personal data about someone from a source other than the person, you're generally required to inform them. Every commercial CRM leans on exemptions here, and it is genuinely contested ground. You should at minimum know the argument you're relying on.
- **A person in your database can demand a copy of what you hold on them, and demand deletion — from you.** Including the AI summary. Imagine "Martin Ryd" requesting his record and reading an AI paragraph about how promising he is as a job lead. Build the summary assuming it will one day be read by its subject. That's a good design constraint anyway.
- **Special categories leak in.** A thread mentions someone's sick leave, their politics, their union. Your summariser will faithfully include it. You need an instruction against it and you should expect it to fail sometimes.
- **Sub-processors.** Sending email content to an LLM provider is a transfer to a third party, probably in the US. It goes in the privacy policy by name, with a DPA, whether or not anyone reads it.
- **Retention.** "Optional opt-in body retention" is the right design, but a retention period that isn't actually enforced by a scheduled job is a lie in your privacy policy.

### 5.3 The AI will be wrong in specific, predictable ways

- **Signature parsing** breaks on Swedish characters, dual-language signatures, quoted replies, and legal disclaimers. Expect to hand-fix.
- **Name and identity collisions.** Two Anderssons at the same company, or a web search that merges the wrong Martin Ryd into your contact. Web research on a common Swedish name is a genuine accuracy problem.
- **Hallucinated facts about real people.** A confident wrong sentence about someone's role, stored in your database, quoted back in an email you send them. This is the single most embarrassing failure mode in the whole project.
- **Warmth scores misread reality.** No reply ≠ cold. People are on parental leave, in a hiring freeze, or just busy. A score that says "going cold, follow up" is a machine telling you to nag someone. Show the signals so a human can overrule it.
- **Swedish drafts.** LLM Swedish often reads as translated English — stiff, over-formal, slightly off. A mediocre Swedish email to a Swedish VD is worse than sending nothing, and you will not always hear about it. Review every draft; the draft-only design already forces this.
- **Promise detection misses negations.** "I *can't* get back to you before the 20th" and "get back to me after the 20th" produce the same date and opposite meanings.

### 5.4 Money and cost

- Summarising threads for one real mailbox costs real money, every sync, forever. With a few hundred contacts each generating summaries, per-user cost is not negligible — and the ICP you picked (researchers, networkers) has the biggest, messiest mailboxes.
- Web research per contact multiplies it again.
- **With zero revenue, every user costs you.** That is survivable at 5 users and not at 500. Another reason the portfolio framing is the honest one.
- Mitigations to design in from day one: generate summaries on demand rather than on sync, cache aggressively, cap per-user monthly spend, use a small model for extraction and a large one only for drafting.

### 5.5 Product risk

- **Gmail and Google Contacts already do maybe 60% of this for free**, and Gmail auto-collects addresses whether you like it or not. Your answer has to be the decision layer — whose turn, warmth, next touch — not the storage.
- **Personal CRM is a famous product graveyard.** People adore the idea, use it for three weeks, and abandon it when the data goes stale. Your auto-import is the right defence, and it's also what fills the database with junk. That tension never fully goes away.
- **The market is crowded** — Folk, Dex, Clay, Covve, Streak, and half of HubSpot. Not a reason to stop; a reason to be honest that the value here is what *you* learn and demonstrate.
- **"Everything professional" is a vague product.** You picked it, and it's fine for your own use, but it is the reason it'll be hard to explain to anyone else in one sentence. Keep the definition in §1 pinned to the wall.
- **The demo problem**: the best feature (whose turn is it) is invisible in a screenshot. Plan the demo around the review queue and the weekly brief, which look like something.

### 5.6 Personal risk

- **Your own job-search data is the test data.** If your hobby server leaks, it leaks the names, addresses and your private notes about exactly the CEOs you are trying to impress. Don't put your real outreach in it until auth and RLS are actually right.
- **Three unfinished projects.** DealFlow is paused, 1IK003 is running, you're a TA. A finished small thing beats three impressive half-things — and employers can tell the difference immediately.
- **"Sprint then slow down" has a specific failure mode**: the sprint ends at 80%, the slowdown never resumes, and the demo is forever almost-ready. Decide *now* what the stop-line is (§7), and treat everything past it as optional.
- **Scope creep is guaranteed** — your own answers already added six features to the AI list mid-conversation. That's not a criticism; it's evidence. Write the list down and make additions cost something.

---

## 6. Ideas worth adding — later

Ordered by how much they'd be worth.

1. **Email-address confidence badges — your own invention.** Your Växjö sheet already grades addresses ✅ published / 🟡 format-confirmed / 🚩 check first, and records the domain's format rule. No personal CRM does this. Guess an address from a proven company format, show the confidence, learn the format from addresses you've actually corresponded with, and downgrade on bounce. This is the most distinctive idea in your whole project and it came from you, not from the AI.
2. **Import a contact sheet.** Paste or upload a markdown/CSV list like `vaxjo-companies.md` and have it become contacts. Instantly makes the app useful on day one instead of after a month of syncing.
3. **Company view.** Group contacts by company, see everyone you know there, whose turn it is at that company as a whole. Your sheet is already organised this way.
4. **Calendar signal.** A meeting in the calendar is the strongest warmth signal that exists — far stronger than email. One extra scope, big accuracy win. Also lets suggested next-touch dates avoid full days and notice a meeting already booked with the person (the user's request, 2026-09-17). Page designed: `docs/calendar-and-profile.md`. _Scheduled as **slice 8** on 2026-09-20 — no longer "later"._
5. **Meeting notes → follow-ups.** You listed this and it's good; it needs a notes source to exist first, so it's a v2 feature that plugs into the promise-detection you already built.
6. **Intro paths.** "You want to reach X. You already talk to Y at the same company." Genuinely useful and uses only data you already have.
7. **Bounce handling.** Read bounce messages, mark the address invalid, surface the alternate. Cheap and it protects you from the 🟡 addresses.
8. **Timeline view per contact.** Every touch in order, with your notes inline.
9. **Snippets with variables.** Not full templates — just the three paragraphs you keep rewriting.
10. **Browser extension to add a contact from a page.** Nice, and a whole separate review process, so: much later.
11. **"About to go cold" nudge.** Warn *before* the relationship dies rather than after — but only inside the weekly brief, never as its own notification.
12. **Read your own public GitHub** — through GitHub's official API, which allows it: repository names, descriptions and languages as Profile facts you approve. Unlike LinkedIn, no scraping and no login needed. _(added 2026-09-17)_

---

## 7. Build order for the sprint

Each slice ends with something that works. Don't start the next one until the last one does.

**Slice 0 — set up (do this first, it's the long pole)**
Repo, Supabase project, Vercel deploy, and **the Google Cloud project + OAuth consent screen**. Get the scopes approved for yourself as a test user before you write a line of product code. This is where projects like this die.

**Slice 1 — it syncs**
Sign in with Google, connect Gmail, pull 90 days of metadata, show a list of people with message counts. No AI. Deploy it. _You now have a real thing._

**Slice 2 — it has contacts**
Two-tier classification, the review queue, the contact record, manual add and edit.

**Slice 3 — it's useful** ← **demo checkpoint**
Whose turn it is, next-touch date, warmth score with its signals shown. Still no AI.

> Stop here and look at it. If it's useful to you at slice 3, the project is a success and everything after is upside. This is also the most interesting thing to say in an interview: _"the first version deliberately had no AI in it."_

**Slice 4 — the AI earns its place**
The relationship summary. Editable, dated, linked to source. One feature, done properly, with the cost controls.

**Slice 5 — drafting**
Generate into Gmail drafts, in the thread's language, with a tone setting.

**Slice 6 — the loop closes**
Weekly brief, promise/deadline detection across every thread (the referral check from a summary is already built, §3.4), stalled-conversation flags, duplicate merge.

**Slice 7 — the part that makes it a portfolio piece**
Privacy page, export, real deletion, the written-up compliance decision. Then record a 90-second demo.

**Slice 8 — the calendar** _(scheduled 2026-09-20; was idea 4 in §6)_
The strongest warmth signal there is, and the one thing the next-touch date rules were built for and never had. Split in two: **8a** the signal — a separate read-only Google Calendar connection, meetings with contacts counted toward warmth, dates that skip a day you are full and a person you are about to see; **8b** the page, from `design/Calendar.dc.html`. No AI anywhere in it. Plan: `docs/slice-8-plan.md`. _The read-only half of that was reversed by slice 10 on 2026-09-22: the app can create an event now, never with guests and never without a press._

**Slice 9 — what the first real test found** _(added 2026-09-21)_
The first end-to-end test by somebody who had not built the app, against the real mailbox. **9a** the logic: one answer to "who needs you" on every screen, auto-replies that are not people waiting, waiting-on-them touches that offer no draft. **9b** the interface: mobile navigation, the contact header, undo, the thread timeline, names, a real 404. Plans: `docs/slice-9a-plan.md`, `docs/slice-9b-plan.md`.

**Slice 10 — the calendar can be written to** _(decided 2026-09-22)_
Reverses slice 8's read-only calendar at the user's request: `calendar.events` on a re-consent, a Create event button on the calendar page and on a contact, **never with guests** — a guest list makes Google email an invitation, which is the app causing mail to reach a person. The read-only test narrows rather than disappearing, and every page that promises read-only in writing is corrected in the same slice. `docs/assistant-plan.md`, Slice A.

**Slice 11 — the Assistant** _(decided 2026-09-22)_
A workspace at `/assistant`: cards built from what the app already computes, a chat box underneath, and an AI that does the safe reversible things on its own and asks for a draft, an event or an expensive read. Replaces Your week and Promises in the sidebar and then deletes both pages. Behind one boolean, because it is what a **premium** plan would charge for. Amends the "every AI output waits for approval" rule deliberately, and says so. `docs/assistant-plan.md`, Slice B.

**Slice 11b — the Assistant everywhere** _(asked for 2026-09-23; after slice 11 merges)_
"I want it to be able to do anything I want on the website." Slice 11 gives it the five
reversible things, and cards for drafts, events, summaries, promise scans and better names.
What the site can do and the Assistant cannot yet, as of 2026-09-23 — each one a decision,
not a checkbox, because each touches a different rule:

- **Through a card you press** (fits the rules as they are): edit a contact's details
  (company, role, phone); add a contact; approve or edit a waiting summary; accept or dismiss
  a promise; add Seen once people as contacts, or dismiss them; snooze or finish a next touch;
  start a Gmail sync.
- **Needs your call first**: a merge card. AGENTS.md says "suggest only; a human approves" —
  a press is approval, but slice 11 promised the Assistant never merges, and a wrong merge is
  nearly impossible to undo (§3.7).
- **Never, whatever is asked**: sending mail, inviting guests, deleting contacts or the
  account, the privacy page's export and deletes, profile settings, connecting or
  disconnecting Gmail and Calendar. These are the hard rules and the settings a model should
  not be able to talk itself into.

Plan it the way slice 11 was: one tool at a time, each with its tier, its test, and the page
action it presses through.

**Slice 12 — web research** _(added 2026-09-17; was slice 8, then 9)_
§3.11 as written: a "research this person" button, one contact at a time, public web search only, every fact with its source link, dated, pending until approved. Never LinkedIn, never data brokers. Behind a **per-user setting**, so a paid plan can switch it on later without rebuilding it. Can also feed drafts and summaries — still one click, still sources.

**Slice 13 — release, with plans** _(added 2026-09-17; was slice 9, then 10; only if the project goes public)_
What letting strangers sign in with Gmail actually takes:
- **Google OAuth verification and the yearly CASA security assessment** for restricted Gmail scopes (§5.1) — the biggest cost and the reason the app is in testing mode today.
- **Plans**: for example Free (sync, whose turn, warmth, next touch), Pro (AI summaries and drafts, a higher monthly cap), Premium (web research). The monthly AI cap and the per-user settings already built are what plans switch.
- **Payments** (e.g. Stripe), receipts and VAT.
- **GDPR as a processor** for every customer: a data processing agreement, sub-processor list (OpenAI, Supabase, Vercel, Google), a real privacy policy — slice 7's work, made public.
- Pricing that covers AI cost per user (§5.4) with margin.

_Built 2026-09-24/25 (`docs/slice-13-plan.md`), in Stripe's test mode: Free with a small
monthly AI allowance, Pro 49 kr and Premium 99 kr; Stripe as the seller (Managed Payments),
so VAT and the right of withdrawal are Stripe's; the public terms, privacy policy and
sub-processors, marked as drafts; and a deletion that ends everything it started. What is
left is not code — a business, a domain, a lawyer's read, Google's assessment, Stripe's live
mode — and is `docs/release.md`, in order, with costs. The app stays in testing mode until
it is done._

---

## 8. Still open

- **The name.** "Keep Contacts Together" is a description, not a name. It needs one before the demo.
- **How far back to sync by default** — 12 months is a guess; your own mailbox will tell you.
- **Which model for which job** — small for extraction, large for drafting, and a hard monthly cap.
- **Whether to use your own real outreach as the test data**, and when. Recommendation: not until slice 7's privacy work is done.
- **Paid plans** — which features in which plan, and prices. Decided in slice 9, if the release happens; cost per user (§5.4) sets the floor.
- **Whether any of this should feed back into DealFlow.** Keeping them separate is the right call for your data, but the two-tier import and the whose-turn logic are genuinely reusable ideas.
