/**
 * The tidy pass over a draft (docs/slice-5a-plan.md, Part 7).
 *
 * The instructions tell the model not to write like an AI. This is what code
 * can enforce afterwards, because instructions get ignored sometimes.
 *
 * Only the em dash (—), the clearest tell in both English and Swedish mail.
 * A Swedish en dash (–) is ordinary punctuation — "måndag–fredag", "10–15
 * minuter" — and is left exactly as it is.
 */

/** The phrases the Profile page offers to add to "Never write" in one click. */
export const COMMON_AI_PHRASES = [
  "I hope this email finds you well",
  "Just circling back",
  "I wanted to reach out",
  "delve",
  "It's worth noting",
  "Tveka inte att höra av dig",
  "Hoppas att detta mejl finner dig väl",
] as const;

/**
 * An em dash the model wrote becomes ordinary punctuation:
 *   "Tack — det passar bra"     → "Tack, det passar bra"
 *   "Tack—det passar bra"       → "Tack, det passar bra"
 *   "Ja — och sen då?"          → "Ja, och sen då?"
 * A trailing em dash at the end of a sentence becomes a full stop.
 */
export function tidyDraft(text: string): string {
  return text
    .replace(/\s*—\s*$/gm, ".")
    .replace(/\s*—\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[ \t]+$/gm, "");
}

/** Whether a draft still holds an em dash — for tests and for saying so. */
export function hasEmDash(text: string): boolean {
  return text.includes("—");
}
