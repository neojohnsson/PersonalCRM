import type { Turn } from "@/lib/relationship/whose-turn";

/**
 * What the app should say about a contact, and whether it should ask anything
 * of you (docs/slice-6c-plan.md, Part 2).
 *
 * `whoseTurn` answers a narrower question — who wrote last — from message
 * headers alone, which is why it can't be wrong. What it can't know is whether
 * anything is *owed*: a conversation handed to a colleague, a person you have
 * decided to write to in March, someone you never chase. Those are things only
 * you can say, and this is where what you said wins over what was inferred.
 *
 * Every screen asks this instead of reading `turn.kind` directly, so "do we
 * prompt about this person" is decided once, here, and tested once.
 */

export type Standing =
  /** Just a contact: never prompted about, for good. */
  | { kind: "never_chase" }
  /** A next touch you set, dated later than today. */
  | { kind: "planned"; dueOn: string }
  /** You said this conversation is finished, and nothing newer has arrived. */
  | { kind: "settled"; at: Date }
  /** Nothing said: the plain fact of who wrote last. */
  | { kind: "open"; turn: Turn };

export type StandingInput = {
  turn: Turn;
  /**
   * When the contact's *latest* thread was settled, if it was. Older threads
   * don't matter: the app only ever talks about the newest one.
   */
  settledAt?: Date | null;
  /** The due date of an open next touch, if there is one. YYYY-MM-DD. */
  plannedOn?: string | null;
  neverChase?: boolean;
};

/**
 * Precedence, when more than one is true:
 *
 *   never chase → planned → settled → the fact
 *
 * Planned beats settled because a date you chose is more use to you than a
 * thread you closed, and both beat the inference.
 */
export function standingOf(input: StandingInput, today: string): Standing {
  const { turn, settledAt, plannedOn, neverChase } = input;

  if (neverChase) return { kind: "never_chase" };
  if (plannedOn && plannedOn > today) return { kind: "planned", dueOn: plannedOn };

  // A settle records the moment you said it. A message that arrived after that
  // moment is newer than what you said, so it re-opens the thread on its own —
  // saying "we're done here" must never make you blind to what comes next.
  if (settledAt && turn.kind !== "none" && settledAt.getTime() >= turn.at.getTime()) {
    return { kind: "settled", at: settledAt };
  }

  return { kind: "open", turn };
}

/** Whether the app may ask anything of you about this person. */
export function prompts(standing: Standing): boolean {
  return standing.kind === "open";
}
