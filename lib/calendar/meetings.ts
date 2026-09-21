import type { GoogleEvent } from "@/lib/google/calendar";

/**
 * Which events count as a meeting with a contact
 * (docs/slice-8-plan.md, Part 2 and the three answered questions).
 *
 * Pure: events in, meetings out. No database, no Google, so every rule below is
 * tested without a network or a migration.
 *
 * The rules all point the same way — a meeting only counts when it really was
 * two people meeting. Warmth is the thing most likely to be quietly wrong
 * (plan.md §5.3: "Warmth scores misread reality"), and a score inflated by
 * webinars and declined invitations would be wrong in the direction nobody
 * thinks to check.
 */

/**
 * More guests than this and it is an event, not a meeting with somebody.
 * Decided 2026-09-20: eight covers a coffee, a client call and a small
 * workshop, and leaves out lectures, standups and webinars, where being in the
 * room says nothing about a relationship.
 */
export const MAX_GUESTS = 8;

export type Meeting = {
  eventId: string;
  /** Every contact who was a guest. One event can be a fact about two people. */
  contactIds: string[];
  startedAt: Date;
  endedAt: Date;
  /** Whether *you* accepted. A meeting you declined is not contact. */
  accepted: boolean;
};

export type SkipReason =
  | "cancelled"
  | "all_day"
  | "no_times"
  | "too_many_guests"
  | "declined"
  | "nobody_you_know";

export type Meetings = {
  meetings: Meeting[];
  /** Counted, so "it found nothing" can be explained without guessing. */
  skipped: Partial<Record<SkipReason, number>>;
};

/**
 * `addressToContact` maps a lowercased email address to a contact id — the same
 * matching the mail sync uses, so a person is the same person in both.
 */
export function meetingsFrom(
  events: GoogleEvent[],
  addressToContact: Map<string, string>,
): Meetings {
  const meetings: Meeting[] = [];
  const skipped: Meetings["skipped"] = {};
  const skip = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const event of events) {
    if (!event.id) continue;

    // A cancelled event still comes back when a window is re-read.
    if (event.status === "cancelled") {
      skip("cancelled");
      continue;
    }

    // An all-day entry is a holiday, a birthday or someone's leave, not a
    // meeting: Google gives it `date` instead of `dateTime`.
    if (event.start?.date || event.end?.date) {
      skip("all_day");
      continue;
    }

    const startedAt = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const endedAt = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    if (!startedAt || !endedAt || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      skip("no_times");
      continue;
    }

    const attendees = event.attendees ?? [];

    // The cap counts everybody invited, including you: what makes a webinar a
    // webinar is the size of the room, not how many of them you know.
    if (attendees.length > MAX_GUESTS) {
      skip("too_many_guests");
      continue;
    }

    // Your own answer. With no attendee marked `self` — an event you made with
    // no guest list — there is nothing to decline.
    const you = attendees.find((attendee) => attendee.self);
    if (you?.responseStatus === "declined") {
      skip("declined");
      continue;
    }

    const contactIds = [
      ...new Set(
        attendees
          .filter((attendee) => !attendee.self && attendee.email)
          .map((attendee) => addressToContact.get(attendee.email!.trim().toLowerCase()))
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (contactIds.length === 0) {
      skip("nobody_you_know");
      continue;
    }

    meetings.push({
      eventId: event.id,
      contactIds,
      startedAt,
      endedAt,
      // Anything but a decline counts: "accepted", "tentative" and no answer
      // at all are all people who turned up as far as this app can tell.
      accepted: you?.responseStatus !== "declined",
    });
  }

  return { meetings, skipped };
}

/** One row per contact per meeting, which is how the table is keyed. */
export function meetingRows(
  userId: string,
  meetings: Meeting[],
): {
  user_id: string;
  contact_id: string;
  event_id: string;
  started_at: string;
  ended_at: string;
  accepted: boolean;
}[] {
  return meetings.flatMap((meeting) =>
    meeting.contactIds.map((contactId) => ({
      user_id: userId,
      contact_id: contactId,
      event_id: meeting.eventId,
      started_at: meeting.startedAt.toISOString(),
      ended_at: meeting.endedAt.toISOString(),
      accepted: meeting.accepted,
    })),
  );
}
