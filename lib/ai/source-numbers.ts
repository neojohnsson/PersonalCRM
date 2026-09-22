import { SUGGESTIONS, SUMMARY_PARTS, type SavedSummary } from "@/lib/ai/summary-parts";

/**
 * "email 1" means the same message everywhere on a contact's page
 * (docs/slice-9b-plan.md, Part 4).
 *
 * Each part of a summary listed its own sources and numbered them from one, so
 * "email 1" under *Who they are* and "email 1" under *How you know them* were
 * two different messages — and the numbers were the only way to tell which
 * claim came from which mail. The first outside test of the app read them as
 * one list and got a wrong answer, which is worse than no numbers at all.
 *
 * One numbering per summary, in the order the page reads: the four parts as
 * they appear, then the suggestions. The first message cited anywhere is
 * email 1, and a message cited again keeps its number.
 *
 * The contact's own address is not numbered — it is named ("their address
 * karin@…"), because it is not a message.
 */
export function sourceNumbers(sources: SavedSummary["sources"]): Map<string, number> {
  const numbers = new Map<string, number>();

  for (const key of [...SUMMARY_PARTS, ...SUGGESTIONS]) {
    for (const source of sources[key] ?? []) {
      if ("address" in source) continue;
      if (!numbers.has(source.messageId)) numbers.set(source.messageId, numbers.size + 1);
    }
  }

  return numbers;
}
