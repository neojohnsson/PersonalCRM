"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * The line that appears at the foot of the screen after you press something,
 * with Undo on it (docs/slice-9b-plan.md, Part 3).
 *
 * Five actions changed or threw away something with one click and no way back:
 * Conversation done, Skip, Snooze, Discard a draft, and turning reminders off.
 * Every one of them was already reversible — slice 6c built them that way, and
 * a settle is one row, a next touch one column. Nothing here adds a new
 * mechanism; it surfaces what was always possible, because "you can undo this
 * from the contact page" is no use to somebody who didn't mean to press it.
 *
 * No design covers a toast. It is the app's own dark pill — the sidebar's
 * #17181a with white text — sitting above the mobile bottom bar so it never
 * covers the navigation.
 *
 * One at a time, on purpose. Two undos on screen at once is a question nobody
 * wants: which one am I undoing? A second press replaces the first, and the
 * first's `onExpire` runs as it leaves, so whatever it was waiting to do still
 * happens.
 */

export const TOAST_SECONDS = 8;

export type ToastAction = {
  label: string;
  /** Usually a Server Action. Its errors land in the toast, not the console. */
  run: () => Promise<void>;
};

export type ToastInput = {
  message: string;
  action?: ToastAction;
  /**
   * Run when the toast goes away on its own or is closed by hand — but NOT
   * when the action was used. This is how a list waits before it moves: the
   * row stays where it was until the undo is out of reach, and only then does
   * the page refresh and the row leave.
   */
  onExpire?: () => void;
  seconds?: number;
};

type Shown = ToastInput & { id: number; state: "open" | "running" | "undone"; error: string | null };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

/** Show a toast. Available to anything rendered inside the app shell. */
export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The expiry of whatever is on screen, so replacing a toast can still run it.
  const expiring = useRef<(() => void) | null>(null);
  const nextId = useRef(0);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(
    (runExpire: boolean) => {
      clear();
      const expire = expiring.current;
      expiring.current = null;
      setToast(null);
      if (runExpire) expire?.();
    },
    [clear],
  );

  const show = useCallback(
    (input: ToastInput) => {
      // Whatever was there is leaving: let it finish what it was waiting for.
      clear();
      expiring.current?.();
      expiring.current = input.onExpire ?? null;

      const id = ++nextId.current;
      setToast({ ...input, id, state: "open", error: null });
      timer.current = setTimeout(() => close(true), (input.seconds ?? TOAST_SECONDS) * 1000);
    },
    [clear, close],
  );

  // Nothing should fire after this leaves the page.
  useEffect(() => () => clear(), [clear]);

  const runAction = async () => {
    if (!toast?.action || toast.state !== "open") return;
    clear();
    setToast((current) => (current ? { ...current, state: "running", error: null } : current));
    try {
      await toast.action.run();
    } catch {
      setToast((current) =>
        current ? { ...current, state: "open", error: "That didn't work. The page will say how things stand." } : current,
      );
      timer.current = setTimeout(() => close(true), TOAST_SECONDS * 1000);
      return;
    }
    // The action put things back itself, so the waiting work must not run.
    expiring.current = null;
    setToast((current) => (current ? { ...current, state: "undone" } : current));
    timer.current = setTimeout(() => close(false), 1600);
  };

  return (
    <ToastContext.Provider value={show}>
      {children}

      {/* Always in the page, so a screen reader announces into a region that
          was already there rather than one that just appeared. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 max-sm:bottom-[86px]"
      >
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex max-w-[min(520px,100%)] items-center gap-3 rounded-[14px] bg-ink-deep px-[18px] py-3 shadow-[0_4px_16px_rgba(20,20,25,.22)]"
          >
            <span className="text-[13px] font-medium text-white">
              {toast.state === "undone" ? "Undone." : (toast.error ?? toast.message)}
            </span>

            {toast.action && toast.state !== "undone" && (
              <button
                type="button"
                onClick={runAction}
                disabled={toast.state === "running"}
                className="shrink-0 rounded-full border border-white/25 px-[13px] py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
              >
                {toast.state === "running" ? "Undoing…" : toast.error ? "Try again" : toast.action.label}
              </button>
            )}

            <button
              type="button"
              onClick={() => close(true)}
              aria-label={toast.error ? "Dismiss error message" : "Dismiss undo message"}
              className="shrink-0 text-ink-ghost transition-colors hover:text-white"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-[15px]">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
