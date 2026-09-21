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

/**
 * The calendar permissions (slice 8a; docs/slice-8-plan.md, Part 1).
 *
 *   calendar.events.readonly  "View events on all your calendars" — the
 *                             narrowest scope that gives an event with its
 *                             guest list, which is what matches a meeting to a
 *                             contact. calendar.readonly would also grant
 *                             calendar properties and structure this app has no
 *                             use for.
 *   userinfo.email            which Google account the calendar belongs to, so
 *                             the page can say so. It can be a different
 *                             account from the connected Gmail.
 *
 * There is no calendar write scope here and there never will be: "a suggestion,
 * never a silent calendar entry" (plan.md §3.4). Nothing in this app can create,
 * change or delete an event, because it never asks for permission to.
 *
 * Asked for separately from Gmail's, on its own consent screen: granting the
 * calendar must not touch Gmail, and revoking it must not break the sync.
 */
export const CALENDAR_EVENTS_READONLY = "https://www.googleapis.com/auth/calendar.events.readonly";
export const USERINFO_EMAIL = "https://www.googleapis.com/auth/userinfo.email";

export const REQUESTED_CALENDAR_SCOPES = [CALENDAR_EVENTS_READONLY, USERINFO_EMAIL].join(" ");

export function canReadCalendar(scopes: string[]): boolean {
  return scopes.includes(CALENDAR_EVENTS_READONLY);
}

/** Every write scope Google has for Calendar. None of them may ever be asked for. */
export const CALENDAR_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.acls",
] as const;
