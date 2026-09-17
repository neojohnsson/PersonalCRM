# Slice 4 — the AI earns its place

_Draft plan, 2026-09-17. Correct it before any code gets written._

**Goal** (from `plan.md` §7): the relationship summary. "Editable, dated, linked to
source. One feature, done properly, with the cost controls." The first AI in the app —
everything before it keeps working with the AI switched off.

**Done when** a test proves it — not when it renders:

- [ ] Two-user RLS tests pass for every new table and function
- [ ] Email text tests pass: the readable text is found in a Gmail message, quoted
      replies and signatures are cut, and nothing from a body is ever written to the
      database
- [ ] Summary tests pass, with a fake OpenAI: a claim citing a message that wasn't sent
      is thrown out; the result lands as **pending**; approve, edit, reject and
      regenerate do what Part 4 says
- [ ] Cap tests pass: at the monthly cap, no request reaches OpenAI — and two presses
      at once can't both slip under it
- [ ] On the Vercel preview with a real mailbox: a contact gets a summary, every part
      opens its source in Gmail, and approving, editing and regenerating work

**Who writes what** (`AGENTS.md`): Claude writes the code, explained before and walked
through after. Most depth goes to **what is sent to OpenAI and what is kept**, the
**spending cap**, and the **RLS policies** on the new tables.

---

## Part 1 — What gets sent, and what is kept (`plan.md` §3.6, §5.2)

The app stores no message bodies (`AGENTS.md`). A summary needs them, so:

1. You press **Generate** on a contact.
2. The server reads the **last 20 messages** with them from Gmail (decision B) — the
   ones the sync already knows about.
3. From each, it keeps the plain text, **cuts quoted replies and signatures**, and trims
   long messages.
4. That text goes to OpenAI with the instructions in Part 3.
5. **Only the summary is saved.** The email text lives in memory for that one request:
   never written to the database, never logged.

The provider is named in `docs/privacy.md` as a sub-processor (`plan.md` §5.2).

## Part 2 — The spending cap (`plan.md` §5.4)

- **$2 a month to start** (decision C). It's the setting `LLM_MONTHLY_CAP_USD`, already in
  `.env.example` — raising it is a change in Vercel, not in code.
- Before each request, the server **reserves** the most that request could cost. If this
  month's spend plus the reservation would pass the cap, **no request is sent**, and the
  button says the cap is reached until the 1st.
- After the answer, the reservation is replaced by the real cost, worked out from the
  token counts OpenAI returns and the model's price, kept as constants in one file.
- The reserve step runs in one database function that locks the user's row, so two
  presses at once can't both squeeze under the cap.
- Every request is recorded (`ai_usage`: model, tokens, cost, when) — the number the cap
  is checked against, and a record you can read.

## Part 3 — The summary (`plan.md` §3.6)

**Four parts**, as the plan specifies: who they are · how you know them · what you've
discussed · the next step.

**Rules given to the model**, and checked in code where code can check them:

- Only what the messages say. Unknown → "Not in these messages", not a guess.
- **Every statement cites the messages it came from.** Code throws out any citation to a
  message that wasn't sent, and a statement left with none.
- No health, politics, religion, union membership, sexuality or other sensitive details
  (`plan.md` §5.2). Written as if the person will read it — under GDPR they can.
- English (the UI language); names and quotes stay as written.
- The answer comes back as structured JSON, checked against a schema before anything is
  saved.

**Dated**: "as of 12 Sep" = the newest message it read.

## Part 4 — Pending, approve, edit, regenerate (`AGENTS.md` hard rules)

| Action | What happens |
|---|---|
| **Generate** | A new summary lands as **pending**: shown on the contact page with Approve and Discard, not yet part of the record |
| **Approve** | It becomes the contact's summary |
| **Discard** | It's deleted |
| **Edit** | The approved summary changes to your words and is marked "edited by you". Source links stay |
| **Regenerate** | A new pending summary appears **side by side** with the current one (decision D). Keep yours, take the new one, or copy parts by hand. An edited summary is never overwritten |

At most one approved and one pending summary per contact, enforced by the database.

## Part 5 — Database

`0010_ai_summaries.sql`:

- `contact_summaries` — `user_id`, `contact_id` (composite foreign key, as for next
  touches), `status` pending/approved, the four parts, `sources` (message ids per part),
  `as_of`, `edited`, `model`, timestamps. Partial unique indexes: one pending and one
  approved per contact. Four RLS policies.
- `ai_usage` — `user_id`, `contact_id`, `model`, input and output tokens, `cost_usd`,
  `status` reserved/settled, `created_at`. RLS: select only for the user; writes go
  through the functions below.
- `reserve_ai_spend(p_user_id, p_estimate, p_cap)` and `settle_ai_spend(…)` — security
  invoker, `search_path = ''`, as in earlier migrations.

## Part 6 — Screen

No design has the summary yet — every design is slices 1–3 (`design/canvas.json`). So
the card is built from `ContactDetail.dc.html`'s own cards ("Your notes", "Next touch"):
white card, 14.5px heading, small uppercase labels for the four parts, grey pill buttons.
It sits on the contact page above "Your notes". Said so in a comment.

- A small "Sources" link under each part opens that message in Gmail.
- "As of 12 Sep · AI · approved" or "· edited by you".
- Pending: a tinted card with **Approve** and **Discard**.
- Cap reached: Generate is disabled and says why.

---

## Decisions

- **A. OpenAI, a cheap GPT model.** The user's choice, for cost. All calls go through one
  module (`lib/ai/`), called with plain `fetch` like the Google APIs, so every request is
  visible and switching provider changes one file. The exact model and its price are
  checked when building step 4. `ANTHROPIC_API_KEY` in `.env.example` becomes
  `OPENAI_API_KEY` — server-only.
- **B. The last 20 messages.** Recent enough to be right, small enough to stay cheap.
- **C. $2 a month to start**, raised by changing `LLM_MONTHLY_CAP_USD`.
- **D. Regenerate shows side by side**, not a word diff.
- **E. Generated only when you press the button.** Not on sync, not for every contact
  (`plan.md` §3.6, §5.4).

## Setup needed from the user

- An OpenAI API key, with a low spending limit set in OpenAI's own dashboard too — a
  second fence behind the app's cap.
- `OPENAI_API_KEY`, `LLM_MONTHLY_CAP_USD=2` and `LLM_MODEL_FAST` in `.env.local` and in
  Vercel (Preview and Production).
- Run migration `0010` in Supabase.
- The preview callback in Google Cloud:
  `https://personal-crm-git-slice-4-summary-newcus-projects.vercel.app/api/auth/google/callback`

## Not in this slice

Drafting (slice 5) · promise detection, weekly brief (slice 6) · web research
(`plan.md` §3.11) · summaries made automatically on new mail.

## Commit order

1. This plan
2. Migration `0010`: tables, functions, RLS — with two-user tests
3. Reading email text from Gmail: plain text, quotes and signatures cut, in memory only
4. The AI module: OpenAI request, cost from tokens, reserve and settle the cap
5. Generating a summary: the prompt, schema, citation check, saved as pending
6. Approve, discard, edit, regenerate
7. The summary card on the contact page
8. `privacy.md` and `decisions.md` updated
9. Preview check with a real mailbox, PR
