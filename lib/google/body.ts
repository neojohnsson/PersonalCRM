import type { GmailPart } from "@/lib/google/gmail";

/**
 * From a full Gmail message to the few lines a person actually wrote in it
 * (docs/slice-4-plan.md, Part 1). Pure functions, tested directly
 * (tests/gmail-body.test.ts).
 *
 *   1. find the readable part — text/plain, or text/html with the tags removed
 *   2. decode it in its own character set, so å ä ö survive
 *   3. cut the quoted earlier messages, the signature and "Sent from my iPhone"
 *   4. trim what's left to a fixed length
 *
 * The AI gets less to read (cheaper) and nothing written by someone else in an
 * earlier message gets attributed to this one.
 */

/** Longest text kept from one message, in characters. */
export const MAX_MESSAGE_CHARS = 2_000;

/** The message's readable text, or "" if it has none. */
export function readableText(payload: GmailPart | undefined): string {
  if (!payload) return "";

  const plain = findPart(payload, "text/plain");
  if (plain) return decodePart(plain);

  const html = findPart(payload, "text/html");
  if (html) return htmlToText(decodePart(html));

  return "";
}

/** The first part with this type that is the message itself, not an attachment. */
function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType?.toLowerCase() === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** base64url → text, in the charset from the part's Content-Type (UTF-8 if unsure). */
function decodePart(part: GmailPart): string {
  const bytes = Buffer.from(part.body!.data!, "base64url");
  const contentType = part.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const charset = /charset="?([\w-]+)"?/i.exec(contentType)?.[1] ?? "utf-8";

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // A charset name the decoder doesn't know.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Swedish letters, which older mail writes as entities. Case matters here.
  aring: "å",
  Aring: "Å",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  eacute: "é",
  Eacute: "É",
  uuml: "ü",
  Uuml: "Ü",
};

/**
 * Just enough HTML-to-text for mail that has no plain part: line breaks where
 * blocks end, tags and quoted blockquotes gone, common entities decoded.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? entity;
    });
}

/**
 * Where an earlier message starts inside a reply. Everything from the first
 * matching line on is someone else's text, already in its own message.
 */
const REPLY_STARTS: RegExp[] = [
  /^On .+ wrote:\s*$/, // Gmail, English
  // Swedish, from Gmail ("Den tors 11 sep. 2026 kl 09:14 skrev Karin <…>:") and
  // others ("11 sep. 2026 kl. 09:14 skrev Karin:"). A digit is required, so a
  // sentence like "Den dagen skrev hon till mig:" isn't cut.
  /^.*\d.* skrev .+:\s*$/,
  /^-{2,}\s*(Original Message|Ursprungligt meddelande|Forwarded message|Vidarebefordrat meddelande)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/, // Outlook's rule above the quoted header
];

const SIGNATURE_STARTS: RegExp[] = [
  /^--\s*$/, // the standard "-- " separator
  /^(Sent from my|Skickat från min) .+$/i,
  /^Get Outlook for .+$/i,
];

/** The part of a message its sender wrote this time: no quotes, no signature. */
export function ownWords(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(From|Från):\s/.test(trimmed)) {
      // Only an Outlook quote header if Sent/Skickat follows within a few lines;
      // otherwise "From: …" is just something someone wrote.
      const next = lines.slice(i + 1, i + 4).map((l) => l.trim());
      if (next.some((l) => /^(Sent|Skickat|Date|Datum):\s/.test(l))) break;
    } else if (REPLY_STARTS.some((pattern) => pattern.test(trimmed))) {
      break;
    } else if (/^On .+\d/.test(trimmed) && /wrote:\s*$/.test(lines[i + 1]?.trim() ?? "")) {
      // Gmail wraps a long "On …, Name <address>" onto two lines.
      break;
    }

    if (SIGNATURE_STARTS.some((pattern) => pattern.test(trimmed))) break;
    if (trimmed.startsWith(">")) continue;

    kept.push(line.trimEnd());
  }

  return kept
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut to `max` characters at a word boundary, marking that something was cut. */
export function trimText(text: string, max = MAX_MESSAGE_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()} […]`;
}

/** All three steps: what the AI reads from one message. */
export function messageText(payload: GmailPart | undefined): string {
  return trimText(ownWords(readableText(payload)));
}
