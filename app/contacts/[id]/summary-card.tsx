"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MAX_PART_CHARS, SUMMARY_PARTS, type SavedSummary, type SummaryPart } from "@/lib/ai/summary-parts";
import {
  approveSummaryAction,
  discardSummaryAction,
  editSummaryAction,
  generateSummaryAction,
  type EditSummaryState,
  type GenerateState,
} from "./summary-actions";

/**
 * The AI relationship summary on a contact's page (plan.md §3.6;
 * docs/slice-4-plan.md, Parts 4 and 6).
 *
 * No design has it — every design is slices 1–3 (design/canvas.json) — so it
 * is built from ContactDetail.dc.html's own cards: the white card and 14.5px
 * heading of "Your notes", the small uppercase labels of the stat strip, the
 * grey pill buttons of "Next touch", and ReviewQueue's blue "from them" pill
 * for the AI label.
 *
 * Its states:
 *   nothing yet        what it is, and Generate
 *   pending only       the AI's version, with Approve and Discard
 *   approved           the four parts, sources, Edit and Regenerate
 *   approved + pending the two side by side: keep yours, or use the new one
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const LABEL = "text-[10px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

const GHOST =
  "rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:cursor-default disabled:opacity-60";

const SOLID =
  "rounded-full bg-ink-deep px-[15px] py-1.5 text-[12px] font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-60";

const PART_LABELS: Record<SummaryPart, string> = {
  who_they_are: "Who they are",
  how_you_know: "How you know them",
  discussed: "What you've discussed",
  next_step: "Next step",
};

export type AiBudget = {
  spentUsd: number;
  capUsd: number;
  /** False when the server has no OpenAI key. */
  ready: boolean;
};

export function SummaryCard({
  contactId,
  approved,
  pending,
  hasMail,
  budget,
  gmailEmail,
}: {
  contactId: string;
  approved: SavedSummary | null;
  pending: SavedSummary | null;
  hasMail: boolean;
  budget: AiBudget;
  gmailEmail: string | null;
}) {
  const [generateState, generate, generating] = useActionState<GenerateState>(
    generateSummaryAction.bind(null, contactId),
    null,
  );

  // A cent is more than any one summary costs (lib/ai/models.ts); below that,
  // the database would refuse the reservation anyway.
  const budgetLeft = budget.capUsd - budget.spentUsd >= 0.01;
  const canGenerate = hasMail && budget.ready && budgetLeft && !generating;
  const whyNot = !budget.ready
    ? "The AI isn't set up on this server."
    : !hasMail
      ? "Needs mail with this contact."
      : !budgetLeft
        ? `This month's AI budget is used up ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}).`
        : null;

  const generateButton = (
    <form action={generate}>
      <button type="submit" disabled={!canGenerate} className={approved || pending ? GHOST : SOLID}>
        {generating ? "Reading your mail…" : approved || pending ? "Regenerate" : "Generate summary"}
      </button>
    </form>
  );

  return (
    <section className={`${CARD} flex flex-col gap-4 px-[22px] py-[18px]`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Relationship summary</h2>
            <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10.5px] font-semibold text-info-ink">AI</span>
          </div>
          {approved && <Stamp summary={approved} />}
        </div>
        <div className="flex flex-col items-end gap-1">
          {generateButton}
          <span className="text-[11px] font-medium text-ink-faint">
            {whyNot ?? `AI budget: $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)} this month`}
          </span>
        </div>
      </div>

      {generateState?.error && (
        <p role="alert" className="rounded-[12px] bg-accent-tint px-4 py-2.5 text-[12.5px] leading-[1.5] text-accent-dark">
          {generateState.error}
        </p>
      )}

      {!approved && !pending && (
        <p className="max-w-[640px] text-[13px] leading-[1.55] text-ink-soft">
          Who they are, how you know them, what you&rsquo;ve discussed and what&rsquo;s next — written
          by the AI from your last 20 emails with them, each part linked to the emails it came from.
          Nothing is added to the contact until you approve it. The email text is read for this one
          request and not stored.
        </p>
      )}

      {pending && approved && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-[14px] border border-line px-4 py-3.5">
            <span className={LABEL}>Current{approved.edited ? " · edited by you" : ""}</span>
            <Parts summary={approved} gmailEmail={gmailEmail} />
            <form className="mt-auto">
              <PendingButton formAction={discardSummaryAction.bind(null, pending.id)} className={GHOST}>
                Keep this one
              </PendingButton>
            </form>
          </div>
          <Proposal summary={pending} gmailEmail={gmailEmail} approveLabel="Use the new one" />
        </div>
      )}

      {pending && !approved && <Proposal summary={pending} gmailEmail={gmailEmail} approveLabel="Approve" />}

      {approved && !pending && <ApprovedSummary summary={approved} gmailEmail={gmailEmail} />}
    </section>
  );
}

/** "As of 12 Sep · approved" / "· edited by you". */
function Stamp({ summary }: { summary: SavedSummary }) {
  return (
    <span className="text-[11.5px] font-medium text-ink-faint">
      As of {shortDate(summary.as_of)} · {summary.edited ? "edited by you" : "approved"}
    </span>
  );
}

/** A pending AI version: tinted, with the choice to take it or not. */
function Proposal({
  summary,
  gmailEmail,
  approveLabel,
}: {
  summary: SavedSummary;
  gmailEmail: string | null;
  approveLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-info-tint/60 px-4 py-3.5">
      <span className="text-[10px] font-bold tracking-[0.07em] text-info-ink uppercase">
        New AI version · as of {shortDate(summary.as_of)} · waiting for you
      </span>
      <Parts summary={summary} gmailEmail={gmailEmail} />
      <p className="text-[11.5px] leading-[1.5] text-ink-muted">
        Check it against the sources before approving — the AI can be wrong about people.
      </p>
      <form className="mt-auto flex flex-wrap gap-[7px]">
        <PendingButton formAction={approveSummaryAction.bind(null, summary.id)} className={SOLID}>
          {approveLabel}
        </PendingButton>
        <PendingButton formAction={discardSummaryAction.bind(null, summary.id)} className={GHOST}>
          Discard
        </PendingButton>
      </form>
    </div>
  );
}

function ApprovedSummary({ summary, gmailEmail }: { summary: SavedSummary; gmailEmail: string | null }) {
  const [state, save, saving] = useActionState<EditSummaryState, FormData>(
    editSummaryAction.bind(null, summary.id),
    null,
  );

  // Open while `openedAt` equals the saves so far; a successful save closes it.
  const saves = state?.saved ?? 0;
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const editing = openedAt === saves;

  if (!editing) {
    return (
      <>
        <Parts summary={summary} gmailEmail={gmailEmail} />
        <div>
          <button type="button" onClick={() => setOpenedAt(saves)} className={GHOST}>
            Edit
          </button>
        </div>
      </>
    );
  }

  const errors = state?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form action={save} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {SUMMARY_PARTS.map((part) => (
          <div key={part} className="flex flex-col gap-1.5">
            <label htmlFor={`summary-${part}`} className={LABEL}>
              {PART_LABELS[part]}
            </label>
            <textarea
              id={`summary-${part}`}
              name={part}
              rows={3}
              maxLength={MAX_PART_CHARS}
              defaultValue={hasErrors && state ? state.values[part] : (summary[part] ?? "")}
              aria-invalid={errors[part] ? true : undefined}
              className="w-full resize-y rounded-[11px] border border-line-strong bg-white px-3 py-2 text-[13.5px] leading-[1.55] text-ink outline-none transition focus:border-ink-faint focus:ring-2 focus:ring-ink/10 aria-invalid:border-accent"
            />
            {errors[part] && (
              <p role="alert" className="text-[12px] font-medium text-accent">
                {errors[part]}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-muted">
        Saved summaries are marked &ldquo;edited by you&rdquo;. A new AI version never replaces them on its own.
      </p>
      <div className="flex flex-wrap gap-[7px]">
        <button type="submit" disabled={saving} className={SOLID}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={saving} onClick={() => setOpenedAt(null)} className={GHOST}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The four parts, each with links to the emails it came from. */
function Parts({ summary, gmailEmail }: { summary: SavedSummary; gmailEmail: string | null }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {SUMMARY_PARTS.map((part) => {
        const text = summary[part];
        const sources = summary.sources[part] ?? [];
        return (
          <div key={part} className="flex min-w-0 flex-col gap-1">
            <dt className={LABEL}>{PART_LABELS[part]}</dt>
            <dd className="flex flex-col gap-1">
              {text ? (
                <span className="text-[13.5px] leading-[1.55] break-words whitespace-pre-line text-ink-body">{text}</span>
              ) : (
                <span className="text-[13px] leading-[1.55] text-ink-hush">Not in these emails</span>
              )}
              {text && sources.length > 0 && (
                <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink-faint">
                  Sources:
                  {sources.map((source, index) => (
                    <a
                      key={source.messageId}
                      href={gmailLink(source.messageId, gmailEmail)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
                    >
                      email {index + 1}
                    </a>
                  ))}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A pill that submits its form to one bound Server Action. No `name`: React
 * reserves it for buttons whose formAction is a function. Disabled while the
 * form is on its way, so nothing is sent twice.
 */
function PendingButton({
  formAction,
  className,
  children,
}: {
  formAction: () => Promise<void>;
  className: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} disabled={pending} className={className}>
      {children}
    </button>
  );
}

/** Opens the message in Gmail, in the connected account when there is one. */
function gmailLink(messageId: string, gmailEmail: string | null): string {
  return gmailEmail
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailEmail)}#all/${messageId}`
    : `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

/** "12 Sep", in Swedish time. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Stockholm" }).format(
    new Date(iso),
  );
}
