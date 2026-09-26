/**
 * The one piece of formatting the Assistant's answers get: **bold** (2026-09-26).
 *
 * The model writes Markdown now and then even when asked for plain text, and
 * the chat showed the asterisks. Only bold is drawn, because it is the one
 * the model uses to point at a name or a date; anything else it writes stays
 * as written. Pairs only, within one line, around at least one character --
 * a lone "**" (or one still arriving while the answer streams in) is shown
 * as it is, not guessed at.
 *
 * Returns the text in pieces rather than HTML, so the chat draws each piece
 * as a React text node: nothing the model writes can ever become markup.
 */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}
