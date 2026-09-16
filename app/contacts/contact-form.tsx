"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  LIMITS,
  MAX_EMAILS,
  type ContactFormErrors,
  type ContactFormState,
  type ContactValues,
  type TextField,
} from "@/lib/contacts/contact-form";
import { saveContact } from "./actions";

/**
 * The add and edit contact form.
 *
 * There's no design for it, so it's built from design/ContactDetail.dc.html's
 * white cards and small uppercase section labels, and the Connect page's dark
 * pill button.
 *
 * Errors come back from the Server Action through useActionState and appear
 * next to their field; what was typed is handed back too, so nothing is lost.
 * The addresses are a small list kept in state, because rows can be added,
 * removed and reordered; the first one is primary.
 */
export function ContactForm({
  contactId,
  initial,
  cancelHref,
}: {
  contactId: string | null;
  initial: ContactValues;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(
    saveContact.bind(null, contactId),
    null,
  );
  const values = state?.values ?? initial;
  const errors: ContactFormErrors = state?.errors ?? {};

  const [emails, setEmails] = useState<string[]>(initial.emails.length > 0 ? initial.emails : [""]);

  function setEmail(index: number, value: string) {
    setEmails((list) => list.map((email, i) => (i === index ? value : email)));
  }

  function removeEmail(index: number) {
    setEmails((list) => (list.length === 1 ? [""] : list.filter((_, i) => i !== index)));
  }

  function makePrimary(index: number) {
    setEmails((list) => [list[index], ...list.filter((_, i) => i !== index)]);
  }

  return (
    <form action={formAction} noValidate className="flex max-w-2xl flex-col gap-4">
      {errors.form && (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-[14px] bg-accent-tint px-[18px] py-[15px] text-[13.5px] leading-[1.55] text-[#7c3a12]"
        >
          {errors.form}
        </p>
      )}

      <Section title="Name">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput name="first_name" label="First name" values={values} errors={errors} />
          <TextInput name="last_name" label="Last name" values={values} errors={errors} />
        </div>
      </Section>

      <Section title="Work">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput name="company" label="Company" values={values} errors={errors} />
          <TextInput name="role" label="Role" values={values} errors={errors} />
        </div>
        <TextInput
          name="one_liner"
          label="One line on what they do"
          values={values}
          errors={errors}
          placeholder="Runs the platform team; takes two thesis students a year"
        />
      </Section>

      <Section title="Reach them">
        <fieldset className="flex flex-col gap-2" aria-describedby={errors.emails ? "emails-error" : undefined}>
          <legend className={LABEL}>Email addresses</legend>
          {emails.map((email, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                name="emails"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(index, event.target.value)}
                placeholder="name@company.se"
                aria-label={index === 0 ? "Primary email address" : `Email address ${index + 1}`}
                aria-invalid={errors.emails ? true : undefined}
                className={`${INPUT} min-w-0 flex-1`}
              />
              {index === 0 ? (
                emails.length > 1 && <span className="text-[11.5px] font-semibold text-ink-faint">Primary</span>
              ) : (
                <SmallButton onClick={() => makePrimary(index)}>Make primary</SmallButton>
              )}
              {(emails.length > 1 || email !== "") && (
                <SmallButton onClick={() => removeEmail(index)}>Remove</SmallButton>
              )}
            </div>
          ))}
          {emails.length < MAX_EMAILS && (
            <SmallButton onClick={() => setEmails((list) => [...list, ""])} className="self-start">
              + Add address
            </SmallButton>
          )}
          <FieldError id="emails-error" message={errors.emails} />
        </fieldset>

        <TextInput name="phone" label="Phone" type="tel" values={values} errors={errors} />
      </Section>

      <Section title="How you know them">
        <TextArea
          name="how_known"
          label="How you know them"
          hideLabel
          rows={3}
          values={values}
          errors={errors}
          placeholder="Met after the guest lecture at LNU in March"
        />
      </Section>

      <Section title="Tags">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tags" className="sr-only">
            Tags
          </label>
          <input
            id="tags"
            name="tags"
            defaultValue={values.tags}
            placeholder="växjö, thesis, recruiter"
            aria-invalid={errors.tags ? true : undefined}
            aria-describedby={errors.tags ? "tags-error" : "tags-hint"}
            className={INPUT}
          />
          {errors.tags ? (
            <FieldError id="tags-error" message={errors.tags} />
          ) : (
            <p id="tags-hint" className="text-[12px] text-ink-faint">
              Separate tags with commas.
            </p>
          )}
        </div>
      </Section>

      <Section title="Notes" id="notes">
        <TextArea name="notes" label="Notes" hideLabel rows={6} values={values} errors={errors} />
      </Section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink-deep px-[22px] py-3 text-[14px] font-semibold tracking-[-0.01em] text-white transition hover:bg-ink/85 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save contact"}
        </button>
        <Link href={cancelHref} className="text-[14px] font-medium text-ink-soft hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}

const LABEL = "text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

const INPUT =
  "w-full rounded-[11px] border border-line-strong bg-white px-3 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-hush focus:border-ink-faint focus:ring-2 focus:ring-ink/10 aria-invalid:border-accent";

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      className="flex flex-col gap-3 rounded-[18px] bg-white px-[22px] py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]"
    >
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
      {children}
    </section>
  );
}

function TextInput({
  name,
  label,
  values,
  errors,
  type = "text",
  placeholder,
}: {
  name: TextField;
  label: string;
  values: ContactValues;
  errors: ContactFormErrors;
  type?: string;
  placeholder?: string;
}) {
  const error = errors[name];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className={LABEL}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={values[name]}
        maxLength={LIMITS[name]}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={INPUT}
      />
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

function TextArea({
  name,
  label,
  hideLabel = false,
  rows,
  values,
  errors,
  placeholder,
}: {
  name: TextField;
  label: string;
  hideLabel?: boolean;
  rows: number;
  values: ContactValues;
  errors: ContactFormErrors;
  placeholder?: string;
}) {
  const error = errors[name];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className={hideLabel ? "sr-only" : LABEL}>
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={values[name]}
        maxLength={LIMITS[name]}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`${INPUT} resize-y leading-[1.6]`}
      />
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[12.5px] font-medium text-accent">
      {message}
    </p>
  );
}

function SmallButton({
  onClick,
  className = "",
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full bg-line-soft px-3 py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track ${className}`}
    >
      {children}
    </button>
  );
}
