/**
 * The Gmail permissions the app asks for, and what each one allows it to do
 * (docs/slice-5a-plan.md, Part 1).
 *
 *   gmail.readonly  read mail — the sync and summaries. Required.
 *   gmail.compose   create drafts — Draft reply. Optional: Google's consent
 *                   screen lets you untick it, and everything else still works.
 *
 * gmail.compose also permits sending. The app has no code that sends; a test
 * checks for it (tests/no-send.test.ts), and the Connect page says so.
 */

export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

/** What the consent request asks for, space-separated as Google expects. */
export const REQUESTED_SCOPES = [GMAIL_READONLY, GMAIL_COMPOSE].join(" ");

/** Google's space-separated `scope` reply as a list, each once. */
export function parseGrantedScopes(scope: string | undefined): string[] {
  return [...new Set((scope ?? "").split(/\s+/).filter(Boolean))];
}

export function canRead(scopes: string[]): boolean {
  return scopes.includes(GMAIL_READONLY);
}

export function canDraft(scopes: string[]): boolean {
  return scopes.includes(GMAIL_COMPOSE);
}
