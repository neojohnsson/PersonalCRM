import { describe, expect, it } from "vitest";
import { touchesByContact, type StoredMessage, type Touch } from "@/lib/relationship/touches";
import { GOING_QUIET_DAYS, OPEN_THREAD_DAYS, compareTurns, whoseTurn, type Turn } from "@/lib/relationship/whose-turn";

const NOW = new Date("2026-09-16T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function touch(direction: "inbound" | "outbound", daysAgo: number, thread = "t1", subject: string | null = "Hej"): Touch {
  return {
    messageId: `${thread}-${direction}-${daysAgo}`,
    threadId: thread,
    direction,
    at: new Date(NOW.getTime() - daysAgo * DAY),
    subject,
  };
}

describe("whoseTurn", () => {
  it("is no mail yet for a contact with no touches", () => {
    expect(whoseTurn([], NOW)).toEqual({ kind: "none" });
  });

  it("is your turn when they wrote last, with how long they've waited", () => {
    const turn = whoseTurn([touch("outbound", 10), touch("inbound", 6, "t1", "Examensarbete")], NOW);

    expect(turn).toMatchObject({ kind: "yours", days: 6, threadId: "t1", subject: "Examensarbete" });
  });

  it("is their turn when you wrote last", () => {
    expect(whoseTurn([touch("inbound", 9), touch("outbound", 4)], NOW)).toMatchObject({
      kind: "theirs",
      days: 4,
      goingQuiet: false,
    });
  });

  it("goes quiet after more than 14 days of their turn", () => {
    expect(whoseTurn([touch("outbound", GOING_QUIET_DAYS)], NOW)).toMatchObject({ goingQuiet: false });
    expect(whoseTurn([touch("outbound", GOING_QUIET_DAYS + 1)], NOW)).toMatchObject({
      kind: "theirs",
      goingQuiet: true,
    });
  });

  it("closes the thread when the latest touch is more than 30 whole days old", () => {
    expect(whoseTurn([touch("inbound", OPEN_THREAD_DAYS)], NOW)).toMatchObject({ kind: "yours", days: 30 });
    expect(whoseTurn([touch("inbound", OPEN_THREAD_DAYS + 1)], NOW)).toMatchObject({ kind: "closed", days: 31 });
    expect(whoseTurn([touch("outbound", 120)], NOW)).toMatchObject({ kind: "closed", days: 120 });
  });

  it("uses the latest touch whatever order the touches come in", () => {
    expect(whoseTurn([touch("inbound", 2), touch("outbound", 20)], NOW)).toMatchObject({ kind: "yours", days: 2 });
  });

  it("counts part of a day as no whole day", () => {
    const earlierToday = { ...touch("inbound", 0), at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) };
    expect(whoseTurn([earlierToday], NOW)).toMatchObject({ kind: "yours", days: 0 });
  });
});

describe("compareTurns", () => {
  it("orders your turn (longest wait first), their turn (longest silence first), closed (most recent first), then no mail", () => {
    const turns: [string, Turn][] = [
      ["none", whoseTurn([], NOW)],
      ["closed-90", whoseTurn([touch("inbound", 90)], NOW)],
      ["theirs-3", whoseTurn([touch("outbound", 3)], NOW)],
      ["yours-2", whoseTurn([touch("inbound", 2)], NOW)],
      ["closed-40", whoseTurn([touch("outbound", 40)], NOW)],
      ["theirs-20", whoseTurn([touch("outbound", 20)], NOW)],
      ["yours-11", whoseTurn([touch("inbound", 11)], NOW)],
    ];

    const ordered = [...turns].sort((a, b) => compareTurns(a[1], b[1])).map(([label]) => label);

    expect(ordered).toEqual(["yours-11", "yours-2", "theirs-20", "theirs-3", "closed-40", "closed-90", "none"]);
  });
});

describe("touchesByContact", () => {
  function message(
    id: string,
    fields: Partial<StoredMessage> & Pick<StoredMessage, "direction" | "from_email">,
  ): StoredMessage {
    return {
      gmail_message_id: id,
      thread_id: "t1",
      internal_date: "2026-09-10T09:00:00Z",
      to_emails: [],
      cc_emails: [],
      subject: null,
      ...fields,
    };
  }

  const addresses = [
    { contact_id: "karin", email: "karin@fortnox.se" },
    { contact_id: "karin", email: "karin.l@gmail.com" },
    { contact_id: "johan", email: "johan@example.se" },
  ];

  it("counts mail from any of a contact's addresses, and mail you sent to or Cc'd them", () => {
    const touches = touchesByContact(
      [
        message("from-work", { direction: "inbound", from_email: "Karin@Fortnox.se", internal_date: "2026-09-01T09:00:00Z" }),
        message("to-gmail", { direction: "outbound", from_email: "me@x.se", to_emails: ["karin.l@gmail.com"], internal_date: "2026-09-03T09:00:00Z" }),
        message("cc-work", { direction: "outbound", from_email: "me@x.se", to_emails: ["boss@x.se"], cc_emails: ["karin@fortnox.se"], internal_date: "2026-09-02T09:00:00Z" }),
      ],
      addresses,
    );

    expect(touches.get("karin")!.map((t) => t.messageId)).toEqual(["from-work", "cc-work", "to-gmail"]);
  });

  it("doesn't count mail someone else sent with the contact only on Cc", () => {
    const touches = touchesByContact(
      [message("other", { direction: "inbound", from_email: "boss@x.se", cc_emails: ["johan@example.se"] })],
      addresses,
    );

    expect(touches.has("johan")).toBe(false);
  });

  it("counts a message to two of a contact's addresses once, and gives each contact on it their own touch", () => {
    const touches = touchesByContact(
      [
        message("both", {
          direction: "outbound",
          from_email: "me@x.se",
          to_emails: ["karin@fortnox.se", "johan@example.se"],
          cc_emails: ["karin.l@gmail.com"],
        }),
      ],
      addresses,
    );

    expect(touches.get("karin")).toHaveLength(1);
    expect(touches.get("johan")).toHaveLength(1);
  });
});
