import type { Standing } from "@/lib/relationship/standing";

/**
 * The contact list's filter chips (design/ContactList.dc.html): All · Your turn
 * · Their turn · No open thread · Going quiet, then the most used tags.
 *
 * Everything here takes a **Standing**, not a Turn (changed 2026-09-21, after
 * the first outside test of the app). It used to take a Turn, which meant the
 * chips and their counts knew nothing about the three things slice 6c invented
 * — a settled conversation, a person never chased, a day already planned — so
 * the app contradicted itself out loud:
 *
 *   Home said       "7 people are waiting on a reply from you"
 *   Contacts said   "Your turn 12"
 *   A contact page  said "Nothing owed", and the list still said YOUR TURN
 *
 * That was mine: docs/slice-6c-plan.md says "the contact list's default order is
 * unchanged: only the words change", and I thought about its order and its words
 * and never once about its filters.
 *
 * The three states get chips of their own rather than being hidden. "Where did
 * Linda go?" is a worse bug than the one being fixed.
 */

export type ListFilter =
  | "all"
  | "yours"
  | "theirs"
  | "quiet"
  | "closed"
  | "settled"
  | "planned"
  | "muted";

export const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yours", label: "Your turn" },
  { value: "theirs", label: "Their turn" },
  { value: "quiet", label: "Going quiet" },
  { value: "closed", label: "No open thread" },
  { value: "settled", label: "Nothing owed" },
  { value: "planned", label: "Planned" },
  { value: "muted", label: "Just a contact" },
];

/** `?filter=` as a known filter; anything else is "all". */
export function parseFilter(raw: string | string[] | undefined): ListFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FILTERS.some((filter) => filter.value === value) ? (value as ListFilter) : "all";
}

/**
 * The one chip a contact belongs under — and what their row says, so a row can
 * never disagree with the chip that counted it.
 *
 * Going quiet wins over Their turn here, because it is the more specific thing
 * to say about the same person.
 */
export function bucketOf(standing: Standing): Exclude<ListFilter, "all"> {
  switch (standing.kind) {
    case "never_chase":
      return "muted";
    case "planned":
      return "planned";
    case "settled":
      return "settled";
    case "open":
      switch (standing.turn.kind) {
        case "yours":
          return "yours";
        case "theirs":
          return standing.turn.goingQuiet ? "quiet" : "theirs";
        default:
          return "closed";
      }
  }
}

/**
 * Whether a contact belongs under a chip.
 *
 * "No open thread" also holds contacts with no mail at all — neither of you is
 * waiting. "Going quiet" is part of "Their turn", as in the design's counts,
 * which is the one place a contact is counted twice on purpose.
 */
export function matchesFilter(standing: Standing, filter: ListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "theirs") return bucketOf(standing) === "theirs" || bucketOf(standing) === "quiet";
  return bucketOf(standing) === filter;
}

export function countByFilter(standings: Standing[]): Record<ListFilter, number> {
  const counts: Record<ListFilter, number> = {
    all: 0,
    yours: 0,
    theirs: 0,
    quiet: 0,
    closed: 0,
    settled: 0,
    planned: 0,
    muted: 0,
  };

  for (const standing of standings) {
    for (const { value } of FILTERS) {
      if (matchesFilter(standing, value)) counts[value]++;
    }
  }
  return counts;
}

/**
 * The default order. People the app would ask you about come first, longest
 * wait first; then the ones you have said something about.
 *
 * Slice 6c left the order alone deliberately — "people who wrote last first is
 * still the most useful order" — but that was when a settled contact looked
 * exactly like anybody else. Now that their row says "Nothing owed", sorting
 * them among the people who need answering is just noise at the top of the
 * list. Their turn is unchanged underneath; they are simply below.
 */
export function standingRank(standing: Standing): number {
  switch (standing.kind) {
    case "open":
      return 0;
    case "planned":
      return 1;
    case "settled":
      return 2;
    case "never_chase":
      return 3;
  }
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
