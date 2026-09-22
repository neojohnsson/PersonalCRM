import "server-only";

/**
 * Creating one event in Google Calendar (slice 10; docs/slice-10-plan.md).
 *
 * **This is the only file in the app that writes to a calendar**, and
 * tests/calendar-scopes.test.ts holds that: no other file may POST to the
 * events endpoint, and this one may not mention a guest.
 *
 * Slice 8a said there would never be a write here. The user asked for it on
 * 2026-09-22, and the plan says out loud what that reverses.
 *
 * Three rules, all of them enforced by what this code cannot express rather
 * than by being careful:
 *
 *   No guests, ever.   The body carries no `attendees`, and cannot: the type
 *                      below has no field for one. A guest list makes Google
 *                      email an invitation to each guest, which is the app
 *                      causing mail to reach a person — the thing "No send
 *                      capability… Ever" exists to prevent (AGENTS.md).
 *   Nobody notified.   `sendUpdates=none` on every request as well. Belt and
 *                      braces for a body with no guests in it.
 *   Create only.       One function, one POST. The granted scope also permits
 *                      update and delete; there is no code for either, and
 *                      Google Calendar is one link away for both.
 *
 * Nothing is created without a press — the callers are a form you confirm.
 */

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * What the app may put in an event. Deliberately four fields.
 *
 * No description: the app never reads descriptions (docs/privacy.md), and
 * writing them would be a new claim to make. No location, no conferencing, no
 * recurrence, and — above all — no attendees.
 */
export type NewEvent = {
  /** What it is called. Yours to type; the form prefills a contact's name. */
  title: string;
  /** RFC 3339 with an offset, e.g. 2026-09-29T14:00:00+02:00. */
  startsAt: string;
  endsAt: string;
  /** IANA zone, so Google shows it at the right time wherever you look. */
  timeZone: string;
};

/** What comes back, which is all the page needs to link to it. */
export type CreatedEvent = {
  id: string;
  /** Google's own link to the event, for "open it in Google Calendar". */
  htmlLink: string | null;
};

/** Google refused the write. `status` decides what the page says. */
export class CalendarWriteFailed extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendarWriteFailed";
    this.status = status;
  }
}

/**
 * Put one event on the primary calendar.
 *
 * `fields` asks for the two things the caller uses, so the reply carries
 * nothing else — the same habit as the read side, where it is what makes "this
 * app never reads descriptions" a fact about the response rather than a
 * promise about the code.
 */
export async function createEvent(accessToken: string, event: NewEvent): Promise<CreatedEvent> {
  const url = `${EVENTS_URL}?sendUpdates=none&fields=id,htmlLink`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: event.title,
      start: { dateTime: event.startsAt, timeZone: event.timeZone },
      end: { dateTime: event.endsAt, timeZone: event.timeZone },
    }),
  });

  if (!response.ok) {
    // Google's message, not ours: slice 8b lost a day to a calendar read that
    // swallowed its own error, and this is the same class of bug waiting.
    const detail = await response.text().catch(() => "");
    throw new CalendarWriteFailed(
      response.status,
      `Google wouldn't create the event (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const created: { id?: string; htmlLink?: string } = await response.json();
  if (!created.id) throw new CalendarWriteFailed(response.status, "Google created no event id.");

  return { id: created.id, htmlLink: created.htmlLink ?? null };
}
