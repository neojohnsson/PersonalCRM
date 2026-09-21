import "server-only";

/**
 * Reading events from Google Calendar (slice 8a; docs/slice-8-plan.md, Part 2).
 *
 * The important line in this file is FIELDS. Google only sends back the fields
 * asked for, so "this app never reads event descriptions" is not a policy that
 * code has to be trusted to keep — the description is never in the response at
 * all. Titles are not asked for either: nothing in 8a needs one, and the page
 * in 8b reads them live when it draws the week.
 *
 * Read-only throughout. There is no function here that writes, and
 * tests/calendar-scopes.test.ts fails if one appears.
 */

/**
 * What comes back per event. No summary, no description, no location, no
 * attachments, no conferencing links.
 *
 *   id                  Google's event id, so the same event read twice is one
 *                       meeting
 *   status              "cancelled" events still come back and must be dropped
 *   start, end          dateTime for a real meeting; date for an all-day entry
 *   attendees           email, whether that attendee is you, and their answer
 *   organizer           who called it — you, when there are no attendees listed
 */
const FIELDS =
  "nextPageToken,items(id,status,start(dateTime,date),end(dateTime,date),attendees(email,self,responseStatus),organizer(email,self))";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** One page of events; Google's maximum is 2500 and the default is 250. */
const PAGE_SIZE = 250;

/** A safety net: a calendar this busy means something is wrong with the window. */
const MAX_PAGES = 12;

export type GoogleAttendee = {
  email?: string;
  self?: boolean;
  responseStatus?: string;
};

export type GoogleEvent = {
  id?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; self?: boolean };
};

/**
 * Google refused the read, with what it said about why.
 *
 * The message is carried rather than flattened to "it failed" because the
 * useful cases are all indistinguishable otherwise: the Calendar API not
 * enabled in the Cloud project (403), a permission that was withdrawn (401), a
 * quota (429). The first of those cost an hour on 2026-09-21 precisely because
 * the reason was thrown away.
 */
export class CalendarReadFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
  }
}

/**
 * Every event between two moments, following Google's paging.
 *
 * `singleEvents` expands a repeating event into the individual meetings it
 * actually is — without it, a weekly one-to-one comes back as one row with a
 * recurrence rule, and "when did we last meet" would be unanswerable.
 */
export async function listEvents(
  accessToken: string,
  window: { from: Date; to: Date },
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(EVENTS_URL);
    url.searchParams.set("timeMin", window.from.toISOString());
    url.searchParams.set("timeMax", window.to.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    url.searchParams.set("fields", FIELDS);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body: { error?: { message?: string; status?: string } } = await response
        .json()
        .catch(() => ({}));
      const said = body.error?.message ?? response.statusText;
      throw new CalendarReadFailed(
        `Google refused the calendar read (${response.status}): ${said}`,
        response.status,
        body.error?.status ?? null,
      );
    }

    const body: { items?: GoogleEvent[]; nextPageToken?: string } = await response.json();
    events.push(...(body.items ?? []));

    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return events;
}
