# Decisions

_What was decided, and why. Revise when a decision turns out wrong — the history of changing your mind is more interesting than getting it right first time._

## Principles

1. **It has to work with the AI switched off.** The first working version deliberately had none in it. Whose-turn, warmth and next-touch are plain computation. AI was added afterwards, only where it earned its place.
2. **Nothing about a person is written without a way to check it.** Every AI output is dated, editable, and links back to the message it came from.
3. **A human approves anything that touches another human.** Imports, merges, follow-up dates, drafts — all through a queue.
4. **Write every summary assuming its subject will read it.** Under GDPR they can ask for it. It's also just a good constraint.
5. **Store less.** Every field not stored is a field that can't leak.

## The decisions

| Question | Decision | Why |
|---|---|---|
| Ambition | A portfolio piece that works — and, since 2026-09-17, released later with paid plans | The compliance cost (Google verification, CASA, GDPR as processor) only makes sense with revenue. First the portfolio; the release is slice 9, and features are built so plans can switch them (per-user settings, the monthly AI cap) |
| LinkedIn in drafts | Never read by the app; upload LinkedIn's own PDF export instead | LinkedIn forbids automated access and would need your login, risking your account. Its export is yours to upload, and becomes facts you approve (slice 5b) |
| Audience | Researchers and networkers, with the author as user zero | Real problem, underserved, not the crowded sales-CRM market |
| Gmail permissions | Read + create drafts | Never sends on its own — a bad automated email to a CEO undoes the whole project |
| Contact scope | Everything professional | Matches how a mailbox actually works |
| Import | Two tiers | Auto-import would fill the list with junk; a pure review queue is too much work |
| Email storage | Metadata + editable summaries | Bodies stay in Gmail; optional opt-in retention per contact |
| Progress model | Warmth from countable signals | Reply rate, response speed, recency, thread depth — never an AI opinion |
| Stack | Next.js + Supabase + Vercel | Fastest route to something hosted and real |
| Language | English UI, drafts in the thread's language | Swedish contacts get Swedish drafts |
| First sync reach | 90 days | Fast to test and enough to find who you actually talk to; easy to raise later |
| Gmail scope timing | Read-only from Slice 1, draft scope added in Slice 5 | Ask for the smallest permission the current code uses |
| Google API client | Plain `fetch`, no `googleapis` | Every OAuth request is visible and understood, not hidden in a library |
| Sync trigger | Scheduled, no button | A tool you have to remember to refresh is one you stop opening. Slice 1 uses a temporary button while the sync is built |
| AI provider | OpenAI, `gpt-5.6-luna` by default, through one module with plain `fetch` | Cheapest capable model for short summaries (about half a cent each at most). One file knows OpenAI, so switching provider is one file |
| AI spending | $2 a month per user, checked in the database before every request | Set before the first bill, not after. A reservation under a lock, so two clicks can't both slip under |
| When the AI runs | Only when you press Generate, one contact at a time | Cost, and sending mail to a third party should be a choice. A new contact asks; it doesn't run |
| AI summary input | Last 20 emails, quotes and signatures cut, 2,000 characters each | Recent enough to be right, small enough to stay cheap, and nothing credited to the wrong email |
| Drafting | The AI writes a reply into the app; you read, edit and press Save to Gmail drafts, then send from Gmail | `AGENTS.md`: nothing AI-generated goes straight into a Gmail draft. Two people are involved in every email that leaves — the AI writes, a human approves |
| Draft model | `gpt-5-mini` (`LLM_MODEL_GOOD`), bigger than the summary model | Drafts are read by another person, and small models write stiff, translated-sounding Swedish (`plan.md` §5.3). About a cent per draft |
| What drafting knows about you | Your Profile page, your notes on the contact, and the approved summary — nothing else | One page to see, edit and delete. No mail from other contacts, and nothing fetched from a link |
| Draft replies only | A reply in the contact's latest thread, never a new email | It lands in the right conversation, with In-Reply-To and References. New emails wait until there's a reason for them |
| AI suggestions | Company, role and next touch suggested with the summary, each taken with one click | Useful straight away, but nothing AI-made reaches the contact without a person pressing its button. Dates only when the emails give one |

## Trade-offs accepted

**Two-tier import doubles the UI.** Two lists to design, empty-state, paginate and search. Accepted because the alternatives are worse: auto-importing everything produces thousands of dead contacts, and reviewing everyone by hand is the manual work the tool exists to remove.

**Metadata-only storage limits search.** No full-text search across message bodies, and summaries can be incomplete or wrong with no original stored to check against. Accepted in exchange for a much smaller privacy and cost footprint — and mitigated by every summary linking back to its source in Gmail.

**Warmth scores will sometimes be wrong.** No reply doesn't mean cold; people are busy, on leave, or in a hiring freeze. Mitigated by showing the signals next to the score so a human can overrule it, rather than presenting a number as a verdict.

**The audience is vague.** "Everything professional" is harder to explain in one sentence than a narrow tool would be. Accepted because the author is user zero and a narrower scope wouldn't match how a real mailbox works.

## Deliberately not built

Automatic sending · open tracking and read receipts · LinkedIn scraping · data-broker enrichment · full mailbox mirror · AI judgement of how a relationship is going · auto-merging duplicates · sharing contact profiles between users.

Reasons for each are in the README table and in [`plan.md`](plan.md).

## Later, not now

Chat with your inbox · mobile app · teams and shared workspaces · calendar, Slack and Notion integrations · other mail providers · bulk enrichment on signup · bulk sending.

## Open

- The name.
- The larger model for drafting (`LLM_MODEL_GOOD`), in slice 5.
- Whether the two-tier import and whose-turn logic are worth reusing elsewhere.
