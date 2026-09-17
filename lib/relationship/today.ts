import type { Relationship } from "@/lib/relationship/load";
import { compareTurns } from "@/lib/relationship/whose-turn";

/**
 * What "Who needs you today" shows (design/Main.dc.html; docs/slice-3-plan.md,
 * decision C), picked from every contact's whose-turn and their open next
 * touches:
 *
 *   Your turn     they wrote last, within 30 days — longest wait first
 *   Going quiet   you wrote last, more than 14 days ago — longest silence first
 *   Coming up     open next touches — earliest date first, so overdue ones lead
 *
 * Plain sorting of things already worked out; nothing new is decided here.
 */

export type Person<T> = { contact: T & { id: string }; relationship: Relationship };

export type OpenTouch = { id: string; contact_id: string; due_on: string; reason: string | null };

export type ComingUp<T> = OpenTouch & { contact: T & { id: string }; overdue: boolean; dueToday: boolean };

export type Today<T> = {
  yours: Person<T>[];
  quiet: Person<T>[];
  comingUp: ComingUp<T>[];
};

/** `today` is YYYY-MM-DD. Touches whose contact isn't in `people` are left out. */
export function whoNeedsYou<T>(people: Person<T>[], touches: OpenTouch[], today: string): Today<T> {
  const byTurn = (a: Person<T>, b: Person<T>) => compareTurns(a.relationship.turn, b.relationship.turn);

  const yours = people.filter((person) => person.relationship.turn.kind === "yours").sort(byTurn);
  const quiet = people
    .filter(({ relationship: { turn } }) => turn.kind === "theirs" && turn.goingQuiet)
    .sort(byTurn);

  const contacts = new Map(people.map((person) => [person.contact.id, person.contact]));
  const comingUp = touches
    .filter((touch) => contacts.has(touch.contact_id))
    .map((touch) => ({
      ...touch,
      contact: contacts.get(touch.contact_id)!,
      overdue: touch.due_on < today,
      dueToday: touch.due_on === today,
    }))
    .sort((a, b) => a.due_on.localeCompare(b.due_on));

  return { yours, quiet, comingUp };
}
