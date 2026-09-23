"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { avatarColors, countOf, initials } from "@/lib/format";
import { addAsContacts, dismissPeople } from "./actions";

export type SeenOncePerson = {
  email: string;
  name: string | null;
  fromThem: number;
  fromYou: number;
  subject: string | null;
  /** "3 September", already formatted on the server. */
  day: string | null;
};

/**
 * The selection bar and the rows of design/ReviewQueue.dc.html, as one form.
 *
 * Only the ticking needs JavaScript — how many are selected, select all, the
 * bulk buttons' labels. The buttons themselves are ordinary submit buttons
 * that post to Server Actions. Every checkbox is named "email"; each row's own
 * button is bound to its row's address, and the bulk buttons are bound to null
 * so they act on everything ticked.
 */
export function SeenOnceQueue({
  people,
  total,
  filtered,
  moreHref,
}: {
  people: SeenOncePerson[];
  total: number;
  filtered: number;
  moreHref: string | null;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  // After an action the page re-renders without the people who were handled,
  // so a selection only counts rows that are still here.
  const selected = people.filter((person) => picked.has(person.email));
  const allSelected = people.length > 0 && selected.length === people.length;

  function toggle(email: string) {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setPicked(allSelected ? new Set() : new Set(people.map((person) => person.email)));
  }

  return (
    <form className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white px-[22px] py-[11px] shadow-[0_1px_2px_rgba(20,20,25,.04)]">
        <label className="flex cursor-pointer items-center gap-[13px]">
          <Checkbox checked={allSelected} onChange={toggleAll} label="Select everyone shown" />
          <span className="text-[12.5px] font-semibold">
            {selected.length > 0 ? `${selected.length} selected` : "Select all"}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-[7px]">
          {filtered > 0 && (
            <span className="mr-1.5 text-[11.5px] text-ink-faint">
              {countOf(filtered, "automated message")} filtered out — newsletters, no-reply,
              calendar invites
            </span>
          )}
          <SubmitButton
            action={dismissPeople.bind(null, null)}
            variant="ghost"
            disabled={selected.length === 0}
          >
            Dismiss selected
          </SubmitButton>
          <SubmitButton
            action={addAsContacts.bind(null, null)}
            variant="solid"
            disabled={selected.length === 0}
          >
            {selected.length > 0
              ? `Add ${selected.length} as ${selected.length === 1 ? "contact" : "contacts"}`
              : "Add as contacts"}
          </SubmitButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]">
        <ul>
          {people.map((person) => (
            <Row
              key={person.email}
              person={person}
              checked={picked.has(person.email)}
              onToggle={() => toggle(person.email)}
            />
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-line-soft px-[22px] py-[11px]">
          <span className="text-[11.5px] font-medium text-ink-ghost">
            Showing {people.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}
          </span>
          {moreHref && (
            <Link
              href={moreHref}
              scroll={false}
              className="text-[11.5px] font-semibold text-ink-muted hover:text-ink"
            >
              Load more
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}

function Row({
  person,
  checked,
  onToggle,
}: {
  person: SeenOncePerson;
  checked: boolean;
  onToggle: () => void;
}) {
  const label = person.name ?? person.email;
  const domain = person.email.split("@")[1];

  return (
    <li className="flex flex-wrap items-center gap-x-[14px] gap-y-2 border-t border-line-soft px-[22px] py-[13px] first:border-t-0 lg:flex-nowrap">
      <Checkbox
        name="email"
        value={person.email}
        checked={checked}
        onChange={onToggle}
        label={`Select ${label}`}
      />

      <span
        aria-hidden="true"
        style={avatarColors(person.email)}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
      >
        {initials(person.name, person.email)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:w-[236px] lg:flex-none">
        <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{label}</span>
        <span className="truncate text-[12px] text-ink-muted">{person.email}</span>
      </div>

      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums ${
          person.fromThem > 0 ? "bg-info-tint text-info-ink" : "bg-line-soft text-ink-muted"
        }`}
      >
        {person.fromThem} from them · {person.fromYou} from you
      </span>

      <div className="flex min-w-0 basis-full flex-col gap-0.5 lg:basis-auto lg:flex-1">
        <span
          className={`truncate text-[11.5px] font-semibold ${
            person.subject ? "text-ink-body" : "text-ink-hush"
          }`}
        >
          {person.subject ?? "No subject"}
        </span>
        <span className="truncate text-[11.5px] text-ink-muted">
          {[person.day, domain].filter(Boolean).join(" · ")}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-[7px]">
        <SubmitButton action={dismissPeople.bind(null, person.email)} variant="ghost">
          Dismiss
        </SubmitButton>
        <SubmitButton action={addAsContacts.bind(null, person.email)} variant="solid">
          Add as contact
        </SubmitButton>
      </div>
    </li>
  );
}

/** The design's 17px rounded checkbox: grey outline, near-black with a white tick when on. */
function Checkbox({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name?: string;
  value?: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer size-5 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-line-strong bg-white transition-colors checked:border-ink-deep checked:bg-ink-deep focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:outline-none"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-white peer-checked:block"
      >
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

const BUTTON = {
  ghost: "bg-line-soft text-ink-body hover:bg-chip-track",
  solid: "bg-ink-deep text-white hover:bg-ink/85",
};

/**
 * A submit button for one of the Server Actions, already bound to what it acts
 * on. No `name`: React reserves it for buttons whose formAction is a function.
 * While any submission of the form is on its way, every button is disabled, so
 * nothing is sent twice.
 */
function SubmitButton({
  action,
  variant,
  disabled = false,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  variant: keyof typeof BUTTON;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={action}
      disabled={disabled || pending}
      className={`shrink-0 rounded-full px-[14px] py-2 text-[12px] font-semibold whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 ${BUTTON[variant]}`}
    >
      {children}
    </button>
  );
}
