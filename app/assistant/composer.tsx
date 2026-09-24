"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The Assistant's message bar, shaped like ChatGPT's at the user's request
 * (2026-09-23), replacing the approved design's box-and-button row: one
 * rounded bar with "+" on the left, the words in the middle, then dictation
 * and a round blue Ask button on the right.
 *
 *   Examples    opens the starter questions, which were a row of chips
 *   microphone  the browser's own speech recognition, shown only where the
 *               browser has it. In Chrome that means your voice is sent to
 *               Google to be turned into text, and the button says so
 *   Ask         round and blue, in the app's own blue (--color-info), not a
 *               new colour. Its name stays "Ask", never "Send": nothing here
 *               sends anything to anybody (AGENTS.md)
 *
 * No attachments behind "+": the Assistant cannot read files. No "think
 * harder" either; the user left that out.
 *
 * The box is uncontrolled, as before (commit 1ed825d): it keeps whatever is in
 * it, and Ask reads it when pressed.
 */

export const STARTERS = [
  "Who needs me this week?",
  "Draft the replies I owe",
  "Who have I forgotten about?",
  "What's on this week?",
];

type Props = {
  onAsk: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  full: boolean;
  placeholder: string;
};

export function Composer({ onAsk, onStop, busy, full, placeholder }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [hasText, setHasText] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const dictation = useDictation(box, setHasText);

  // Words typed before the page finished loading are already in the box.
  useEffect(() => {
    setHasText(Boolean(box.current?.value.trim()));
  }, []);

  useEffect(() => {
    function focusFromTyping(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !box.current ||
        busy ||
        full ||
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

      box.current.focus({ preventScroll: true });
      box.current.value += event.key;
      box.current.dispatchEvent(new Event("input", { bubbles: true }));
      event.preventDefault();
    }

    document.addEventListener("keydown", focusFromTyping);
    return () => document.removeEventListener("keydown", focusFromTyping);
  }, [busy, full]);

  // The starters menu closes on a click anywhere else, or on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  function send(text: string) {
    const words = text.trim();
    if (!words || busy || full) return;
    dictation.stop();
    if (box.current) {
      box.current.value = "";
      box.current.style.height = "auto";
    }
    setHasText(false);
    setMenuOpen(false);
    onAsk(words);
  }

  function resize() {
    if (!box.current) return;
    box.current.style.height = "auto";
    box.current.style.height = `${Math.min(box.current.scrollHeight, 128)}px`;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send(box.current?.value ?? "");
      }}
      className="assistant-composer relative flex h-14 items-center gap-1 rounded-full border border-line bg-white py-2 pr-2 pl-2 shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] focus-within:border-ink-faint"
    >
      <div ref={menu} className="relative shrink-0">
        <button
          type="button"
          aria-label="Example questions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          disabled={busy || full}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ink-body transition hover:bg-paper disabled:opacity-50"
        >
          <span>Examples</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
            <path d="m7 9 5 5 5-5" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-12 left-0 z-20 flex w-64 flex-col rounded-[14px] border border-line bg-white p-1.5 shadow-[0_8px_24px_rgba(20,20,25,.12)]"
          >
            <span className="px-3 pb-1.5 pt-2 text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase">
              Try asking
            </span>
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                role="menuitem"
                onClick={() => send(starter)}
                className="rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-ink transition hover:bg-paper"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
      </div>

      <label htmlFor="assistant-ask" className="sr-only">
        Ask the Assistant
      </label>
      <textarea
        ref={box}
        id="assistant-ask"
        rows={1}
        onInput={(event) => {
          setHasText(Boolean(event.currentTarget.value.trim()));
          resize();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send(event.currentTarget.value);
          }
        }}
        disabled={busy || full}
        maxLength={4000}
        placeholder={placeholder}
        className="max-h-32 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-[14px] leading-normal text-ink outline-none placeholder:text-ink-faint disabled:opacity-60"
      />

      {dictation.supported && (
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={busy || full}
          aria-pressed={dictation.listening}
          aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
          title="Dictate. In Chrome your voice is sent to Google to be turned into text."
          className={`flex size-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
            dictation.listening ? "bg-accent-tint text-accent" : "text-ink-body hover:bg-paper"
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-5">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
          </svg>
        </button>
      )}

      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          title="Stop generating"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-deep text-white transition hover:bg-ink"
        >
          <span aria-hidden="true" className="size-3 rounded-[3px] bg-white" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={full || !hasText}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info text-white transition hover:bg-info-ink disabled:cursor-default disabled:bg-chip-track disabled:text-ink-faint"
        >
          {/* "Ask", not "Send": this app has a rule against send buttons,
              and nothing here sends anything to anybody. */}
          <span className="sr-only">
            Ask
          </span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
    </form>
  );
}

// ── Dictation ──────────────────────────────────────────────────────────────

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/**
 * The browser's speech recognition, where there is one (Chrome and Edge call
 * it webkitSpeechRecognition; Firefox has none, and there the button is not
 * shown). What is heard is written into the box after whatever was already
 * there, so you can read and change it before pressing Ask — nothing is asked
 * by voice alone.
 */
function useDictation(box: React.RefObject<HTMLTextAreaElement | null>, setHasText: (has: boolean) => void) {
  // A fact about the browser: false on the server, read once in the browser.
  const supported = useSyncExternalStore(noSubscription, () => engine() !== null, () => false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  function stop() {
    recognition.current?.stop();
  }

  function toggle() {
    if (listening) return stop();
    const Engine = engine();
    const input = box.current;
    if (!Engine || !input) return;

    const heard = new Engine();
    heard.lang = navigator.language || "sv-SE";
    heard.interimResults = true;
    heard.continuous = false;
    const before = input.value ? `${input.value.trimEnd()} ` : "";
    heard.onresult = (event) => {
      let words = "";
      for (let index = 0; index < event.results.length; index += 1) words += event.results[index][0].transcript;
      input.value = before + words;
      setHasText(Boolean(input.value.trim()));
    };
    heard.onend = () => {
      setListening(false);
      recognition.current = null;
      input.focus();
    };
    heard.onerror = () => setListening(false);
    recognition.current = heard;
    setListening(true);
    heard.start();
  }

  return { supported, listening, toggle, stop };
}

const noSubscription = () => () => {};

function engine(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
