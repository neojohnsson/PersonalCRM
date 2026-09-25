"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { acceptPromise, dismissPromise, type DecideState } from "@/app/assistant/promises/actions";
import type { PendingPromise } from "@/lib/ai/promise-list";
import { avatarColors, dayMonth, initials } from "@/lib/format";

/**
 * One found promise, waiting to be decided (docs/slice-6d-plan.md, Part 6).
 *
 * Built from design/ReviewQueue.dc.html — the same card, dividers, direction
 * pill and ghost/solid button pair as Seen once, which is the screen that
 * exists for approving a queue of suggestions.
 *
 * Differences, on purpose:
 *   - The rows are taller than the queue's, because each one carries the
 *     message you are judging it by. The AI's line is a claim; the words below
 *     it are the evidence, and negation can only be caught by reading them
 *     (plan.md §5.3). That text is read from Gmail as the page loads and is
 *     never stored (AGENTS.md).
 *   - No checkboxes and no "select all". Seen once is bulk work; a promise is
 *     one judgement at a time, and accepting the wrong one puts a date in your
 *     calendar about somebody who owes you nothing.
 *   - Accept carries a date box, because the date is yours to change.
 *
 * `onDecided` is for the Assistant's chat (slice 11b), which draws these rows
 * too: there a decided row cannot vanish by the page reloading, because the
 * chat is not reloaded, so it is told instead. The Promises page passes
 * nothing, and the refresh after each action redraws its list as before.
 */
export function PromiseCard({
  promise,
  onDecided,
}: {
  promise: PendingPromise;
  onDecided?: (decision: "accepted" | "dismissed", dueOn: string) => void;
}) {
  const [dueOn, setDueOn] = useState(promise.dueOn);
  const [state, accept] = useActionState<DecideState, FormData>(async (previous, formData) => {
    const result = await acceptPromise(promise.id, previous, formData);
    // null is success: the action answers only when something went wrong.
    if (result === null) onDecided?.("accepted", String(formData.get("due_on") ?? dueOn));
    return result;
  }, null);
  const theirs = promise.owedBy === "them";

  return (
    <li className="flex flex-col gap-[13px] border-t border-line-soft px-[22px] py-[15px] first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-[13px] gap-y-2">
        <span
          aria-hidden="true"
          style={avatarColors(promise.primaryEmail ?? promise.contactId)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          {initials(promise.name, promise.primaryEmail ?? promise.name)}
        </span>

        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Link
              href={`/contacts/${promise.contactId}`}
              className="truncate text-sm font-semibold tracking-[-0.01em] hover:text-ink-soft"
            >
              {promise.name}
            </Link>
            {promise.company && (
              <span className="min-w-0 truncate text-xs text-ink-soft">{promise.company}</span>
            )}
          </div>
          <span className="text-sm text-ink-soft">{promise.reason}</span>
        </div>

        {/* The queue's direction pill: who said they would do something. */}
        <span
          className={`shrink-0 rounded-full px-[10px] py-1 text-2xs font-semibold whitespace-nowrap ${
            theirs ? "bg-info-tint text-info-ink" : "bg-accent-tint text-accent"
          }`}
        >
          {theirs ? "They said" : "You said"}
        </span>
      </div>

      {promise.text ? (
        <blockquote className="max-h-40 overflow-auto rounded-xl bg-paper-tint px-[15px] py-3 text-sm whitespace-pre-wrap text-ink-body">
          {promise.text}
        </blockquote>
      ) : (
        <p className="rounded-xl bg-paper-tint px-[15px] py-3 text-sm text-ink-soft">
          This message isn&rsquo;t in Gmail any more, so there is nothing to check it against.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-[7px] gap-y-2">
        <form action={accept} className="flex flex-wrap items-center gap-[7px]">
          <label className="flex items-center gap-2 text-xs font-normal text-ink-soft">
            Follow up
            <input
              type="date"
              // Swedish order, as on the contact page (slice 9b, Part 6).
              lang="sv"
              name="due_on"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              className="rounded-full bg-line-soft px-3 py-[7px] text-xs font-semibold text-ink-body"
            />
          </label>
          <AcceptButton />
        </form>

        <form
          action={async () => {
            await dismissPromise(promise.id);
            onDecided?.("dismissed", dueOn);
          }}
        >
          <DismissButton />
        </form>

        <a
          href={`https://mail.google.com/mail/u/0/#all/${promise.threadId}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full px-3 py-2 text-xs font-semibold text-ink-soft hover:text-ink"
        >
          Open in Gmail
        </a>

        <span className="ml-auto text-xs font-normal text-ink-soft">
          {promise.plannedOn
            ? `moves their next touch from ${dayMonth(promise.plannedOn)}`
            : `suggested ${dayMonth(promise.dueOn)}`}
        </span>
      </div>

      {state?.error && (
        <p role="status" className="text-xs font-normal text-accent">
          {state.error}
        </p>
      )}
    </li>
  );
}

function AcceptButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-ink-deep px-[15px] py-2 text-xs font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add next touch"}
    </button>
  );
}

function DismissButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-line-soft px-3.5 py-2 text-xs font-semibold text-ink-body transition hover:bg-chip-track disabled:cursor-default disabled:opacity-50"
    >
      {pending ? "Dismissing…" : "Not a promise"}
    </button>
  );
}
