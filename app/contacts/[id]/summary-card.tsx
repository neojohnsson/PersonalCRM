"use client";

import { useActionState, useState } from "react";
import { allowanceLine, roomFor, type Allowance } from "@/lib/plans/allowance";
import { sourceNumbers } from "@/lib/ai/source-numbers";
import { useFormStatus } from "react-dom";
import {
  MAX_PART_CHARS,
  SUMMARY_PARTS,
  type SavedSummary,
  type SourceRef,
  type SummaryPart,
} from "@/lib/ai/summary-parts";
import type { ReferralStatus } from "@/lib/relationship/referral";

/** One referred person, what your own mail says about them, and their own next touch. */
export type ReferredStatus = { name: string; status: ReferralStatus; plannedOn: string | null };
import Link from "next/link";
import {
  applySuggestionAction,
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
 *
 * Under a summary's parts: its suggestions for the contact (Part 7) — company
 * and role with one click each, and a next touch that fills in the form.
 *
 * A contact added in the last week, with mail and no summary, asks straight
 * away whether to generate one (Part 8). It asks; it never runs by itself.
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const LABEL = "text-[10px] font-bold tracking-[0.07em] text-ink-meta uppercase";

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

/** What the contact holds now, so a suggestion knows whether it would fill or replace. */
export type ContactNow = {
  id: string;
  company: string | null;
  role: string | null;
  hasNextTouch: boolean;
  /** What you have already planned with this contact, if anything. */
  plannedTouch: { due_on: string; reason: string | null } | null;
};

export type AiBudget = {
  spentUsd: number;
  /** The plan's own dollar limit on this line, under the emergency brake (slice 13). */
  capUsd: number;
  /** False when the server has no OpenAI key. */
  ready: boolean;
  /** Free's count for summaries and drafts; null on a paid plan. */
  summaries: Allowance | null;
  drafts: Allowance | null;
};


export function SummaryCard({
  contactId,
  approved,
  pending,
  hasMail,
  budget,
  gmailEmail,
  contact,
  askNow,
  referrals,
}: {
  contactId: string;
  approved: SavedSummary | null;
  pending: SavedSummary | null;
  hasMail: boolean;
  budget: AiBudget;
  gmailEmail: string | null;
  contact: ContactNow;
  /** A new contact with mail and no summary: ask whether to generate one now. */
  askNow: boolean;
  /** For each shown summary: each referred person, and whether you've written to them since. */
  referrals: Record<string, ReferredStatus[]>;
}) {
  const [notNow, setNotNow] = useState(false);
  const [generateState, generate, generating] = useActionState<GenerateState>(
    generateSummaryAction.bind(null, contactId),
    null,
  );

  const budgetLeft = roomFor(budget, budget.summaries);
  // While the new-contact question shows, it holds the only Generate button.
  const asking = askNow && !notNow && !approved && !pending;
  const canGenerate = hasMail && budget.ready && budgetLeft && !generating;
  const whyNot = !budget.ready
    ? "The AI isn't set up on this server."
    : !hasMail
      ? "Needs mail with this contact."
      : !budgetLeft
        ? budget.summaries?.left === 0
          ? `You've used this month's ${budget.summaries.allowed} free summaries.`
          : `This month's AI budget is used up ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}).`
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
          {!asking && generateButton}
          <span className="text-[11px] font-medium text-ink-soft">
            {whyNot ??
              (budget.summaries
                ? allowanceLine(budget.summaries, "summary")
                : `AI budget: $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)} this month`)}
          </span>
        </div>
      </div>

      {generateState?.error && (
        <p role="alert" className="rounded-[12px] bg-accent-tint px-4 py-2.5 text-[12.5px] leading-[1.5] text-accent-dark">
          {generateState.error}
        </p>
      )}

      {asking && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-info-tint/60 px-4 py-3.5">
          <div className="flex max-w-[560px] flex-col gap-1">
            <span className="text-[13.5px] font-semibold text-ink">Generate a summary now?</span>
            <span className="text-[12.5px] leading-[1.5] text-ink-soft">
              A new contact with mail. The AI can suggest who they are, their company and role, and a
              next touch — all of it waits for you to check. Costs well under a cent.
            </span>
          </div>
          <form action={generate} className="flex flex-wrap gap-[7px]">
            <button type="submit" disabled={!canGenerate} className={SOLID}>
              {generating ? "Reading your mail…" : "Generate summary"}
            </button>
            <button type="button" disabled={generating} onClick={() => setNotNow(true)} className={GHOST}>
              Not now
            </button>
          </form>
        </div>
      )}

      {!approved && !pending && !asking && (
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
            <Suggestions summary={approved} gmailEmail={gmailEmail} contact={contact} referrals={referrals} />
            <form className="mt-auto">
              <PendingButton formAction={discardSummaryAction.bind(null, pending.id)} className={GHOST}>
                Keep this one
              </PendingButton>
            </form>
          </div>
          <Proposal summary={pending} gmailEmail={gmailEmail} contact={contact} referrals={referrals} approveLabel="Use the new one" />
        </div>
      )}

      {pending && !approved && (
        <Proposal summary={pending} gmailEmail={gmailEmail} contact={contact} referrals={referrals} approveLabel="Approve" />
      )}

      {approved && !pending && <ApprovedSummary summary={approved} gmailEmail={gmailEmail} contact={contact} referrals={referrals} />}
    </section>
  );
}

/** "As of 12 Sep · approved" / "· edited by you". */
function Stamp({ summary }: { summary: SavedSummary }) {
  return (
    <span className="text-[11.5px] font-medium text-ink-soft">
      As of {shortDate(summary.as_of)} · {summary.edited ? "edited by you" : "approved"}
    </span>
  );
}

/** A pending AI version: tinted, with the choice to take it or not. */
function Proposal({
  summary,
  gmailEmail,
  contact,
  referrals,
  approveLabel,
}: {
  summary: SavedSummary;
  gmailEmail: string | null;
  contact: ContactNow;
  referrals: Record<string, ReferredStatus[]>;
  approveLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-info-tint/60 px-4 py-3.5">
      <span className="text-[10px] font-bold tracking-[0.07em] text-info-ink uppercase">
        New AI version · as of {shortDate(summary.as_of)} · waiting for you
      </span>
      <Parts summary={summary} gmailEmail={gmailEmail} />
      <Suggestions summary={summary} gmailEmail={gmailEmail} contact={contact} referrals={referrals} />
      <p className="text-[11.5px] leading-[1.5] text-ink-soft">
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

function ApprovedSummary({
  summary,
  gmailEmail,
  contact,
  referrals,
}: {
  summary: SavedSummary;
  gmailEmail: string | null;
  contact: ContactNow;
  referrals: Record<string, ReferredStatus[]>;
}) {
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
        <Suggestions summary={summary} gmailEmail={gmailEmail} contact={contact} referrals={referrals} />
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
              className="w-full resize-y rounded-[11px] border border-line-strong bg-white px-3 py-2 text-[13.5px] leading-[1.55] text-ink transition focus:border-ink-soft aria-invalid:border-accent"
            />
            {errors[part] && (
              <p role="alert" className="text-[12px] font-medium text-accent">
                {errors[part]}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-soft">
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

/** The four parts, each with links to the emails it came from. Also drawn by the Assistant's summary card (app/assistant/needs-you.tsx). */
export function Parts({ summary, gmailEmail }: { summary: SavedSummary; gmailEmail: string | null }) {
  const numbers = sourceNumbers(summary.sources);

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
                <span className="text-[13px] leading-[1.55] text-ink-soft">Not in these emails</span>
              )}
              {text && <Sources sources={sources} numbers={numbers} gmailEmail={gmailEmail} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The summary's suggestions for the contact, each with its own button:
 * "Set as company" when the field is empty, "Replace …" when it holds something
 * else, "already on the contact" when it's the same. The next touch opens the
 * Next touch form, filled in — saving that is the click.
 */
function Suggestions({
  summary,
  gmailEmail,
  contact,
  referrals,
}: {
  summary: SavedSummary;
  gmailEmail: string | null;
  contact: ContactNow;
  referrals: Record<string, ReferredStatus[]>;
}) {
  const fields = [
    { field: "company" as const, label: "Company", value: summary.suggested_company, current: contact.company },
    { field: "role" as const, label: "Role", value: summary.suggested_role, current: contact.role },
  ].filter((row) => row.value);
  const referred = referrals[summary.id] ?? [];
  // Everyone they referred you to has been written to, or already has a next
  // touch of their own: nothing left to suggest.
  const allDone =
    referred.length > 0 && referred.every((person) => person.status.kind === "done" || person.plannedOn !== null);
  const stillOpen = referred
    .filter((person) => person.status.kind !== "done" && person.plannedOn === null)
    .map((person) => person.name);
  const touchReason = allDone ? null : summary.suggested_touch_reason;
  // The same numbering the parts above use: one "email 1" per page.
  const numbers = sourceNumbers(summary.sources);

  if (fields.length === 0 && !touchReason && referred.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 border-t border-line-soft pt-3">
      <span className={LABEL}>Suggested for the contact</span>
      <ul className="flex flex-col gap-2.5">
        {fields.map(({ field, label, value, current }) => {
          const same = (current ?? "").trim() === value!.trim();
          return (
            <li key={field} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] text-ink-body">
                  <span className="text-ink-soft">{label}:</span> {value}
                </span>
                <Sources sources={summary.sources[field] ?? []} numbers={numbers} gmailEmail={gmailEmail} />
              </div>
              {same ? (
                <span className="text-[11.5px] font-medium text-ink-soft">Already on the contact</span>
              ) : (
                <form>
                  <PendingButton
                    formAction={applySuggestionAction.bind(null, summary.id, field, current)}
                    className={GHOST}
                  >
                    {current ? `Replace “${current}”` : `Set as ${label.toLowerCase()}`}
                  </PendingButton>
                </form>
              )}
            </li>
          );
        })}
        {referred.map((person) => (
          <li key={person.name} className="flex flex-col gap-0.5">
            <ReferralLine name={person.name} status={person.status} />
            {person.plannedOn && (
              <span className="text-[11.5px] text-ink-soft">
                You already have a next touch for {person.name} on {weekdayDate(person.plannedOn)}.
              </span>
            )}
          </li>
        ))}
        {touchReason && (
          <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] text-ink-body">
                <span className="text-ink-soft">Next touch:</span> {touchReason}
                {summary.suggested_touch_on ? ` · ${weekdayDate(summary.suggested_touch_on)}` : " · pick a date"}
              </span>
              {(summary.suggested_touch_why || summary.suggested_touch_rough) && (
                <span className="text-[12px] leading-[1.45] text-ink-soft">
                  {summary.suggested_touch_why}
                  {summary.suggested_touch_rough && (
                    <span className="text-cooling"> Rough guess — pick a better date.</span>
                  )}
                </span>
              )}
              {contact.plannedTouch && (
                <span className="text-[11.5px] text-cooling">
                  Already planned with {"this contact"}: {contact.plannedTouch.reason ?? "a next touch"} ·{" "}
                  {weekdayDate(contact.plannedTouch.due_on)}. Filling this in replaces it.
                </span>
              )}
              {stillOpen.length > 0 && stillOpen.length < referred.length && (
                <span className="text-[11.5px] text-ink-soft">
                  Still to contact: {stillOpen.join(", ")}.
                </span>
              )}
              <Sources sources={summary.sources.next_touch ?? []} numbers={numbers} gmailEmail={gmailEmail} />
            </div>
            <Link href={`/contacts/${contact.id}?touch=${summary.id}#next-touch`} scroll={false} className={GHOST}>
              {contact.hasNextTouch ? "Replace next touch…" : "Fill in next touch"}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * What the referral check found in your mail: done, not yet, can't tell which
 * person, or nobody by that name. Links to their page when they're a contact.
 */
function ReferralLine({ name, status }: { name: string; status: ReferralStatus }) {
  const link = (contactId: string | null, text: string) =>
    contactId ? (
      <Link href={`/contacts/${contactId}`} className="font-semibold text-ink-body link-inline decoration-line-strong">
        {text}
      </Link>
    ) : (
      <span className="font-semibold text-ink-body">{text}</span>
    );

  switch (status.kind) {
    case "done":
      return (
        <span className="text-[13px] text-ink-body">
          <span className="font-semibold text-affirm">✓</span> You wrote to {link(status.contactId, name)} on{" "}
          {shortDate(status.at)}, after the referral — no next touch needed for it.
        </span>
      );
    case "open":
      return (
        <span className="text-[13px] text-ink-body">
          <span className="text-ink-soft">Referral:</span> you haven&rsquo;t written to {link(status.contactId, name)}{" "}
          since.
        </span>
      );
    case "ambiguous":
      return (
        <span className="text-[12.5px] text-ink-soft">
          Referral to {name}: {status.count} different people in your mail have that name, so it can&rsquo;t tell
          whether you&rsquo;ve written to the right one.
        </span>
      );
    case "unknown":
      return (
        <span className="text-[12.5px] text-ink-soft">
          Referral to {name}: nobody by that name in your synced mail yet.
        </span>
      );
  }
}

/**
 * "Sources: email 1, email 2" linking to Gmail, or "their address …" for one
 * taken from an address.
 *
 * `numbers` is the whole summary's numbering (lib/ai/source-numbers.ts), so
 * email 1 is the same message in every part. It counted from one per part
 * until slice 9b, which made the numbers lie to anyone reading down the page.
 */
function Sources({
  sources,
  numbers,
  gmailEmail,
}: {
  sources: SourceRef[];
  numbers: Map<string, number>;
  gmailEmail: string | null;
}) {
  if (sources.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink-soft">
      Sources:
      {sources.map((source) =>
        "address" in source ? (
          <span key={`address:${source.address}`}>their address {source.address}</span>
        ) : (
          <a
            key={source.messageId}
            href={gmailLink(source.messageId, gmailEmail)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-ink-soft link-inline decoration-line-strong"
          >
            email {numbers.get(source.messageId) ?? "?"}
          </a>
        ),
      )}
    </span>
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

/** "Mon 22 Sep" — a next-touch date, read as a calendar day with no time zone. */
function weekdayDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** "12 Sep", in Swedish time. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Stockholm" }).format(
    new Date(iso),
  );
}
