import { describe, expect, it } from "vitest";
import type { Touch } from "@/lib/relationship/touches";
import { BANDS, REPLY_RATE_WINDOW, WEIGHTS, bandOf, warmth } from "@/lib/relationship/warmth";

const NOW = new Date("2026-09-16T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let counter = 0;
function at(direction: "inbound" | "outbound", msAgo: number, thread = "t1"): Touch {
  counter++;
  return {
    messageId: `m${counter}`,
    threadId: thread,
    direction,
    at: new Date(NOW.getTime() - msAgo),
    subject: null,
  };
}

describe("warmth", () => {
  it("has no score for a contact with no mail", () => {
    expect(warmth([], NOW)).toBeNull();
  });

  it("adds up four signals, and returns them with their points", () => {
    // One thread: you wrote 20 days ago, they replied 10 hours later; you wrote
    // again 6 days ago, they replied 2 days later.
    const touches = [
      at("outbound", 20 * DAY),
      at("inbound", 20 * DAY - 10 * HOUR),
      at("outbound", 6 * DAY),
      at("inbound", 4 * DAY),
    ];

    const result = warmth(touches, NOW)!;

    expect(result.signals).toEqual({
      replyRate: { answered: 2, sent: 2 },
      replySpeed: { medianMs: (10 * HOUR + 2 * DAY) / 2, replies: 2 },
      lastContact: { days: 4, from: "them", at: touches[3].at },
      exchanges: { count: 3, since: touches[0].at },
    });

    // 35 × (1 − 4/90) + 30 × 2/2 + 12 (median 29h: within 3 days) + 15 × 3/10
    expect(result.points).toEqual({
      lastContact: 35 * (1 - 4 / 90),
      replyRate: 30,
      replySpeed: 12,
      exchanges: 4.5,
    });
    expect(result.score).toBe(Math.round(35 * (1 - 4 / 90) + 30 + 12 + 4.5));
    expect(result.score).toBe(80);
    expect(result.band).toBe("warm");
  });

  it("gives the same score for the same history, whatever order it arrives in", () => {
    const touches = [at("outbound", 9 * DAY), at("inbound", 8 * DAY), at("outbound", 2 * DAY)];
    expect(warmth([...touches].reverse(), NOW)).toEqual(warmth(touches, NOW));
  });

  describe("last contact", () => {
    it("is worth full points today and nothing after 90 days", () => {
      expect(warmth([at("inbound", 0)], NOW)!.points.lastContact).toBe(WEIGHTS.lastContact);
      expect(warmth([at("inbound", 90 * DAY)], NOW)!.points.lastContact).toBe(0);
      expect(warmth([at("inbound", 200 * DAY)], NOW)!.points.lastContact).toBe(0);
    });

    it("says who wrote last", () => {
      expect(warmth([at("inbound", 5 * DAY), at("outbound", 1 * DAY)], NOW)!.signals.lastContact.from).toBe("you");
    });
  });

  describe("reply rate", () => {
    it("counts a message as answered only by a later message from them in the same thread", () => {
      const result = warmth(
        [
          at("inbound", 30 * DAY, "a"), // before your message: not an answer
          at("outbound", 20 * DAY, "a"),
          at("outbound", 10 * DAY, "b"),
          at("inbound", 9 * DAY, "c"), // a different thread: not an answer
        ],
        NOW,
      )!;

      expect(result.signals.replyRate).toEqual({ answered: 0, sent: 2 });
      expect(result.points.replyRate).toBe(0);
    });

    it("looks only at your last 10 messages", () => {
      const touches: Touch[] = [];
      // 5 old answered messages, then 10 newer unanswered ones, each its own thread.
      for (let i = 0; i < 5; i++) {
        touches.push(at("outbound", (60 - i) * DAY, `old${i}`), at("inbound", (60 - i) * DAY - HOUR, `old${i}`));
      }
      for (let i = 0; i < REPLY_RATE_WINDOW; i++) touches.push(at("outbound", (20 - i) * DAY, `new${i}`));

      expect(warmth(touches, NOW)!.signals.replyRate).toEqual({ answered: 0, sent: REPLY_RATE_WINDOW });
    });

    it("is worth nothing when you never wrote to them", () => {
      const result = warmth([at("inbound", 3 * DAY)], NOW)!;
      expect(result.signals.replyRate).toEqual({ answered: 0, sent: 0 });
      expect(result.points.replyRate).toBe(0);
    });
  });

  describe("reply speed", () => {
    function speed(delay: number) {
      return warmth([at("outbound", 50 * DAY), at("inbound", 50 * DAY - delay)], NOW)!.points.replySpeed;
    }

    it("steps down from within a day to within a week, then nothing", () => {
      expect(speed(23 * HOUR)).toBe(20);
      expect(speed(1 * DAY)).toBe(20);
      expect(speed(2 * DAY)).toBe(12);
      expect(speed(3 * DAY)).toBe(12);
      expect(speed(5 * DAY)).toBe(6);
      expect(speed(7 * DAY)).toBe(6);
      expect(speed(8 * DAY)).toBe(0);
    });

    it("uses the median, so one slow reply doesn't drag a quick replier down", () => {
      const touches = [
        at("outbound", 40 * DAY, "a"), at("inbound", 40 * DAY - 2 * HOUR, "a"),
        at("outbound", 30 * DAY, "b"), at("inbound", 30 * DAY - 3 * HOUR, "b"),
        at("outbound", 20 * DAY, "c"), at("inbound", 20 * DAY - 14 * DAY, "c"),
      ];
      const result = warmth(touches, NOW)!;

      expect(result.signals.replySpeed).toEqual({ medianMs: 3 * HOUR, replies: 3 });
      expect(result.points.replySpeed).toBe(20);
    });

    it("is worth nothing when they never replied", () => {
      const result = warmth([at("outbound", 5 * DAY)], NOW)!;
      expect(result.signals.replySpeed).toEqual({ medianMs: null, replies: 0 });
      expect(result.points.replySpeed).toBe(0);
    });

    it("times a reply from your latest message before it, not your first", () => {
      const result = warmth(
        [at("outbound", 10 * DAY), at("outbound", 3 * DAY), at("inbound", 3 * DAY - 5 * HOUR)],
        NOW,
      )!;
      expect(result.signals.replySpeed.medianMs).toBe(5 * HOUR);
    });
  });

  describe("exchanges", () => {
    it("counts changes of direction inside each thread, never across threads", () => {
      const result = warmth(
        [
          at("outbound", 30 * DAY, "a"),
          at("inbound", 29 * DAY, "b"), // other thread: no change counted
          at("outbound", 28 * DAY, "a"),
          at("inbound", 27 * DAY, "a"), // a: out, out, in → 1
          at("outbound", 26 * DAY, "b"), // b: in, out → 1
        ],
        NOW,
      )!;

      expect(result.signals.exchanges.count).toBe(2);
    });

    it("stops adding points at 10", () => {
      const touches: Touch[] = [];
      for (let i = 0; i < 30; i++) touches.push(at(i % 2 === 0 ? "outbound" : "inbound", (80 - i) * DAY));

      const result = warmth(touches, NOW)!;
      expect(result.signals.exchanges.count).toBe(29);
      expect(result.points.exchanges).toBe(WEIGHTS.exchanges);
    });
  });
});

describe("bandOf", () => {
  it("is warm from 60, cooling from 35, cold below", () => {
    expect(bandOf(BANDS.warm)).toBe("warm");
    expect(bandOf(BANDS.warm - 1)).toBe("cooling");
    expect(bandOf(BANDS.cooling)).toBe("cooling");
    expect(bandOf(BANDS.cooling - 1)).toBe("cold");
    expect(bandOf(0)).toBe("cold");
  });
});
