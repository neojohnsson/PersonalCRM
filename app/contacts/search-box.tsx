"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { MAX_QUERY_LENGTH, normaliseQuery, searchHref } from "@/lib/contacts/search";

/** How long typing has to pause before the list is searched. */
const TYPING_PAUSE_MS = 300;

/**
 * ContactList's search box. The list follows as you type: once typing pauses,
 * the address changes to /contacts?q=… and the page searches the database
 * again, exactly as if Enter had been pressed.
 *
 * It's still a GET form underneath, so Enter searches straight away, and
 * without JavaScript it works as before. `replace` rather than `push`, so Back
 * leaves the page instead of stepping through "k", "ka", "kar".
 */
export function SearchBox({ query }: { query: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, startTransition] = useTransition();
  /** The last query this box sent, to tell our own navigations from others. */
  const sent = useRef(query);

  // The query changed without this box sending it — "Show all contacts", or
  // Back — so the box shows what the list is actually searched by.
  useEffect(() => {
    if (query !== sent.current && input.current) {
      input.current.value = query;
      sent.current = query;
    }
  }, [query]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    function focusFromTyping(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !input.current ||
        input.current.disabled ||
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      input.current.focus({ preventScroll: true });
      input.current.value += event.key;
      input.current.dispatchEvent(new Event("input", { bubbles: true }));
      event.preventDefault();
    }

    document.addEventListener("keydown", focusFromTyping);
    return () => document.removeEventListener("keydown", focusFromTyping);
  }, []);

  function search() {
    clearTimeout(timer.current);
    const typed = input.current?.value ?? "";
    // A trailing space or a changed case of whitespace finds the same people.
    if (normaliseQuery(typed) === sent.current) return;
    sent.current = normaliseQuery(typed);
    startTransition(() => {
      router.replace(searchHref(window.location.search, typed), { scroll: false });
    });
  }

  return (
    <form
      role="search"
      aria-busy={pending}
      action="/contacts"
      onSubmit={(event) => {
        event.preventDefault();
        search();
      }}
      className="flex w-full items-center gap-2 rounded-full bg-white px-[15px] py-2 shadow-[0_1px_2px_rgba(20,20,25,.04)] focus-within:ring-2 focus-within:ring-ink/10 sm:w-[206px]"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" className="size-[15px] shrink-0 text-ink-soft">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.4 15.4 4.1 4.1" />
      </svg>
      {pending && <span className="sr-only" role="status">Searching…</span>}
      <label htmlFor="contact-search" className="sr-only">
        Search contacts
      </label>
      <input
        ref={input}
        id="contact-search"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search name, company, tag"
        onChange={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(search, TYPING_PAUSE_MS);
        }}
        className="w-full min-w-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-soft"
      />
    </form>
  );
}
