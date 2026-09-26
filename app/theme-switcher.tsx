"use client";

import { useEffect, useState } from "react";
import { THEME_COLOR } from "@/lib/theme";

// Studio was removed 2026-09-25 (UI quality pass): it was Paper with another
// accent. Someone who had chosen it is back on Paper.
export type Theme = "paper" | "night";

const THEMES: { value: Theme; label: string; description: string }[] = [
  { value: "paper", label: "Paper", description: "Warm and focused" },
  { value: "night", label: "Night", description: "Dark graphite and coral" },
];

const STORAGE_KEY = "personal-crm-theme";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    setOpen(false);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Choose theme"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex size-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-chip"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="size-[17px]">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-line bg-white p-1.5 shadow-[0_8px_24px_rgba(20,20,25,.14)]">
          <p className="px-3 pb-1.5 pt-2 text-2xs font-bold tracking-[0.07em] text-ink-meta uppercase">Appearance</p>
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              onClick={() => choose(option.value)}
              // The chosen theme: a tinted row and a tick (UI quality pass,
              // milestone 6). A 4px dot at the far edge was easy to miss, and
              // Paper, first and bold, looked chosen whichever one was.
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                theme === option.value ? "bg-chip" : "hover:bg-paper"
              }`}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{option.label}</span>
                <span className="text-xs text-ink-soft">{option.description}</span>
              </span>
              {theme === option.value && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4 shrink-0 text-accent"
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function storedTheme(): Theme {
  if (typeof window === "undefined") return "paper";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "night" ? "night" : "paper";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}
