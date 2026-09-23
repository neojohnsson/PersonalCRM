/**
 * What to say after the calendar's own consent, which is not an error
 * (slice 8a). Shared by the Connect page and the Calendar page, because since
 * 2026-09-23 you come back to whichever one you started on.
 *
 * Fixed messages only, looked up by key: anyone can make a link to
 * ?calendar=anything, and a page must never print what a link tells it to.
 */
export const CALENDAR_NOTES: Record<string, string> = {
  connected: "Your calendar is connected, and the last three months have been read.",
  unread: "Your calendar is connected, but reading it didn't finish. Press Read my calendar.",
};
