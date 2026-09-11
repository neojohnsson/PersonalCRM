# Architecture

_Draft. Expected to be wrong in places — revise it when reality disagrees._

## Shape

```
Gmail API ──▶ sync worker ──▶ Postgres (Supabase, row-level security)
                  │                    │
                  │                    ├──▶ contacts, threads, touches
                  │                    └──▶ summaries, suggestions (pending approval)
                  │
                  └──▶ LLM ──▶ summaries · promise detection · drafts
                                        │
                                        ▼
                              review queue ──▶ human approves ──▶ Gmail draft
```

Everything the LLM produces lands in a pending state. Nothing reaches a contact record or a Gmail draft without a person clicking approve.

## The three layers

**1. Sync engine.** Reads Gmail, decides who is a person, works out who wrote last. No AI involved. The hard, boring, valuable part.

**2. Contact record.** Facts, always hand-editable. Any AI-written field stops being overwritten once a human touches it.

**3. Decision layer.** Whose turn it is, warmth, next touch, who's going cold. This is what makes someone open the app on a Tuesday.

If the AI were switched off tomorrow, all three should still work. If they don't, it's a demo rather than a product.

## Two-tier import

- **Tier A — contacts.** At least one message from them *and* one from you. Imported automatically.
- **Tier B — seen once.** Everyone else. A separate pool, promotable in one click, never cluttering the main list.

Filters before either tier: no-reply addresses, `List-Unsubscribe` headers, automated domains, calendar invites, receipts, the user's own aliases.

## Security model

Supabase's anon key is public by design and is safe on its own — **the row-level security policies are the entire security model**. Every table carries a user id and a policy that scopes reads and writes to the authenticated user.

The test that matters: two accounts, and one must not be able to read the other's rows. That test gets written before the feature it protects.

`SUPABASE_SERVICE_ROLE_KEY` bypasses every policy. Server-side only, never behind `NEXT_PUBLIC_`, never imported into a client component.

Gmail refresh tokens are long-lived keys to someone's mailbox, so they're encrypted at rest rather than stored as plain text.

## Google Cloud setup

Do this before writing product code — it's the long pole and it blocks everything else.

1. Google Cloud console → new project → enable the **Gmail API**
2. **OAuth consent screen** → External → publishing status stays **Testing**
3. Add yourself under **Test users** — nobody can sign in until they're on that list
4. **Credentials** → OAuth client ID → Web application
5. Authorised redirect URI: `http://localhost:3000/api/auth/google/callback` — must match `GOOGLE_REDIRECT_URI` character for character. A mismatch is the most common OAuth error there is.
6. Copy the client ID and secret into `.env.local`

Note: Next.js 16 has breaking changes relative to most training data. Check `node_modules/next/dist/docs/` rather than assuming App Router conventions.

## Cost control

Summarising threads costs money per user, per sync, forever, and the intended audience has large messy mailboxes. Designed in from the start:

- Summaries generated on demand, not for every contact on signup
- Small model for extraction and classification, larger one only for drafting
- Aggressive caching — a thread that hasn't changed doesn't get re-summarised
- A hard monthly spend cap enforced in code before every call

A runaway sync loop over a large mailbox is a real and expensive failure mode.
