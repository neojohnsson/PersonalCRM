"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { displayName } from "@/lib/contacts/display";
import type { DuplicateSide, DuplicateSuggestion } from "@/lib/contacts/duplicate-list";
import { avatarColors, countOf, dayMonth, initials } from "@/lib/format";
import { dismissPairAction, mergeContactsAction, type MergeState } from "./actions";

/**
 * One pair, side by side: what each contact holds, why they were paired, and
 * the three things you can do — keep the left one, keep the right one, or say
 * they aren't the same person.
 *
 * Built from the summary card's side-by-side and the contact list's rows; no
 * design covers this screen.
 */

const CARD =
  "rounded-xl bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";
const GHOST =
  "rounded-full bg-line-soft px-[13px] py-1.5 text-xs font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:opacity-60";
const SOLID =
  "rounded-full bg-ink-deep px-[15px] py-1.5 text-xs font-semibold text-white transition hover:bg-ink/85 disabled:opacity-60";

export function DuplicatePairCard({ pair }: { pair: DuplicateSuggestion }) {
  const [keepLeft, mergeIntoLeft, keepingLeft] = useActionState<MergeState>(
    mergeContactsAction.bind(null, pair.keep.id, pair.other.id),
    null,
  );
  const [keepRight, mergeIntoRight, keepingRight] = useActionState<MergeState>(
    mergeContactsAction.bind(null, pair.other.id, pair.keep.id),
    null,
  );
  const busy = keepingLeft || keepingRight;
  const error = keepLeft?.error ?? keepRight?.error ?? null;

  return (
    <section className={`${CARD} flex flex-col gap-3.5 px-[22px] py-[18px]`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-semibold tracking-[-0.01em]">{pair.because}</span>
        <form action={dismissPairAction.bind(null, pair.keep.id, pair.other.id)}>
          <DismissButton />
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-accent-tint px-4 py-2.5 text-sm text-accent-dark">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Side contact={pair.keep} action={mergeIntoLeft} busy={busy} />
        <Side contact={pair.other} action={mergeIntoRight} busy={busy} />
      </div>

      <p className="text-xs text-ink-soft">
        Keeping one moves the other&rsquo;s addresses and mail history onto it, fills anything it
        doesn&rsquo;t have, and deletes the other. What you wrote is never overwritten. There is no
        undo.
      </p>
    </section>
  );
}

function Side({
  contact,
  action,
  busy,
}: {
  contact: DuplicateSide;
  action: () => void;
  busy: boolean;
}) {
  const name = displayName(contact);
  const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          style={avatarColors(contact.primary_email ?? contact.id)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          {initials(hasName ? name : null, contact.primary_email ?? name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/contacts/${contact.id}`}
            className="truncate text-sm font-semibold tracking-[-0.01em] hover:text-ink-soft"
          >
            {name}
          </Link>
          {contact.company && <span className="truncate text-xs text-ink-soft">{contact.company}</span>}
        </div>
      </div>

      <dl className="flex flex-col gap-1 text-xs text-ink-soft">
        <div className="flex gap-2">
          <dt className="shrink-0">Addresses:</dt>
          <dd className="min-w-0 break-words text-ink-body">{contact.emails.join(", ") || "none"}</dd>
        </div>
        {contact.phone && (
          <div className="flex gap-2">
            <dt className="shrink-0">Phone:</dt>
            <dd className="text-ink-body">{contact.phone}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="shrink-0">Mail:</dt>
          <dd className="text-ink-body">{countOf(contact.message_count, "message")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0">Added:</dt>
          <dd className="text-ink-body">{dayMonth(contact.created_at)}</dd>
        </div>
      </dl>

      <form action={action} className="mt-auto">
        <button type="submit" disabled={busy} className={SOLID}>
          Keep this one
        </button>
      </form>
    </div>
  );
}

function DismissButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={GHOST}>
      {pending ? "…" : "Not the same person"}
    </button>
  );
}
