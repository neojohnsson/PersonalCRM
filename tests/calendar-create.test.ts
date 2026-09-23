import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarWriteFailed, createEvent } from "@/lib/google/calendar-create";

/**
 * Creating an event (slice 10; docs/slice-10-plan.md).
 *
 * Google is faked, and the tests that matter read what was SENT. "No guests,
 * ever" is a fact about the request body here, not a promise about the code —
 * the same method as tests/calendar-read.test.ts, where the URL proves no
 * description was ever asked for.
 */

type Sent = { url: string; method: string; body: Record<string, unknown> };

/** Catches the one request and answers as Google does. */
function fakeGoogle(answer: { status?: number; body?: unknown } = {}) {
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://www.googleapis.com/calendar/v3/")) {
        sent.push({
          url,
          method: String(init?.method ?? "GET"),
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        const status = answer.status ?? 200;
        const payload = answer.body ?? { id: "evt_1", htmlLink: "https://calendar.google.com/event?eid=abc" };
        return status === 200
          ? Response.json(payload)
          : new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
      }
      return realFetch(input, init);
    }),
  );

  return sent;
}

const event = {
  title: "Thesis timeline — Karin Lindqvist",
  startsAt: "2026-09-29T14:00:00+02:00",
  endsAt: "2026-09-29T14:30:00+02:00",
  timeZone: "Europe/Stockholm",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what Google is sent", () => {
  it("is one POST to the primary calendar, with nobody notified", async () => {
    const sent = fakeGoogle();

    await createEvent("ya29.fake", event);

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].url).toContain("/calendars/primary/events");
    expect(sent[0].url).toContain("sendUpdates=none");
    // Only the two fields the caller uses come back.
    expect(sent[0].url).toContain("fields=id,htmlLink");
  });

  it("carries no guest, no invitation and no description — the whole point", async () => {
    const sent = fakeGoogle();

    await createEvent("ya29.fake", event);

    const body = sent[0].body;
    expect(Object.keys(body).sort()).toEqual(["end", "start", "summary"]);
    // A guest list makes Google email an invitation to each guest, which is
    // the app causing mail to reach a person (AGENTS.md's send rule).
    expect(JSON.stringify(body)).not.toMatch(/attendee/i);
    expect(JSON.stringify(body)).not.toMatch(/description/i);
    expect(sent[0].url).not.toMatch(/sendUpdates=(all|externalOnly)/i);
  });

  it("sends the times as given, with the zone beside them", async () => {
    const sent = fakeGoogle();

    await createEvent("ya29.fake", event);

    expect(sent[0].body).toEqual({
      summary: "Thesis timeline — Karin Lindqvist",
      start: { dateTime: "2026-09-29T14:00:00+02:00", timeZone: "Europe/Stockholm" },
      end: { dateTime: "2026-09-29T14:30:00+02:00", timeZone: "Europe/Stockholm" },
    });
  });

  it("sends the token as a bearer and nothing else about you", async () => {
    const sent = fakeGoogle();
    await createEvent("ya29.fake", event);
    expect(sent[0].url).not.toContain("ya29.fake");
  });
});

describe("what comes back", () => {
  it("is the id and the link to the event", async () => {
    fakeGoogle({ body: { id: "evt_9", htmlLink: "https://calendar.google.com/event?eid=xyz" } });

    expect(await createEvent("ya29.fake", event)).toEqual({
      id: "evt_9",
      htmlLink: "https://calendar.google.com/event?eid=xyz",
    });
  });

  it("copes with a reply that has no link", async () => {
    fakeGoogle({ body: { id: "evt_9" } });
    expect(await createEvent("ya29.fake", event)).toEqual({ id: "evt_9", htmlLink: null });
  });

  it("carries Google's own status and message when it refuses", async () => {
    // Slice 8b lost a day to a calendar read that swallowed its own error.
    fakeGoogle({ status: 403, body: "Request had insufficient authentication scopes." });

    const failure = await createEvent("ya29.fake", event).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalendarWriteFailed);
    expect((failure as CalendarWriteFailed).status).toBe(403);
    expect((failure as CalendarWriteFailed).message).toContain("403");
    expect((failure as CalendarWriteFailed).message).toContain("insufficient authentication scopes");
  });

  it("refuses a success with no event in it", async () => {
    fakeGoogle({ body: { htmlLink: "https://calendar.google.com/event?eid=abc" } });

    await expect(createEvent("ya29.fake", event)).rejects.toBeInstanceOf(CalendarWriteFailed);
  });
});
