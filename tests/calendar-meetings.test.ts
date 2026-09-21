import { describe, expect, it } from "vitest";
import { MAX_GUESTS, meetingRows, meetingsFrom } from "@/lib/calendar/meetings";
import type { GoogleEvent } from "@/lib/google/calendar";

/**
 * Which events count as a meeting with a contact
 * (docs/slice-8-plan.md, Part 2).
 *
 * Every rule here errs the same way: only count a meeting that really was two
 * people meeting. plan.md §5.3 warns that "warmth scores misread reality", and
 * a score inflated by webinars and declined invitations would be wrong in the
 * direction nobody thinks to check.
 */

const KARIN = "contact-karin";
const JOHAN = "contact-johan";

const contacts = new Map([
  ["karin@fortnox.se", KARIN],
  ["johan@atea.se", JOHAN],
]);

const event = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "evt-1",
  status: "confirmed",
  start: { dateTime: "2026-09-22T09:00:00Z" },
  end: { dateTime: "2026-09-22T10:00:00Z" },
  attendees: [
    { email: "me@example.se", self: true, responseStatus: "accepted" },
    { email: "karin@fortnox.se", responseStatus: "accepted" },
  ],
  ...over,
});

const guests = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ email: `person${i}@example.com` }));

describe("meetingsFrom", () => {
  it("counts a meeting with a contact", () => {
    const { meetings, skipped } = meetingsFrom([event()], contacts);

    expect(skipped).toEqual({});
    expect(meetings).toEqual([
      {
        eventId: "evt-1",
        contactIds: [KARIN],
        startedAt: new Date("2026-09-22T09:00:00Z"),
        endedAt: new Date("2026-09-22T10:00:00Z"),
        accepted: true,
      },
    ]);
  });

  it("counts one meeting for each contact who was there", () => {
    const withBoth = event({
      attendees: [
        { email: "me@example.se", self: true },
        { email: "karin@fortnox.se" },
        { email: "johan@atea.se" },
        { email: "astranger@example.com" },
      ],
    });

    const { meetings } = meetingsFrom([withBoth], contacts);
    expect(meetings[0].contactIds).toEqual([KARIN, JOHAN]);

    // And the table gets a row each: it is a fact about both of them.
    expect(meetingRows("user-1", meetings)).toHaveLength(2);
  });

  it("ignores an event with more guests than a meeting has", () => {
    const small = event({
      id: "evt-small",
      attendees: [{ email: "me@example.se", self: true }, { email: "karin@fortnox.se" }, ...guests(MAX_GUESTS - 2)],
    });
    const webinar = event({
      id: "evt-webinar",
      attendees: [{ email: "me@example.se", self: true }, { email: "karin@fortnox.se" }, ...guests(MAX_GUESTS)],
    });

    const { meetings, skipped } = meetingsFrom([small, webinar], contacts);

    expect(meetings.map((meeting) => meeting.eventId)).toEqual(["evt-small"]);
    expect(skipped).toEqual({ too_many_guests: 1 });
  });

  it("ignores a meeting you declined", () => {
    const declined = event({
      attendees: [
        { email: "me@example.se", self: true, responseStatus: "declined" },
        { email: "karin@fortnox.se", responseStatus: "accepted" },
      ],
    });

    const { meetings, skipped } = meetingsFrom([declined], contacts);

    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ declined: 1 });
  });

  it("counts a maybe, and an invitation you never answered", () => {
    const tentative = event({
      id: "evt-maybe",
      attendees: [
        { email: "me@example.se", self: true, responseStatus: "tentative" },
        { email: "karin@fortnox.se" },
      ],
    });
    const unanswered = event({
      id: "evt-silent",
      attendees: [{ email: "me@example.se", self: true }, { email: "karin@fortnox.se" }],
    });

    const { meetings } = meetingsFrom([tentative, unanswered], contacts);

    // As far as this app can tell, both are people who turned up.
    expect(meetings.map((meeting) => meeting.accepted)).toEqual([true, true]);
  });

  it("ignores a cancelled event, so it stops counting when it is called off", () => {
    const { meetings, skipped } = meetingsFrom([event({ status: "cancelled" })], contacts);

    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ cancelled: 1 });
  });

  it("ignores an all-day entry, which is leave or a birthday, not a meeting", () => {
    const allDay = event({ start: { date: "2026-09-22" }, end: { date: "2026-09-23" } });

    const { meetings, skipped } = meetingsFrom([allDay], contacts);

    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ all_day: 1 });
  });

  it("ignores an event with nobody you know in it", () => {
    const strangers = event({
      attendees: [{ email: "me@example.se", self: true }, { email: "nobody@example.com" }],
    });

    const { meetings, skipped } = meetingsFrom([strangers], contacts);

    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ nobody_you_know: 1 });
  });

  it("ignores an event with no guests at all — focus time is not a meeting", () => {
    const alone = event({ attendees: undefined });

    const { meetings, skipped } = meetingsFrom([alone], contacts);

    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ nobody_you_know: 1 });
  });

  it("matches an address however it was capitalised in the invitation", () => {
    const shouty = event({
      attendees: [{ email: "me@example.se", self: true }, { email: "  Karin@Fortnox.SE " }],
    });

    const { meetings } = meetingsFrom([shouty], contacts);
    expect(meetings[0].contactIds).toEqual([KARIN]);
  });

  it("ignores an event with no usable times", () => {
    const broken = event({ start: {}, end: {} });

    const { meetings, skipped } = meetingsFrom([broken], contacts);
    expect(meetings).toEqual([]);
    expect(skipped).toEqual({ no_times: 1 });
  });

  it("counts the same person once when they are invited twice", () => {
    const twice = event({
      attendees: [
        { email: "me@example.se", self: true },
        { email: "karin@fortnox.se" },
        { email: "Karin@fortnox.se" },
      ],
    });

    const { meetings } = meetingsFrom([twice], contacts);
    expect(meetings[0].contactIds).toEqual([KARIN]);
  });
});
