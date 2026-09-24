# Slice 12 — web research on a contact

_plan.md §3.11 and the slice 12 entry, as decided on 2026-09-17._

A **Research this person** button: one contact at a time, public web only, every fact with the
link it came from, dated, and nothing on the contact until you approve it. The failure this
guards against is the one plan.md §5.3 names: confidently merging a different Martin Ryd into
your contact.

## 1. How it searches

OpenAI's built-in **`web_search`** tool in the Responses API we already use (checked against
OpenAI's docs 2026-09-23, not memory):

- **`blocked_domains`**, up to 100, subdomains included — so LinkedIn and the data brokers are
  refused by the search itself, not only by an instruction (§3).
- Sources come back two ways: inline `url_citation`s, and the full list of every URL consulted
  (`include: ["web_search_call.action.sources"]`). **A fact is kept only if its link is in that
  list** — checked by code, so a link the model invents is dropped.
- **`max_tool_calls: 5`**: at most five searches per press.
- Price: **$10 per 1,000 searches** plus what it reads at the model's token price. About
  3–8 cents a press. It is reserved before and settled after, on the ordinary AI budget line,
  and the button shows what it usually costs, as the Assistant's cards do.

What the model is given: the contact's name, company, role, their email's domain, and how you
know them. Not your notes, not your mail.

## 2. What comes back, and what is kept

The model answers in a fixed shape (structured output, like the summary):

- **Is it the same person?** `sure` / `likely` / `unsure`, and one sentence of why ("same
  name, and the Combitech page matches their email's domain"). `unsure` is shown in orange
  above everything else, the app's 🚩 _do not send blind_.
- **Up to 8 facts**, each one sentence, professional only, each with its link and the page's
  title.

Checked by code before anything is shown:

- a fact whose link was not among the consulted sources → dropped
- a link on a blocked domain → dropped (belt and braces with §1)
- longer than 240 characters → cut; more than 8 → the rest dropped

**Stored:** only those sentences, their links and titles, the identity line, when, and which
model. Never the pages themselves.

## 3. Never

- **LinkedIn**, and **data brokers and people-search sites**: Ratsit, Merinfo, MrKoll, Hitta,
  Eniro, Upplysning, Birthday.se, Spokeo, Whitepages, Pipl, ZoomInfo, Apollo, RocketReach,
  Lusha, ContactOut, SignalHire, Hunter — the `blocked_domains` list, pinned by a test.
- **Personal social media**: Facebook, Instagram, TikTok, X — mostly private life, so blocked
  the same way _(decided 2026-09-23)_.
- **Private life**: the instructions forbid home address, family, health, politics, religion,
  age or birthday, personal ID numbers, and money. plan.md §5.2's standard: write it as if the
  person will one day read it. You approve every fact, which is the real guard.
- **A background job.** One press, one contact.

## 4. Deciding

A new card on the contact page, **From the web**, reusing the summary card's pattern (the
nearest designed screen: tinted while waiting, dated, sources as links):

- waiting: the identity line, then each fact with its link, a tick box each — **Keep the
  ticked ones** / **Discard all** _(tick each fact, decided 2026-09-23: one wrong fact should
  not cost the right ones)_
- kept: a quiet list of facts, each with its link and "found 23 September", and a × to remove
  one. Researching again adds a new waiting set; it never overwrites what you kept.

## 5. The switch

Web research is **off unless your account has it** — `entitlements.research`, the same table
and the same rule as the Assistant (migration 0025): a read policy and no write policy, so
nobody can switch it on for themselves through the API. Off: no button, and the action
refuses.

## 6. The data

Migration 0026:

- `entitlements.research boolean not null default false`
- `contact_research`: id, user_id, contact_id (composite key, deleted with the contact),
  status `pending` / `kept`, identity (`sure` / `likely` / `unsure`), identity_why, facts
  (jsonb, each `{text, url, title}`), model, found_at, decided_at. One pending set per contact.
- RLS: select, insert, update, delete your own; two users tested.
- Counted on the privacy page, in both exports, gone with the contact and the account.

## 7. The Assistant

A `propose_research` card, like `propose_summary`: it offers, with the price, and your press
runs it; the facts still wait on the contact's page. Only for accounts that have both
_(wanted, decided 2026-09-23)_.

## Done when — a test proves it

- [x] A fact whose link was not among the sources is dropped, and so is one on a blocked domain
- [x] The blocked list holds LinkedIn and every broker named in §3, and a test fails if one goes
- [x] Nothing reaches the contact until you keep it; discarded facts are deleted, not kept
- [x] Two users: neither sees nor keeps the other's research
- [x] With research off, there is no button and the action refuses
- [x] The press is reserved and settled on the AI budget, searches included
- [x] Counted on the privacy page, in the exports, and deleted with the contact
- [x] Checked in the browser against the real search, at both widths — by eye and by
      measurement (2026-09-24): two real contacts researched, the card fits at 390px

## Commit order

1. This plan
2. Migration 0026 — tested with two users before any code uses it
3. The research itself: instructions, the search, the checks, the spend (tests with a fake model)
4. The From the web card: keep, discard, remove
5. Privacy page, exports — done in commit 2, when the privacy test failed on the new table
6. The Assistant's card
7. Browser check, PR
