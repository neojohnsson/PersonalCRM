/**
 * The Assistant page's cards, worked out from what the app already knows
 * (docs/slice-11-plan.md §1).
 *
 * No AI in any of it. The cards are what make the page worth opening with the
 * Assistant switched off, or with the month's budget used up — "it must be
 * useful with the AI switched off" is the first line of AGENTS.md's premise.
 */

/** One row of "Things to decide": a queue that has something in it. */
export type DecideRow = {
  key: "duplicates" | "summaries" | "promises" | "names";
  title: string;
  detail: string;
  /** Where the button goes. */
  href: string;
  action: string;
};

export type DecideCounts = {
  duplicates: number;
  /** Summaries written and waiting, and the first contact that has one. */
  summaries: { count: number; firstContactId: string | null };
  promises: number;
  /** Contacts the name rules have a suggestion for (lib/contacts/name-suggestion.ts). */
  names: { count: number; firstContactId: string | null; firstShownAs: string | null };
};

/**
 * The rows, in the design's order, leaving out every queue that is empty — a
 * row saying "0 promises found" is a row asking you to press something that
 * has nothing behind it.
 */
export function thingsToDecide(counts: DecideCounts): DecideRow[] {
  const rows: DecideRow[] = [];

  if (counts.duplicates > 0) {
    rows.push({
      key: "duplicates",
      title:
        counts.duplicates === 1
          ? "Two contacts may be the same person"
          : `${counts.duplicates} pairs of contacts may be the same person`,
      // The Assistant never merges: a wrong merge is destructive and nearly
      // impossible to undo (plan.md §3.7), so the card only points at them.
      detail: "Only you can merge them.",
      href: "/contacts/duplicates",
      action: "Compare",
    });
  }

  if (counts.summaries.count > 0 && counts.summaries.firstContactId) {
    rows.push({
      key: "summaries",
      title:
        counts.summaries.count === 1
          ? "A summary is waiting for you"
          : `${counts.summaries.count} summaries waiting for you`,
      detail: "Nothing is saved to a contact until you approve it.",
      href: `/contacts/${counts.summaries.firstContactId}`,
      action: "Read",
    });
  }

  if (counts.promises > 0) {
    rows.push({
      key: "promises",
      title: counts.promises === 1 ? "A promise found, not decided" : `${counts.promises} promises found, none decided`,
      detail: "Things you or they said would happen.",
      href: "/promises",
      action: "Decide",
    });
  }

  if (counts.names.count > 0 && counts.names.firstContactId) {
    rows.push({
      key: "names",
      title:
        counts.names.count === 1
          ? "A contact could have a better name"
          : `${counts.names.count} contacts could have a better name`,
      detail: counts.names.firstShownAs
        ? `Starting with ${counts.names.firstShownAs}. Nothing is renamed without you.`
        : "Nothing is renamed without you.",
      href: `/contacts/${counts.names.firstContactId}`,
      action: "See the guess",
    });
  }

  return rows;
}
