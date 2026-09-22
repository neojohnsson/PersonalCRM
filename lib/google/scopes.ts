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
 * The calendar permissions (slice 8a; slice 10 added the write).
 *
 *   calendar.events.readonly  "View events on all your calendars" — the
 *                             narrowest scope that gives an event with its
 *                             guest list, which is what matches a meeting to a
 *                             contact. calendar.readonly would also grant
 *                             calendar properties and structure this app has no
 *                             use for.
 *   calendar.events           "View and edit events on all your calendars" —
 *                             added in slice 10 so the app can create one.
 *                             Optional: Google's screen lets you untick it,
 *                             and everything built before slice 10 still works
 *                             without it.
 *   userinfo.email            which Google account the calendar belongs to, so
 *                             the page can say so. It can be a different
 *                             account from the connected Gmail.
 *
 * **Slice 8a said there would never be a write scope here.** That was reversed
 * on the user's request on 2026-09-22 (docs/slice-10-plan.md), and this comment
 * is part of the correction rather than a line quietly edited: the app asks to
 * create events now, and "a suggestion, never a silent calendar entry"
 * (plan.md §3.4) holds because nothing is created without a press.
 *
 * The narrower alternative was calendar.app.created, which can only touch a
 * calendar the app made itself. The user chose events on their own calendar,
 * knowing what that grants (the plan states it in those words):
 * **calendar.events also permits changing and deleting any event.** No code
 * here does either, and tests/calendar-scopes.test.ts fails if that changes —
 * the same shape of trust as gmail.compose, which also permits sending.
 *
 * Asked for separately from Gmail's, on its own consent screen: granting the
 * calendar must not touch Gmail, and revoking it must not break the sync.
 */
export const CALENDAR_EVENTS_READONLY = "https://www.googleapis.com/auth/calendar.events.readonly";
export const CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";
export const USERINFO_EMAIL = "https://www.googleapis.com/auth/userinfo.email";

export const REQUESTED_CALENDAR_SCOPES = [
  CALENDAR_EVENTS_READONLY,
  CALENDAR_EVENTS,
  USERINFO_EMAIL,
].join(" ");

export function canReadCalendar(scopes: string[]): boolean {
  return scopes.includes(CALENDAR_EVENTS_READONLY);
}

/**
 * Whether Google granted permission to create an event.
 *
 * A connection made before slice 10 has only the read scope, so this is false
 * until the calendar is connected again — which is why the Create buttons are
 * absent rather than broken, and the calendar page says one line about it.
 */
export function canWriteCalendar(scopes: string[]): boolean {
  return scopes.includes(CALENDAR_EVENTS);
}

/**
 * The calendar write scopes this app must never ask for — every one Google has
 * except the `calendar.events` above.
 *
 * `calendar` and `calendar.calendars` would let it make and delete whole
 * calendars; `calendar.acls` would let it change who can see them;
 * `calendar.app.created` is narrower than what was chosen but unused, and
 * asking for a scope nothing uses is its own kind of lie.
 */
export const CALENDAR_FORBIDDEN_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.acls",
] as const;
