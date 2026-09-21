import type { Relationship } from "@/lib/relationship/load";
import { prompts, standingOf } from "@/lib/relationship/standing";
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
 *
 * Your turn and Going quiet only hold people the app may still ask you about —
 * lib/relationship/standing.ts decides that, so a finished conversation, a day
 * you have already chosen, and a person you never chase all drop out (slice
 * 6c). Coming up is untouched: a date you set yourself is your plan, not the
 * app's guess, so it shows even for a contact you are never prompted about.
 */

export type Person<T> = { contact: T & { id: string }; relationship: Relationship };

export type OpenTouch = {
  id: string;
  contact_id: string;
  due_on: string;
  reason: string | null;
  /** What sort of touch it is (migration 0023). Null: yours to act on. */
  kind?: string | null;
};

export type ComingUp<T> = OpenTouch & { contact: T & { id: string }; overdue: boolean; dueToday: boolean };

export type Today<T> = {
  yours: Person<T>[];
  quiet: Person<T>[];
  comingUp: ComingUp<T>[];
};

/** `today` is YYYY-MM-DD. Touches whose contact isn't in `people` are left out. */
export function whoNeedsYou<T>(people: Person<T>[], touches: OpenTouch[], today: string): Today<T> {
  const byTurn = (a: Person<T>, b: Person<T>) => compareTurns(a.relationship.turn, b.relationship.turn);
  const plannedOn = earliestTouches(touches);
  const mayAsk = (person: Person<T>) =>
    prompts(
      standingOf(
        {
          turn: person.relationship.turn,
          settledAt: person.relationship.settledAt,
          plannedOn: plannedOn.get(person.contact.id) ?? null,
          neverChase: person.relationship.neverChase,
        },
        today,
      ),
    );

  const asked = people.filter(mayAsk);
  const yours = asked.filter((person) => person.relationship.turn.kind === "yours").sort(byTurn);
  const quiet = asked
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

/** The soonest open touch per contact: the one that decides "already planned". */
function earliestTouches(touches: OpenTouch[]): Map<string, string> {
  const soonest = new Map<string, string>();
  for (const touch of touches) {
    const current = soonest.get(touch.contact_id);
    if (!current || touch.due_on < current) soonest.set(touch.contact_id, touch.due_on);
  }
  return soonest;
}
