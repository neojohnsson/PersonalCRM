"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Who is signed in, remembered in the browser between pages, for the loading
 * skeleton's frame (app/skeletons.tsx).
 *
 * The skeleton is drawn in the browser the moment a link is pressed, before
 * the server has said anything, so on its own it cannot know whose initials
 * go on the avatar. Until 2026-09-26 it drew the frame without them, and the
 * avatar blinked out on every press and back when the page arrived. Now the
 * real frame (AppShell) leaves the address here, and the skeleton reads it.
 *
 * Only ever written in the browser: an effect never runs on the server, and
 * the server's answer below is always "nobody". That matters, because this
 * variable lives in a module, and on the server one module is shared by
 * every person's request -- the one place it must never hold an address.
 */

let remembered: string | undefined;
const listeners = new Set<() => void>();

/** Exported for tests/shell-memory.test.ts; the app calls it through RememberEmail. */
export function rememberEmail(email: string | undefined) {
  if (!email || email === remembered) return;
  remembered = email;
  for (const listener of listeners) listener();
}

/** Drawn by AppShell on every signed-in page. Draws nothing itself. */
export function RememberEmail({ email }: { email: string | undefined }) {
  useEffect(() => rememberEmail(email), [email]);
  return null;
}

/** The address the last real page was drawn for, or undefined before there was one. */
export function useRememberedEmail(): string | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => remembered,
    // On the server, and while the first page is hydrated: nobody.
    () => undefined,
  );
}
