import type { Turn } from "@/lib/relationship/whose-turn";

/**
 * The contact list's filter chips (design/ContactList.dc.html): All · Your turn
 * · Their turn · No open thread · Going quiet, then the most used tags.
 */

export type ListFilter = "all" | "yours" | "theirs" | "closed" | "quiet";

export const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yours", label: "Your turn" },
  { value: "theirs", label: "Their turn" },
  { value: "closed", label: "No open thread" },
  { value: "quiet", label: "Going quiet" },
];

/** `?filter=` as a known filter; anything else is "all". */
export function parseFilter(raw: string | string[] | undefined): ListFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FILTERS.some((filter) => filter.value === value) ? (value as ListFilter) : "all";
}

/**
 * Whether a contact belongs under a chip.
 *
 * "No open thread" also holds contacts with no mail at all — neither of you is
 * waiting. "Going quiet" is part of "Their turn", as in the design's counts.
 */
export function matchesFilter(turn: Turn, filter: ListFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "yours":
      return turn.kind === "yours";
    case "theirs":
      return turn.kind === "theirs";
    case "closed":
      return turn.kind === "closed" || turn.kind === "none";
    case "quiet":
      return turn.kind === "theirs" && turn.goingQuiet;
  }
}

export function countByFilter(turns: Turn[]): Record<ListFilter, number> {
  const counts = { all: 0, yours: 0, theirs: 0, closed: 0, quiet: 0 };
  for (const turn of turns) {
    for (const { value } of FILTERS) {
      if (matchesFilter(turn, value)) counts[value]++;
    }
  }
  return counts;
}

/**
 * The most used tags, counted without regard to case and shown in the spelling
 * seen first. Most used first; equal counts alphabetically.
 */
export function topTags(tagLists: string[][], limit = 6): { tag: string; count: number }[] {
  const tags = new Map<string, { tag: string; count: number }>();

  for (const list of tagLists) {
    const seenOnContact = new Set<string>();
    for (const tag of list) {
      const key = tag.toLowerCase();
      if (seenOnContact.has(key)) continue;
      seenOnContact.add(key);

      const entry = tags.get(key) ?? { tag, count: 0 };
      entry.count++;
      tags.set(key, entry);
    }
  }

  return [...tags.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "sv"))
    .slice(0, limit);
}

export function hasTag(tags: string[], tag: string): boolean {
  const wanted = tag.toLowerCase();
  return tags.some((candidate) => candidate.toLowerCase() === wanted);
}
