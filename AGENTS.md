<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Personal CRM

A personal CRM that imports contacts from Gmail and tells you who's waiting on you.

Full plan, slices and risks: `docs/plan.md`. Read it before starting a slice.
Architecture: `docs/architecture.md`. Decisions and their reasons: `docs/decisions.md`.

## Core premise

- The product is the *timing*, not the storage. The default view answers
  "who needs me today" — never "here are your contacts, A-Z".
- It must be useful with the AI switched off. Whose-turn, warmth and
  next-touch are plain computation, no LLM involved.

## Hard rules — do not violate

- **No send capability.** Drafts are written to Gmail and a human presses send.
  No send endpoint, no send button, no scheduled send. Ever.
- **No auto-merge** of duplicate contacts. Suggest only; a human approves.
- **No open tracking, read receipts or tracking pixels.**
- **No LinkedIn scraping, no data-broker enrichment.**
- **Message bodies are not stored by default.** Metadata + editable summaries
  only. Body retention is per-contact opt-in with a visible retention period.
- `SUPABASE_SECRET_KEY` is server-only. Never in a client component,
  never behind a `NEXT_PUBLIC_` prefix.
- Every AI output lands in a pending state a human approves. Nothing
  AI-generated writes straight to a contact record or a Gmail draft.
  **One narrow exception** (amended 2026-09-23, `docs/slice-11-plan.md` §2), plus
  explicitly requested contact creation (amended 2026-09-25):
  the Assistant may do five reversible things on its own — a note, tags, a
  next touch, marking a conversation done, reminders on or off — because each
  is one row or one column, is logged with what it was before, and can be
  undone from the page. When the user explicitly supplies enough details and
  asks for it, the Assistant may also create a new contact; that creation is
  logged with a snapshot and can be undone only while unchanged. Nothing
  AI-generated writes a Gmail draft or a
  calendar event without a press.
- Every AI output about a person is dated, editable, and links to its source.

## Design

- **Every screen is built from its design in `design/`** (`*.dc.html`, laid out
  in `design/canvas.json`). Match its layout, type sizes, colours, icons and
  spacing — the finished app has to look like the design, not merely be
  "styled from" it.
- Colours live as tokens in `app/globals.css`; add new ones there, taken
  from the design, rather than inventing values.
  **Themes** (added 2026-09-24, by the user): Paper is the design. Night and
  Studio are the user's own variations of it, switched from the header and
  kept in the browser. Every colour is a `--theme-*` token, so a new colour
  gets a Paper value from the design and a value in each theme; nothing is
  written into a class as a hex. `tests/styles.test.ts` parses the stylesheet
  and checks the themes cover the colours that carry a meaning.
- Differences only for honest reasons, each written in a comment where it
  happens: copy that would describe a feature the current slice doesn't
  have yet, real data instead of the mock names, and fitting phone widths.
- A screen with no design yet: reuse the patterns of the nearest designed
  screen, and say so.

## Stack

- Next.js (App Router) + TypeScript
- Supabase — Postgres with row-level security. The RLS policies ARE the
  security model; the publishable key is public by design.
- Tailwind + shadcn/ui
- Gmail API, OAuth 2.0, incremental sync via the History API

## How I work on this

- One slice per branch. Slices are in `docs/plan.md`. Don't cross boundaries.
- Plan before code. Show me the plan, let me correct it, then build.
- Small commits.
- **You write the code; I need to understand it.** Changed 2026-09-15 — the
  OAuth flow, token refresh and the first RLS policies were hand-written, and
  that stopped there. Before each piece: say what it does and why, in plain
  words. After: walk me through it. Nothing gets committed that I haven't
  understood.
- **Explain these in the most depth:** the sync state machine, RLS policies,
  anything touching OAuth tokens, the warmth calculation. These are the
  security model and the core logic — I must be able to explain them myself.
- I'm a first-year systems science student. Java and Spring Boot are familiar;
  React, TypeScript, OAuth and Postgres RLS are new. Explain the why, not just
  the what, in those areas.

## Testing

- A slice isn't done when it renders. It's done when a test proves it.
- RLS policies get tested with two users: one must not be able to see the
  other's data.
