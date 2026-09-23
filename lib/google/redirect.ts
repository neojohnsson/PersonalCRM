/** Where Google sends the browser back to after the Gmail consent screen. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/**
 * The full callback address, on whatever address the app is running:
 *
 *   http://localhost:3000/api/auth/google/callback
 *   https://personal-crm-git-slice-1-sync-….vercel.app/api/auth/google/callback
 *   https://personal-crm-delta-lemon.vercel.app/api/auth/google/callback
 *
 * Built from the request instead of a GOOGLE_REDIRECT_URI setting, because
 * that setting has to differ for every address — and on 2026-09-15 a preview
 * build picked up the Production value and sent Google back to the wrong app.
 *
 * Still safe: Google only redirects to addresses listed under Authorised
 * redirect URIs in Google Cloud, so a request can't steer it anywhere else.
 * The consent route and the callback must send the exact same value, which
 * is why both call this.
 */
export function googleCallbackUrl(request: { url: string }): string {
  return new URL(GOOGLE_CALLBACK_PATH, request.url).toString();
}

/**
 * The same thing for the calendar's own consent (slice 8a). A separate path, so
 * the two connections can never be mistaken for each other on the way back —
 * and so revoking one leaves the other alone.
 *
 * This path also has to be listed under Authorised redirect URIs in Google
 * Cloud, for every address the app runs on, exactly like the Gmail one.
 */
export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/auth/google/calendar/callback";

export function googleCalendarCallbackUrl(request: { url: string }): string {
  return new URL(GOOGLE_CALENDAR_CALLBACK_PATH, request.url).toString();
}

/**
 * Where the calendar's consent sends you back to (2026-09-23).
 *
 * 8a only had the Connect page, so the callback always went there. 8b added a
 * "Connect your calendar" button to the Calendar page, and pressing it landed
 * you on /connect?calendar=connected — a page you had not been on, about Gmail
 * as much as the calendar. Now the button says where it lives, and you go back
 * to it.
 *
 * An ALLOWLIST, not a path taken from the form. A return address that came from
 * the request would be an open redirect: anyone could craft a form that sends a
 * signed-in person through Google's real consent screen and on to a site of
 * their choosing. Two literal pages, and anything else is the Connect page.
 */
export const CALENDAR_RETURN_PAGES = ["/calendar", "/connect"] as const;
export type CalendarReturnPage = (typeof CALENDAR_RETURN_PAGES)[number];

export function calendarReturnPage(value: unknown): CalendarReturnPage {
  return CALENDAR_RETURN_PAGES.find((page) => page === value) ?? "/connect";
}

/** The cookie that carries it across Google's screen, beside the state cookie. */
export const CALENDAR_RETURN_COOKIE = "google_calendar_return_to";
