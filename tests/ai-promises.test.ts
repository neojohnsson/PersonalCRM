import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/lib/ai/conversation";
import {
  MAX_PROMISES_PER_CONTACT,
  buildPromiseInput,
  checkPromises,
  type RawPromise,
} from "@/lib/ai/promises";

/**
 * What code holds the model to when it says it found a promise.
 *
 * The negations come first, because they are the failure this feature is most
 * likely to have (plan.md §5.3) and the one that costs the most: a wrong
 * promise makes you chase somebody who owes you nothing.
 */

const TODAY = "2026-09-20";

const message = (ref: string, text: string, from: "you" | "them" = "them"): ConversationMessage => ({
  ref,
  messageId: `gmail-${ref}`,
  threadId: "t1",
  from,
  who: null,
  at: new Date("2026-09-10T09:00:00Z"),
  subject: "Examensarbete",
  text,
});

const found = (over: Partial<RawPromise> = {}): RawPromise => ({
  source: "m1",
  owed_by: "them",
  sentence: "I'll check with the team and come back to you",
  reason: "Pär said he'd come back about the team",
  timing: "stated_date",
  date: "2026-09-25",
  month: null,
  ...over,
});

const REAL = "Hi! I'll check with the team and come back to you. Best, Pär";

describe("negations and near-misses", () => {
  /** Every one of these must produce nothing at all. */
  const nothing = [
    "I can't get back to you before the 20th",
    "I cannot look at this until the budget is done",
    "I won't be able to send anything until spring",
    "Unless you hear from me, assume Friday works",
    "Let me know if you need anything before then",
    "I'll let you know if anything changes",
    "There is no need to reply to this",
    "Jag hinner inte titta på det före den 20:e",
    "Hör av dig om du behöver något inför hösten",
    "Vi behöver inte boka något nytt möte",
    "Jag kan inte svara på det förrän i oktober",
  ];

  it.each(nothing)("finds no promise in %j", (sentence) => {
    const conversation = [message("m1", `Hej! ${sentence}. Hälsningar, Pär`)];
    const checked = checkPromises({ promises: [found({ sentence })] }, conversation, TODAY);

    expect(checked.promises).toEqual([]);
    expect(checked.dropped).toEqual(["negated"]);
  });

  it("keeps a promise that happens to contain a negation elsewhere", () => {
    // "inte" is among the commonest words in Swedish. A rule that reads it
    // anywhere in the sentence threw away real promises (2026-09-20).
    const sentence = "Jag har inte fått svar än, men jag hör av mig på fredag";
    const conversation = [message("m1", `Hej! ${sentence}. Hälsningar, Pär`)];
    const checked = checkPromises({ promises: [found({ sentence })] }, conversation, TODAY);

    expect(checked.dropped).toEqual([]);
    expect(checked.promises).toHaveLength(1);
  });

  it("still finds the plain promise it is meant to find", () => {
    const checked = checkPromises({ promises: [found()] }, [message("m1", REAL)], TODAY);

    expect(checked.dropped).toEqual([]);
    expect(checked.promises).toEqual([
      {
        messageId: "gmail-m1",
        threadId: "t1",
        owedBy: "them",
        dueOn: "2026-09-25",
        reason: "Pär said he'd come back about the team",
      },
    ]);
  });
});

describe("checkPromises", () => {
  it("throws away anything the model didn't copy word for word", () => {
    const paraphrased = found({ sentence: "I will check with the team and revert to you" });
    const checked = checkPromises({ promises: [paraphrased] }, [message("m1", REAL)], TODAY);

    expect(checked.promises).toEqual([]);
    expect(checked.dropped).toEqual(["not_quoted"]);
  });

  it("forgives whitespace, since a line break is not a paraphrase", () => {
    const wrapped = message("m1", "Hi!\r\n  I'll check with the team\n  and come back to you.\n\nPär");
    const checked = checkPromises(
      { promises: [found({ sentence: "I'll check with the team and come back to you" })] },
      [wrapped],
      TODAY,
    );

    expect(checked.promises).toHaveLength(1);
  });

  it("throws away a sentence too short to prove anything", () => {
    const checked = checkPromises(
      { promises: [found({ sentence: "I will" })] },
      [message("m1", "I will. And that is all I am saying about it.")],
      TODAY,
    );

    expect(checked.dropped).toEqual(["not_quoted"]);
  });

  it("throws away a message it was never given", () => {
    const checked = checkPromises({ promises: [found({ source: "m9" })] }, [message("m1", REAL)], TODAY);

    expect(checked.promises).toEqual([]);
    expect(checked.dropped).toEqual(["no_such_message"]);
  });

  it("needs a real date, near enough today to act on", () => {
    const conversation = [message("m1", REAL)];
    const cases: [Partial<RawPromise>, string][] = [
      // Nothing stated and no timing to work from: there is no honest day.
      [{ date: null, timing: "nothing_open" }, "no_date"],
      [{ date: "soon", timing: "nothing_open" }, "no_date"],
      [{ date: "2026-02-30", timing: "nothing_open" }, "no_date"],
      [{ date: "2024-01-05" }, "date_too_far"],
      [{ date: "2030-01-05" }, "date_too_far"],
    ];

    for (const [over, reason] of cases) {
      const checked = checkPromises({ promises: [found(over)] }, conversation, TODAY);
      expect(checked.dropped, JSON.stringify(over)).toEqual([reason]);
    }
  });

  it("works out a day when the message gives none", () => {
    // "I'll check with the team and come back to you" has no date in it. The
    // rules in lib/relationship/touch-date.ts pick the day, not the model
    // (plan.md §3.4). They wrote on the 10th; they_will_get_back is 14 days on,
    // moved to a working day.
    const conversation = [message("m1", REAL)];
    const checked = checkPromises(
      { promises: [found({ timing: "they_will_get_back", date: null })] },
      conversation,
      TODAY,
    );

    expect(checked.dropped).toEqual([]);
    expect(checked.promises[0].dueOn).toBe("2026-09-24");
  });

  it("works out a day for something waiting on a later month", () => {
    const checked = checkPromises(
      { promises: [found({ timing: "later_event", date: null, month: "2026-11" })] },
      [message("m1", REAL)],
      TODAY,
    );

    expect(checked.promises[0].dueOn).toBe("2026-11-02"); // the 1st is a Sunday
  });

  it("keeps a date that has already passed, because that is overdue, not wrong", () => {
    const checked = checkPromises(
      { promises: [found({ date: "2026-09-14" })] },
      [message("m1", REAL)],
      TODAY,
    );

    expect(checked.promises[0].dueOn).toBe("2026-09-14");
  });

  it("takes one promise per message per direction, and both ways from one message", () => {
    const both = message("m1", `${REAL} I'll send you the dates on Monday.`, "them");
    const checked = checkPromises(
      {
        promises: [
          found(),
          found({ reason: "Said again, differently" }),
          found({ owed_by: "you", sentence: "I'll send you the dates on Monday", reason: "Send the dates" }),
        ],
      },
      [both],
      TODAY,
    );

    expect(checked.promises.map((p) => p.owedBy)).toEqual(["them", "you"]);
    expect(checked.dropped).toEqual(["duplicate"]);
  });

  it("stops at a handful from one contact", () => {
    const conversation = Array.from({ length: 6 }, (_, i) => message(`m${i + 1}`, REAL));
    const raw = conversation.map((m) => found({ source: m.ref }));

    const checked = checkPromises({ promises: raw }, conversation, TODAY);

    expect(checked.promises).toHaveLength(MAX_PROMISES_PER_CONTACT);
    expect(checked.dropped).toEqual(["over_the_cap", "over_the_cap"]);
  });

  it("cuts a reason to what the column holds, and drops an empty one", () => {
    const conversation = [message("m1", REAL)];

    const long = checkPromises({ promises: [found({ reason: "x".repeat(400) })] }, conversation, TODAY);
    expect(long.promises[0].reason).toHaveLength(300);

    const empty = checkPromises({ promises: [found({ reason: "   " })] }, conversation, TODAY);
    expect(empty.dropped).toEqual(["empty_reason"]);
  });

  it("survives an answer with no promises in it", () => {
    expect(checkPromises({ promises: [] }, [message("m1", REAL)], TODAY)).toEqual({
      promises: [],
      dropped: [],
    });
  });
});

describe("buildPromiseInput", () => {
  it("gives the model today, the contact and each message with its ref", () => {
    const input = buildPromiseInput(
      "Pär Burman",
      [message("m1", REAL), message("m2", "Thanks!", "you")],
      TODAY,
    );

    expect(input).toContain("Today: 2026-09-20");
    expect(input).toContain("Contact: Pär Burman");
    expect(input).toContain("[m1] 2026-09-10 · from them · Subject: Examensarbete");
    expect(input).toContain("[m2] 2026-09-10 · from you");
    expect(input).toContain(REAL);
  });
});
