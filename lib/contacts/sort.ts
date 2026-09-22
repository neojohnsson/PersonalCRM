/**
 * Sorting the contact list by a column (docs/slice-9b-plan.md, Part 6).
 *
 * The list had five column headings that looked like every sortable table
 * anybody has used, and none of them did anything; beside them sat a white
 * pill reading "Sorted by Whose turn" that looked exactly like a dropdown and
 * was a label. The first outside test of the app pressed all six.
 *
 * So the headings sort, and the pill says what the order is in plain text
 * instead of pretending to offer a choice it doesn't have.
 *
 * **Whose turn stays the default**, because that default is the product
 * (design/canvas.json): the app answers "who needs me", never "here are your
 * contacts, A–Z". A column sort is for finding somebody you already know
 * about, which is why it lives in the headings and not in the header.
 *
 * One click per heading, one direction per column — the direction that is
 * useful. Ascending company names, yes; coldest contact first, no. Toggling a
 * direction and sorting on two columns are both out of this slice on purpose.
 */

export const SORTS = ["turn", "name", "company", "warmth", "last"] as const;
export type SortKey = (typeof SORTS)[number];

/** The column a row is sorted on, taken from what the list already has. */
export type SortRow = {
  /** What the row shows, which is what an A–Z sort must follow. */
  name: string;
  company: string | null;
  /** 0–100, or null for a contact with no mail. */
  warmth: number | null;
  /** When you last spoke, as an ISO string, or null. */
  lastAt: string | null;
};

/** `?sort=` from the address, or "turn" for anything else. */
export function parseSort(value: unknown): SortKey {
  return typeof value === "string" && (SORTS as readonly string[]).includes(value) ? (value as SortKey) : "turn";
}

/** What the list says it is ordered by. */
export function sortLabel(key: SortKey): string {
  switch (key) {
    case "turn":
      return "Whose turn";
    case "name":
      return "Name, A–Z";
    case "company":
      return "Company, A–Z";
    case "warmth":
      return "Warmest first";
    case "last":
      return "Most recent first";
  }
}

/**
 * Two rows on one column. "turn" is not here: that is the standing-and-whose-
 * turn order the page works out itself, and this only breaks its ties.
 *
 * Anything missing goes last, whichever way the column runs — a contact with
 * no company or no mail is not "before A" or "the coldest", it is unknown, and
 * unknown belongs at the bottom.
 */
export function compareOn(key: Exclude<SortKey, "turn">, a: SortRow, b: SortRow): number {
  switch (key) {
    case "name":
      return byText(a.name, b.name);
    case "company":
      return byText(a.company, b.company);
    case "warmth":
      return byNumber(a.warmth, b.warmth);
    case "last":
      return byDateDesc(a.lastAt, b.lastAt);
  }
}

/** A–Z in Swedish, so å ä ö sort after z where they belong. */
function byText(a: string | null, b: string | null): number {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, "sv");
}

/** Most recent first, never spoken last. ISO dates compare as text. */
function byDateDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

/** Highest first, nothing last. */
function byNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
