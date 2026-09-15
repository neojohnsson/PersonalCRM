# Slice 1 — it syncs

_Draft plan. Correct it before any code gets written._

**Goal** (from `plan.md` §7): sign in with Google, connect Gmail, pull recent
message metadata, show a list of people with message counts. No AI. Deployed.

**Done when** a test proves it — not when it renders:

- [ ] Two-user RLS tests pass for every new table and view
- [ ] Sync state machine tests pass against fake Gmail responses
- [ ] Header-parsing tests pass (including Swedish names)
- [ ] On the Vercel URL: sign in → connect Gmail → sync → the list shows real people

**Who writes what** (from `AGENTS.md`):

Parts 1–2, the RLS policies for `0001` and `0002`, and token refresh were written by
hand. **From 2026-09-15 on, Claude writes the code and you review it**: every piece is
explained first — what it does and why — and nothing is committed until you've
understood and approved it. The security-critical pieces (the sync state machine, and
later the warmth calculation) get the most explanation, not less.

---

## Part 1 — Sign in

Supabase Auth with Google. This consent is only "who are you" — **no Gmail scopes**.

| File | What it does | Who |
|---|---|---|
| `app/login/sign-in-button.tsx` | `signInWithOAuth({ provider: "google", redirectTo })` | You |
| `app/auth/callback/route.ts` | Swaps Google's one-time `code` for a session cookie (`exchangeCodeForSession`) | You |
| `proxy.ts` | Runs before every request; refreshes the Supabase session cookie via `getClaims()` | You |
| `lib/auth.ts` | `requireUser()` — the real auth check, called by every protected page and route | You |
| Sign-out button | `supabase.auth.signOut()` | Me |
| `app/page.tsx` | Replace the Next.js starter page; redirect to `/login` if signed out | Me |

Two rules from the docs:

- **`proxy.ts` is not the security check.** Next.js 16's own docs: Proxy is for
  "optimistic checks … it should not be used as a full session management or
  authorization solution." The real check is `requireUser()` inside each page and route.
- **On the server, use `getClaims()`, never `getSession()`.** `getClaims()` verifies the
  token's signature; `getSession()` just trusts whatever the cookie says.

Before you write it, I'll explain: what PKCE is, why the `code` is swapped server-side,
and how the session ends up in a cookie.

**Checkpoint:** sign in and out works on localhost *and* the Vercel URL. Commit, push.

---

## Part 2 — Connect Gmail

A second, separate Google consent — this one for the mailbox. We run it ourselves
rather than through Supabase, because we need Google's **refresh token** stored
(encrypted) so the sync can call Gmail later without the user present.

| File | What it does | Who |
|---|---|---|
| `app/api/auth/google/route.ts` | Builds Google's consent URL and redirects to it | You |
| `app/api/auth/google/callback/route.ts` | Checks `state`, swaps `code` for tokens, encrypts the refresh token, saves `google_accounts` | You |
| `lib/google/tokens.ts` | `getAccessToken()` — decrypts the refresh token, asks Google for a fresh 1-hour access token | You |
| Disconnect | Revoke the token at Google, delete the row (`privacy.md`: disconnect without deleting data) | You (revoke), me (button) |
| `app/connect/page.tsx` | Already built. Change the link to a form `POST` (its own comment asks for this) | Me |

The parts that matter, which I'll explain before you write them:

- **`access_type=offline`** — without it Google gives no refresh token.
- **`prompt=consent`** — Google only sends the refresh token the *first* time unless you ask again.
- **`state`** — a random value in an httpOnly cookie, checked in the callback. Stops
  another site from finishing an OAuth flow in your user's browser (CSRF).
- **Check the granted scopes in the callback.** Google's consent screen lets the user
  untick the Gmail box. Don't assume they granted it.
- **`invalid_grant` on refresh** = the token is dead. In Testing mode that happens about
  weekly (`privacy.md`). Mark the account `needs_reconnect`; don't crash.
- **Writes use the signed-in user's Supabase client, so RLS applies.** No secret key needed
  anywhere in Slice 1.

**Checkpoint:** connect → a row in `google_accounts` with a `v1.…` encrypted token. Disconnect removes it.

---

## Part 3 — Sync

### New tables — `supabase/migrations/0002_gmail_sync.sql`

I write the `create table`s and the tests first; you write the policies, same as `0001`.

**`gmail_messages`** — one row per message, metadata only.

| Column | Why |
|---|---|
| `user_id` | RLS |
| `gmail_message_id`, `thread_id` | Unique per user; links back to Gmail |
| `internal_date` | When it happened |
| `from_email`, `from_name` | Who wrote it |
| `to_emails`, `cc_emails` | Who received it |
| `direction` | `inbound` or `outbound` — decided at sync time |
| `has_list_unsubscribe` | Captured now so Slice 2's bulk-sender filter doesn't need a re-sync |

Not stored: body, attachments, snippet — and, for now, subject (see decision 4).

**`gmail_sync_state`** — one row per user. Kept out of `google_accounts` so the
token table stays narrow.

| Column | Why |
|---|---|
| `status` | Where the state machine is (below) |
| `backfill_page_token` | Where to resume the first sync |
| `history_id` | Gmail's bookmark for "changes since" |
| `last_synced_at`, `last_error`, `message_count` | So the status bar doesn't lie |

**`people`** — a **view**, not a table: group messages by the other person's address →
message count, sent, received, last contact. Created `with (security_invoker = true)`.
Without that, a view runs with its owner's rights and **skips RLS** — Bob could read
Alice's people. The test proves it doesn't.

### The state machine — Claude writes, explained step by step

```
  not_connected ──connect──▶ ready ──sync now──▶ backfilling ⟲ one page per step
                                                     │
                                          last page  ▼
                               ┌─────────────── synced ◀─────┐
                    sync now   ▼                              │
                          incremental ⟲ history pages ────────┘
                               │
             history too old ──┴──▶ backfilling (start over)

  any state ── invalid_grant ──▶ needs_reconnect ──reconnect──▶ ready
  any state ── other error ────▶ error (shown in the UI, retry allowed)
```

Why it looks like this:

- **Vercel stops a request after a time limit.** A few months of mail can be thousands
  of messages, so the sync can't be one request. It runs in **steps**: fetch one page of
  message ids, fetch their metadata, save, store the page token, return. The page calls
  the next step until done.
- **Save `history_id` *before* the backfill starts**, so mail that arrives during a long
  backfill is picked up by the next incremental sync.
- **Every step is safe to repeat.** Messages are upserted on `(user_id, gmail_message_id)`,
  so a retried step never double-counts.
- **Two tabs pressing "sync" at once** must not run two syncs — a step only starts if it
  can claim the row (conditional update on `status`).

**Gmail helpers — I write, with tests:** `messages.list` with an `after:` date filter,
`messages.get` with `format=metadata` (headers only: `From`, `To`, `Cc`, `Date`,
`List-Unsubscribe`), `history.list`, address parsing (`"Björn Ek" <b@x.se>`, quoted
commas, encoded names), direction detection (`from` = your own address → outbound).

**To verify against Google's docs when writing** (I couldn't fetch them this session):
the exact error when `history_id` is too old (expected: HTTP 404), and whether `metadata`
format returns already-decoded names.

**Checkpoint:** tests pass; syncing your own mailbox fills `gmail_messages`; re-running
changes nothing.

---

## Part 4 — The list

I build this, styled from `design/ContactList.dc.html`.

- `/` shows **people, sorted by last contact** — never A–Z (`AGENTS.md` core premise).
  Whose-turn comes in Slice 3.
- Each row: name, email, messages sent / received, last contact date.
- **Sync status bar:** "Last synced 4 minutes ago · 312 messages · 18 people", a progress
  line while backfilling, and a plain error with a reconnect button when it fails.
- Empty states: not connected → link to `/connect`; syncing → progress; nothing found.
- **It will be noisy.** No-reply senders and newsletters show up. Filtering them is Slice 2 —
  don't cross the boundary.

**Checkpoint:** works on the Vercel URL with your real mailbox. Open the PR.

---

## Commit order

1. `proxy.ts`, callback route, sign-in, sign-out, protected `/`
2. Migration `0002` tables + RLS tests → your policies → tests pass
3. Gmail connect + disconnect
4. Token refresh + Gmail helpers + parsing tests
5. Sync state machine + its tests
6. `people` view + list UI + status bar
7. Deploy, run on your mailbox, fix what breaks, PR

---

## Decisions (agreed 2026-09-13)

1. **Lookback: 90 days.** Rename `SYNC_DEFAULT_LOOKBACK_MONTHS=12` to
   `SYNC_DEFAULT_LOOKBACK_DAYS=90` in `.env.example`, `.env.local` and Vercel.
2. **Scope: `gmail.readonly` only.** The draft scope is added in Slice 5 via incremental
   authorisation. The `/connect` page copy about drafts gets reworded for now.
3. **Plain `fetch`**, no `googleapis` package.
4. **No subject line yet.** Added when a screen needs it.
5. **A "Sync now" button for Slice 1 — temporary.** The goal is a **scheduled sync with no
   button**. The button is scaffolding so the sync can be built and watched; it is removed
   when the schedule lands. See "Built for a schedule" below.
6. **You write `proxy.ts` and `requireUser()`**, with me explaining each line.
7. **Who counts as a person** (agreed 2026-09-15): on mail you receive, the sender; on
   mail you send, everyone in To **and** Cc. Someone in both on one message counts once.
   Other people Cc'd on mail you receive don't count — they aren't talking to you.

## Built for a schedule

The scheduled sync isn't built in Slice 1, but Slice 1 must not make it hard. Three rules:

- **The sync step is a plain function**, `runSyncStep(db, userId)`, not code inside a page
  or a button handler. The button calls it now; a scheduler calls the same function later.
- **It never reads the browser session.** It gets the user id passed in. A scheduled run
  has no signed-in user and no cookies.
- **Know the cost of that:** with no signed-in user, the scheduler has to use
  `SUPABASE_SECRET_KEY`, which **bypasses RLS**. So the scheduled route must (a) only accept
  requests carrying `CRON_SECRET`, and (b) scope every query by `user_id` itself, because
  the database no longer does it. This is the one place the security model changes — it
  gets its own tests when it's built.

Open question for then: **where the schedule runs.** Vercel Cron on the Hobby plan has
been limited to about once a day, which is too slow for "who's waiting on you". Check
current limits; alternatives are Supabase Cron (`pg_cron`) calling the route, or a
scheduled GitHub Action.

## Risks

- **Vercel time limit** — handled by the step design; test with a big mailbox early.
- **Testing-mode tokens expire weekly** — the `needs_reconnect` state exists for this.
- **Your real mailbox is the test data** — metadata only, and RLS is tested, but it's still
  real people. `plan.md` §5.6.
- **Redirect URLs** — sign-in returns to `/auth/callback`, which the `localhost:3000/**` and
  Vercel `/**` entries in Supabase already cover.
