"use client";

import { useActionState, useState, useTransition } from "react";
import type { Allowance } from "@/lib/plans/allowance";
import { useToast } from "@/app/toasts";
import { MAX_BODY_CHARS, TONES, neverWriteHits, type SavedDraft, type Tone } from "@/lib/ai/draft-types";
import { timeAgo } from "@/lib/format";
import {
  discardDraftAction,
  generateDraftAction,
  restoreDraftAction,
  saveDraftAction,
  type DraftState,
} from "./draft-actions";

/**
 * The draft reply panel on a contact's page (plan.md §3.10;
 * docs/slice-5a-plan.md, Parts 3 and 6).
 *
 * No design has it, so it is built from the summary card's pending state: the
 * same white card, blue "waiting for you" tint, grey pill buttons and budget
 * line. Its states:
 *
 *   nothing yet   what it does, and Draft reply
 *   pending       subject, language, the text to edit, tone switch, and
 *                 Save to Gmail drafts · Discard · Regenerate
 *   saved         when it was saved, and Open in Gmail
 *
 * Nothing here can send. The app has no send path at all (AGENTS.md).
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";
const LABEL = "text-[10px] font-bold tracking-[0.07em] text-ink-meta uppercase";
const GHOST =
  "rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:cursor-default disabled:opacity-60";
const SOLID =
  "rounded-full bg-ink-deep px-[15px] py-1.5 text-[12px] font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-60";

const TONE_LABELS: Record<Tone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  casual: "Casual",
  brief: "Brief",
};

export function DraftCard({
  contactId,
  draft,
  lastSaved,
  neverWrite,
  gmailDraftsUrl,
  canDraft,
  hasMail,
  budgetLeft,
  aiReady,
  drafts = null,
}: {
  contactId: string;
  /** The draft waiting for you, if any. */
  draft: SavedDraft | null;
  /** The most recent one already in Gmail, for the link. */
  lastSaved: SavedDraft | null;
  neverWrite: string[];
  gmailDraftsUrl: string;
  /** Gmail was connected with permission to create drafts. */
  canDraft: boolean;
  hasMail: boolean;
  budgetLeft: boolean;
  aiReady: boolean;
  /** Free's count of drafts this month (slice 13); null on a paid plan. */
  drafts?: Allowance | null;
}) {
  const [generateState, generate, generating] = useActionState<DraftState>(
    generateDraftAction.bind(null, contactId, null),
    null,
  );
  const [regenerateState, regenerate, regenerating] = useActionState<DraftState, FormData>(
    async (previous: DraftState, formData: FormData) => {
      const tone = formData.get("tone");
      return generateDraftAction(contactId, TONES.includes(tone as Tone) ? (tone as Tone) : null, previous);
    },
    null,
  );
  const [saveState, save, saving] = useActionState<DraftState, FormData>(
    draft ? saveDraftAction.bind(null, draft.id) : async () => ({ error: "That draft is gone." }),
    null,
  );

  // Starts from the draft this panel was rendered for; the page gives the
  // component a new key when the draft changes, so this is always in step.
  const [body, setBody] = useState(draft?.body ?? "");
  const busy = generating || regenerating || saving;
  const error = saveState?.error ?? regenerateState?.error ?? generateState?.error ?? null;

  const whyNot = !aiReady
    ? "The AI isn't set up on this server."
    : !canDraft
      ? "Reconnect Gmail to allow drafts."
      : !hasMail
        ? "Needs mail with this contact."
        : !budgetLeft
          ? drafts?.left === 0
            ? `You've used this month's ${drafts.allowed} free drafts.`
            : "This month's AI budget is used up."
          : null;

  const hits = neverWriteHits(body, neverWrite);

  return (
    <section id="draft" className={`${CARD} flex scroll-mt-4 flex-col gap-3.5 px-[22px] py-[18px]`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Draft reply</h2>
            <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10.5px] font-semibold text-info-ink">AI</span>
          </div>
          {lastSaved?.saved_at && !draft && (
            <span className="text-[11.5px] font-medium text-ink-soft">
              Saved to Gmail drafts {timeAgo(lastSaved.saved_at)}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {!draft && (
            <form action={generate}>
              <button type="submit" disabled={Boolean(whyNot) || busy} className={SOLID}>
                {generating ? "Writing…" : lastSaved ? "Draft another reply" : "Draft reply"}
              </button>
            </form>
          )}
          {whyNot ? (
            <span className="text-[11px] font-medium text-ink-soft">{whyNot}</span>
          ) : (
            !draft && (
              <span className="text-[11px] font-medium text-ink-soft">
                Reads your latest thread · costs about a cent
              </span>
            )
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[12px] bg-accent-tint px-4 py-2.5 text-[12.5px] leading-[1.5] text-accent-dark">
          {error}
        </p>
      )}

      {!draft ? (
        <p className="max-w-[640px] text-[13px] leading-[1.55] text-ink-soft">
          The AI writes a reply to your latest thread with them, in the thread&rsquo;s language and your
          tone from Profile. It appears here to read and edit. Nothing reaches Gmail until you press
          Save to Gmail drafts, and you press send in Gmail yourself.
          {lastSaved && (
            <>
              {" "}
              <a
                href={gmailDraftsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ink-body link-inline decoration-line-strong"
              >
                Open Gmail drafts
              </a>
            </>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] bg-info-tint/60 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className={`${LABEL} text-info-ink`}>Waiting for you · not in Gmail yet</span>
            <span className="text-[11.5px] font-medium text-ink-soft">
              {[draft.language, TONE_LABELS[draft.tone]].filter(Boolean).join(" · ")}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className={LABEL}>Subject</span>
            <span className="text-[13px] font-semibold break-words">{draft.subject ?? "Re:"}</span>
          </div>

          <form action={save} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="draft-body" className={LABEL}>
                The reply — edit it as you like
              </label>
              <textarea
                id="draft-body"
                name="body"
                rows={12}
                value={body}
                maxLength={MAX_BODY_CHARS}
                onChange={(event) => setBody(event.currentTarget.value)}
                className="w-full resize-y rounded-[11px] border border-line-strong bg-white px-3 py-2.5 text-[13.5px] leading-[1.6] text-ink transition focus:border-ink-soft"
              />
              <div className="flex justify-end text-[11.5px] tabular-nums text-ink-soft" aria-live="polite">
                {body.length.toLocaleString("en-GB")} / {MAX_BODY_CHARS.toLocaleString("en-GB")}
              </div>
            </div>

            {hits.length > 0 && (
              <p className="text-[11.5px] leading-[1.45] text-cooling">
                It used {hits.map((phrase) => `“${phrase}”`).join(", ")}, which your Profile says never to
                write.
              </p>
            )}

            <p className="text-[11.5px] leading-[1.45] text-ink-soft">
              Read it before saving — the AI can be wrong about people and about what was promised. It
              replies to {draft.subject ? "this thread" : "the latest thread"} and to this contact only;
              anyone else on the thread isn&rsquo;t added.
            </p>

            <div className="flex flex-wrap items-center gap-[7px]">
              <button type="submit" disabled={busy || !body.trim()} className={SOLID}>
                {saving ? "Saving to Gmail…" : "Save to Gmail drafts"}
              </button>
              {/* Slice 9b, Part 3: a draft cost money and a minute of waiting,
                  and this sits next to Save with nothing in between. It is
                  undoable now -- the row survives as `discarded` (migration
                  0024) and Undo sends back the text this box was showing,
                  because the row's own copy is cleared the moment you
                  press. */}
              <DiscardButton draftId={draft.id} body={body} disabled={busy} />
            </div>
          </form>

          <form action={regenerate} className="flex flex-wrap items-center gap-[7px] border-t border-line pt-3">
            <span className="text-[11.5px] font-medium text-ink-soft">Rewrite it as:</span>
            {TONES.map((tone) => (
              <button
                key={tone}
                type="submit"
                name="tone"
                value={tone}
                disabled={busy}
                className={`${GHOST} ${tone === draft.tone ? "ring-1 ring-ink/15 ring-inset" : ""}`}
              >
                {regenerating ? "…" : TONE_LABELS[tone]}
              </button>
            ))}
          </form>
        </div>
      )}
    </section>
  );
}

/**
 * Discard, with an Undo in the toast (slice 9b, Part 3).
 *
 * Outside the form on purpose: it is not a submit any more, so pressing it
 * cannot carry the textarea to Gmail by accident, and the text it needs for
 * the undo is the same `body` the box holds.
 */
function DiscardButton({
  draftId,
  body,
  disabled,
}: {
  draftId: string;
  body: string;
  disabled: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          await discardDraftAction(draftId);
          toast({
            message: "Draft discarded.",
            action: {
              label: "Undo",
              run: async () => {
                const state = await restoreDraftAction(draftId, body);
                if (state?.error) throw new Error(state.error);
              },
            },
          });
        })
      }
      className={GHOST}
    >
      {pending ? "Discarding…" : "Discard"}
    </button>
  );
}
