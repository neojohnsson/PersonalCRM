"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { COMMON_AI_PHRASES } from "@/lib/ai/tidy";
import { initials, timeAgo } from "@/lib/format";
import {
  PROFILE_LIMITS,
  type AddressBy,
  type Length,
  type Profile,
  type ProfileLink,
  type ProfileTextField,
  type Tone,
} from "@/lib/profile/profile";
import { saveProfileAction, type ProfileState } from "./actions";

/**
 * The Profile page's form, built from design/Profile.dc.html.
 *
 * It saves itself, as the design's "Saved 2 minutes ago" says: a text field
 * when you leave it, a choice or a list the moment it changes. The Server
 * Action is called directly rather than as the form's `action`, because React
 * resets a form after its action runs — which would wipe whatever you were
 * typing in the next field while the last one saved.
 *
 * Differences from the design, on purpose:
 *   - No Files and no Read from your CV: uploads and the facts read from them
 *     are slice 5b.
 *   - Links are edited in place (name, address, remove); the design only shows
 *     saved ones. Under them, a pointer: LinkedIn gets into drafts through
 *     LinkedIn's own PDF export, in Files, once 5b exists.
 *   - Under "Never write", one-click suggestions for the phrases that make a
 *     draft read as machine-written (lib/ai/tidy.ts). The design has the list
 *     but not the suggestions.
 *   - The header's search and bell are left out, as on every page (app-shell.tsx).
 *   - The columns stack on narrow screens.
 */

const CARD =
  "flex flex-col gap-3.5 rounded-xl bg-white px-[22px] pt-[18px] pb-5 shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";
const FIELD_LABEL = "text-xs font-semibold text-ink-soft";
const INPUT =
  "w-full rounded-lg border border-line bg-paper-tint px-3 py-[9px] text-sm text-ink transition placeholder:text-ink-soft focus:border-ink-soft focus:bg-white aria-invalid:border-accent";

const TONE_OPTIONS: { value: Tone; name: string; description: string; example: string }[] = [
  {
    value: "professional",
    name: "Professional",
    description: "Complete sentences, no small talk.",
    example: "“Thank you for your reply regarding the thesis position.”",
  },
  {
    value: "friendly",
    name: "Friendly",
    description: "Polite, and sounds like a person.",
    example: "“Thanks for getting back to me about the thesis.”",
  },
  {
    value: "casual",
    name: "Casual",
    description: "For people you already know well.",
    example: "“Hey Johan, good to hear from you.”",
  },
  {
    value: "brief",
    name: "Brief",
    description: "Two or three sentences, straight to it.",
    example: "“Sounds good — Tuesday at 10 works.”",
  },
];

export function ProfileForm({ initial, savedAt, email }: { initial: Profile; savedAt: string | null; email: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch, saving] = useActionState<ProfileState, FormData>(saveProfileAction, {
    profile: initial,
    errors: {},
    savedAt,
  });

  // The parts kept in state because they're chosen or listed, not typed into one box.
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [length, setLength] = useState<Length>(initial.length);
  const [addressBy, setAddressBy] = useState<AddressBy>(initial.address_by);
  const [languages, setLanguages] = useState(initial.languages);
  const [neverWrite, setNeverWrite] = useState(initial.never_write);
  const [links, setLinks] = useState<ProfileLink[]>(initial.links);
  const [displayName, setDisplayName] = useState(initial.display_name ?? "");

  /** Send the form as it is now. Called after React has rendered the latest change. */
  const save = () => {
    const form = formRef.current;
    if (form) startTransition(() => dispatch(new FormData(form)));
  };
  /** For state changes: wait one tick so the hidden inputs hold the new values. */
  const saveSoon = () => setTimeout(save, 0);

  // Re-render every half minute so "Saved 2 minutes ago" keeps counting.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const errors = state.errors;
  const hasErrors = Object.keys(errors).length > 0;
  const status = saving
    ? { dot: "bg-info animate-pulse", text: "Saving…" }
    : hasErrors
      ? { dot: "bg-accent", text: "Not saved — see the marked fields" }
      : state.savedAt
        ? { dot: "bg-affirm", text: `Saved ${timeAgo(state.savedAt)}` }
        : { dot: "bg-ink-soft", text: "Not saved yet" };

  const textField = (name: ProfileTextField, label: string, options: { rows?: number; placeholder?: string } = {}) => {
    const common = {
      id: `profile-${name}`,
      name,
      defaultValue: initial[name] ?? "",
      maxLength: PROFILE_LIMITS[name],
      placeholder: options.placeholder,
      "aria-invalid": errors[name] ? true : undefined,
      // Save when you leave the field, if it changed since the page loaded or last saved.
      onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.currentTarget.value.trim() !== (state.profile[name] ?? "")) save();
      },
      className: INPUT,
    };
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={common.id} className={FIELD_LABEL}>
          {label}
        </label>
        {options.rows ? (
          <textarea {...common} rows={options.rows} className={`${INPUT} min-h-24 resize-none field-sizing-content`} />
        ) : (
          <input
            {...common}
            type="text"
            onChange={name === "display_name" ? (event) => setDisplayName(event.currentTarget.value) : undefined}
          />
        )}
        <FieldError message={errors[name]} />
      </div>
    );
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      {/* Hidden inputs carry what isn't typed into a box, so one FormData holds everything. */}
      <input type="hidden" name="tone" value={tone} />
      <input type="hidden" name="length" value={length} />
      <input type="hidden" name="address_by" value={addressBy} />
      {languages.map((language) => (
        <input key={`language:${language}`} type="hidden" name="languages" value={language} />
      ))}
      {neverWrite.map((phrase) => (
        <input key={`never:${phrase}`} type="hidden" name="never_write" value={phrase} />
      ))}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-rail-avatar text-lg font-bold text-white"
        >
          {initials(displayName.trim() || null, email)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <h1 className="text-xl font-bold tracking-[-0.035em] break-words">
            {displayName.trim() || "Your profile"}
          </h1>
          <p className="text-base font-normal text-ink-soft">
            What your drafts know about you. Nothing here goes to the AI until you ask for a draft.
          </p>
        </div>
        <div role="status" className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${status.dot}`} />
          <span className="text-sm font-normal text-ink-soft">{status.text}</span>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Left column */}
        <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
          <section className={CARD}>
            <CardHeading title="About you" caption="Used in every draft" />
            <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
              {textField("display_name", "Name")}
              {textField("based_in", "Based in")}
              <div className="sm:col-span-2">{textField("what_you_do", "What you do", { rows: 2 })}</div>
              <div className="sm:col-span-2">
                {textField("looking_for", "What you're looking for right now", { rows: 2 })}
              </div>
              {textField("signature", "Signature", { rows: 3 })}
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className={FIELD_LABEL}>Languages you write in</span>
                <ChipList
                  items={languages}
                  addLabel="Add"
                  itemLabel="language"
                  maxLength={PROFILE_LIMITS.language}
                  onChange={(next) => {
                    setLanguages(next);
                    saveSoon();
                  }}
                />
                <span className="text-xs text-ink-soft">
                  A draft is written in the language of the thread it answers.
                </span>
                <FieldError message={errors.languages} />
              </div>
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-[18px] lg:w-[440px] lg:shrink-0">
          <section className={CARD}>
            <CardHeading title="How drafts sound" caption="You can change it per draft" />

            <div role="radiogroup" aria-label="Tone" className="grid gap-2.5 sm:grid-cols-2">
              {TONE_OPTIONS.map((option) => {
                const on = tone === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setTone(option.value);
                      saveSoon();
                    }}
                    className={`flex flex-col gap-[5px] rounded-xl px-3.5 py-3 text-left transition ${
                      on
                        ? "bg-white inset-ring-[1.5px] inset-ring-ink-deep"
                        : "bg-paper-tint inset-ring-[1px] inset-ring-line hover:bg-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-3.5 shrink-0 rounded-full ${
                          on
                            ? "inset-ring-[4.5px] inset-ring-ink-deep"
                            : "inset-ring-[1.5px] inset-ring-radio-ring"
                        }`}
                      />
                      <span className="text-sm font-semibold tracking-[-0.01em]">{option.name}</span>
                    </span>
                    <span className="text-xs text-ink-soft">{option.description}</span>
                    <span className="text-xs text-ink-soft">{option.example}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 pt-1">
              <SettingRow label="Length">
                <Segmented
                  label="Length"
                  value={length}
                  options={[
                    { value: "short", label: "Short" },
                    { value: "medium", label: "Medium" },
                    { value: "long", label: "Long" },
                  ]}
                  onChange={(value) => {
                    setLength(value);
                    saveSoon();
                  }}
                />
              </SettingRow>
              <SettingRow label="Address people by">
                <Segmented
                  label="Address people by"
                  value={addressBy}
                  options={[
                    { value: "first_name", label: "First name" },
                    { value: "full_name", label: "Full name" },
                  ]}
                  onChange={(value) => {
                    setAddressBy(value);
                    saveSoon();
                  }}
                />
              </SettingRow>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="profile-sign_off" className="text-sm font-semibold tracking-[-0.01em]">
                    Sign off with
                  </label>
                  <input
                    id="profile-sign_off"
                    name="sign_off"
                    type="text"
                    defaultValue={initial.sign_off ?? ""}
                    maxLength={PROFILE_LIMITS.sign_off}
                    placeholder="Vänliga hälsningar · Best regards"
                    aria-invalid={errors.sign_off ? true : undefined}
                    onBlur={(event) => {
                      if (event.currentTarget.value.trim() !== (state.profile.sign_off ?? "")) save();
                    }}
                    className={`${INPUT} max-w-[230px] py-1.5 text-sm`}
                  />
                </div>
                <FieldError message={errors.sign_off} />
              </div>
            </div>

            <div aria-hidden="true" className="h-px bg-line" />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold tracking-[-0.01em]">Never write</span>
              <ChipList
                items={neverWrite}
                addLabel="Add"
                itemLabel="phrase"
                maxLength={PROFILE_LIMITS.never_write_item}
                quote
                onChange={(next) => {
                  setNeverWrite(next);
                  saveSoon();
                }}
              />
              {COMMON_AI_PHRASES.some((phrase) => !neverWrite.includes(phrase)) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-soft">Common AI phrases:</span>
                  {COMMON_AI_PHRASES.filter((phrase) => !neverWrite.includes(phrase)).map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      onClick={() => {
                        setNeverWrite([...neverWrite, phrase]);
                        saveSoon();
                      }}
                      className="rounded-full px-[11px] py-[5px] text-xs font-normal text-ink-soft inset-ring-[1px] inset-ring-line hover:text-ink"
                    >
                      + “{phrase}”
                    </button>
                  ))}
                </div>
              )}
              <FieldError message={errors.never_write} />
            </div>
          </section>

          <section className={CARD}>
            <CardHeading title="Links" caption="In signature" />
            <LinkList
              links={links}
              onChange={(next, saveNow) => {
                setLinks(next);
                if (saveNow) saveSoon();
              }}
              onBlurField={save}
            />
            <FieldError message={errors.links} />
            <p className="text-xs font-normal text-ink-soft">
              The AI only sees the address. The app never opens these pages &mdash; LinkedIn is not
              read or scraped. If you want what is on your LinkedIn profile to reach a draft, put
              it in &ldquo;What you do&rdquo; and &ldquo;What you&rsquo;re looking for&rdquo;
              above, which is what every draft is given.
            </p>
          </section>
        </div>
      </div>
    </form>
  );
}

function CardHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-base font-bold tracking-[-0.015em]">{title}</h2>
      <span className="text-xs font-semibold text-ink-soft">{caption}</span>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="text-sm font-semibold tracking-[-0.01em]">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-full bg-line-soft p-[3px]">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-[13px] py-[5px] text-xs transition-colors ${
              on
                ? "bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(20,20,25,.06)]"
                : "font-normal text-ink-soft hover:text-ink-soft"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Grey chips with a remove cross, and an outlined "Add" chip that becomes a small input. */
function ChipList({
  items,
  addLabel,
  itemLabel,
  maxLength,
  quote = false,
  onChange,
}: {
  items: string[];
  addLabel: string;
  itemLabel: string;
  maxLength: number;
  quote?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const add = (raw: string) => {
    const value = raw.trim();
    setAdding(false);
    if (!value || items.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    onChange([...items, value]);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="flex items-center gap-1.5 rounded-full bg-line-soft py-[5px] pr-2 pl-[11px] text-xs font-normal text-ink-body"
        >
          {quote ? `“${item}”` : item}
          <button
            type="button"
            onClick={() => onChange(items.filter((other) => other !== item))}
            aria-label={`Remove ${item}`}
            className="text-ink-soft hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-3">
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          type="text"
          maxLength={maxLength}
          aria-label={`New ${itemLabel}`}
          placeholder={`New ${itemLabel}`}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(event.currentTarget.value);
            } else if (event.key === "Escape") {
              setAdding(false);
            }
          }}
          onBlur={(event) => add(event.currentTarget.value)}
          className="w-40 rounded-full border border-line-strong bg-white px-[11px] py-1 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-[5px] rounded-full px-[11px] py-[5px] text-xs font-semibold text-ink-soft inset-ring-[1px] inset-ring-line hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="size-[11px]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {addLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The links: a name and an address each, a switch for the signature, and a
 * remove cross. Text in a list, never opened — so they're shown as text, not links.
 */
function LinkList({
  links,
  onChange,
  onBlurField,
}: {
  links: ProfileLink[];
  onChange: (links: ProfileLink[], saveNow: boolean) => void;
  onBlurField: () => void;
}) {
  const update = (index: number, change: Partial<ProfileLink>, saveNow: boolean) =>
    onChange(
      links.map((link, i) => (i === index ? { ...link, ...change } : link)),
      saveNow,
    );

  const plainInput =
    "w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 -mx-1 hover:border-line focus:border-ink-soft focus:bg-white";

  return (
    <div className="flex flex-col">
      {links.map((link, index) => (
        <div
          // Index keys: rows have no id of their own and are only added at the end or removed.
          key={index}
          className="flex items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0"
        >
          <input type="hidden" name="link_in_signature" value={String(link.in_signature)} />
          <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-line-soft text-ink-soft">
            <LinkIcon label={link.label} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <input
              name="link_label"
              aria-label="Link name"
              placeholder="Name, like GitHub"
              value={link.label}
              maxLength={PROFILE_LIMITS.link_label}
              onChange={(event) => update(index, { label: event.currentTarget.value }, false)}
              onBlur={onBlurField}
              className={`${plainInput} text-sm font-semibold tracking-[-0.01em] placeholder:font-normal placeholder:text-ink-soft`}
            />
            <input
              name="link_url"
              aria-label={`${link.label || "Link"} address`}
              placeholder="github.com/you"
              value={link.url}
              maxLength={PROFILE_LIMITS.link_url}
              onChange={(event) => update(index, { url: event.currentTarget.value }, false)}
              onBlur={onBlurField}
              className={`${plainInput} truncate text-xs text-ink-soft placeholder:text-ink-soft`}
            />
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={link.in_signature}
            aria-label={`Put ${link.label || "this link"} in the signature`}
            onClick={() => update(index, { in_signature: !link.in_signature }, true)}
            className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
              link.in_signature ? "bg-ink-deep" : "bg-switch-off"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(20,20,25,.18)] transition-all ${
                link.in_signature ? "left-3.5" : "left-0.5"
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => onChange(links.filter((_, i) => i !== index), true)}
            aria-label={`Remove ${link.label || "this link"}`}
            className="text-ink-soft hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-3.5">
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
        </div>
      ))}
      {links.length < PROFILE_LIMITS.links && (
        <div className={links.length > 0 ? "border-t border-line-soft pt-2.5" : ""}>
          <button
            type="button"
            onClick={() => onChange([...links, { label: "", url: "", in_signature: false }], false)}
            className="flex items-center gap-1.5 rounded-full bg-line-soft px-[13px] py-[7px] text-xs font-semibold text-ink-body transition-colors hover:bg-chip-track"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-3 text-ink-soft">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add link
          </button>
        </div>
      )}
    </div>
  );
}

/** The design's briefcase for LinkedIn and code brackets for GitHub; a chain link for the rest. */
function LinkIcon({ label }: { label: string }) {
  const name = label.trim().toLowerCase();
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[15px]">
      {name.includes("linkedin") ? (
        <>
          <rect x="3.5" y="7.5" width="17" height="12" rx="2.2" />
          <path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7" />
        </>
      ) : name.includes("github") ? (
        <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />
      ) : (
        <>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </>
      )}
    </svg>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-normal text-accent">
      {message}
    </p>
  );
}
