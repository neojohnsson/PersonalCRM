import type { GmailMessage } from "@/lib/google/gmail";

/**
 * Turning Gmail's header text into a gmail_messages row.
 *
 * No library: the handful of rules needed are written out here, where they
 * can be read and tested. It handles:
 *
 *   - "Björn Ek" <b@x.se>, Karin Lindqvist <k@x.se>, bare k@x.se
 *   - commas inside quoted names: "Ek, Björn" <b@x.se> is one person
 *   - RFC 2047 encoded names, =?UTF-8?B?…?= — how mail clients send å ä ö
 *   - address groups: Team: a@x.se, b@x.se;
 *   - mixed letter case in addresses
 *
 * Google doesn't document whether format=metadata hands back names already
 * decoded, so decoding is always applied. Plain text passes through unchanged.
 */

export type Address = { email: string; name: string | null };

export type MessageRow = {
  user_id: string;
  gmail_message_id: string;
  thread_id: string;
  internal_date: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  direction: "inbound" | "outbound";
  has_list_unsubscribe: boolean;
};

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** Whitespace between two encoded words is not part of the text (RFC 2047 §6.2). */
const BETWEEN_ENCODED_WORDS = /(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)/g;

/**
 * Decodes RFC 2047 encoded words; everything else is left as it is.
 *
 * A word in a charset Node doesn't know is left encoded rather than guessed
 * at — a visible =?…?= is better than a wrong name.
 */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(BETWEEN_ENCODED_WORDS, "$1")
    .replace(ENCODED_WORD, (word, charset: string, encoding: string, text: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : quotedPrintableBytes(text);

        // "UTF-8*sv" — a language tag after * isn't part of the charset.
        return new TextDecoder(charset.split("*")[0], { fatal: true }).decode(bytes);
      } catch {
        return word;
      }
    });
}

/** The Q encoding: _ is a space, =XX is a byte in hex. */
function quotedPrintableBytes(text: string): Buffer {
  const bytes: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const hex = text.slice(i + 1, i + 3);

    if (text[i] === "_") {
      bytes.push(0x20);
    } else if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(text.charCodeAt(i));
    }
  }

  return Buffer.from(bytes);
}

/**
 * Splits a header on commas and semicolons that aren't inside quotes,
 * angle brackets or (comments).
 */
function splitAddresses(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;
  let commentDepth = 0;

  for (let i = 0; i < header.length; i++) {
    const char = header[i];

    if (inQuotes && char === "\\") {
      current += char + (header[i + 1] ?? "");
      i++;
      continue;
    }

    if (char === '"' && commentDepth === 0) inQuotes = !inQuotes;
    else if (!inQuotes && char === "<") angleDepth++;
    else if (!inQuotes && char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (!inQuotes && char === "(") commentDepth++;
    else if (!inQuotes && char === ")") commentDepth = Math.max(0, commentDepth - 1);

    if ((char === "," || char === ";") && !inQuotes && angleDepth === 0 && commentDepth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current);
  return parts;
}

/** Index of `target` outside "quoted text", or -1. */
function indexOutsideQuotes(text: string, target: string): number {
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    if (inQuotes && text[i] === "\\") {
      i++;
    } else if (text[i] === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && text[i] === target) {
      return i;
    }
  }

  return -1;
}

function cleanName(raw: string, email: string): string | null {
  let name = raw.trim();

  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  }

  name = decodeEncodedWords(name).replace(/\s+/g, " ").trim();

  // "k@x.se" <k@x.se> — an address repeated as its own name isn't a name.
  if (!name || name.toLowerCase() === email) return null;

  return name;
}

function parseAddress(raw: string): Address | null {
  let part = raw.trim();

  // A group — "Team: a@x.se" — keeps its addresses and drops the group name.
  const colon = indexOutsideQuotes(part, ":");
  const angle = indexOutsideQuotes(part, "<");
  if (colon !== -1 && (angle === -1 || colon < angle)) {
    part = part.slice(colon + 1).trim();
  }

  let email: string;
  let rawName = "";

  const bracketed = part.match(/^([\s\S]*)<([^<>]*)>\s*$/);
  const commented = part.match(/^([^\s()]+)\s*\(([\s\S]*)\)\s*$/);

  if (bracketed) {
    rawName = bracketed[1];
    email = bracketed[2];
  } else if (commented) {
    // Old style: b@x.se (Björn Ek)
    email = commented[1];
    rawName = commented[2];
  } else {
    email = part;
  }

  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;

  return { email, name: cleanName(rawName, email) };
}

/**
 * Every address in a From, To or Cc header, lowercased, each once.
 * Anything that isn't an address — "undisclosed-recipients:;" — is dropped.
 */
export function parseAddressList(header: string | undefined): Address[] {
  if (!header) return [];

  const seen = new Set<string>();
  const addresses: Address[] = [];

  for (const part of splitAddresses(header)) {
    const address = parseAddress(part);
    if (address && !seen.has(address.email)) {
      seen.add(address.email);
      addresses.push(address);
    }
  }

  return addresses;
}

/**
 * A Subject header as readable text: encoded words decoded (the way mail
 * clients send å ä ö), whitespace collapsed. null when there's no subject.
 */
export function parseSubject(value: string | undefined): string | null {
  if (!value) return null;
  const subject = decodeEncodedWords(value).replace(/\s+/g, " ").trim();
  return subject || null;
}

function header(message: GmailMessage, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === wanted)?.value;
}

/**
 * One Gmail message as a gmail_messages row, or null when it shouldn't be
 * stored: a draft (never sent, so nobody was talked to), or a message with no
 * readable sender or date.
 *
 * Direction: outbound when Gmail labelled it SENT — which also catches mail
 * sent from an alias — or when From is the mailbox's own address.
 *
 * Whether a valid row is *kept* is lib/google/filter.ts's decision, made by
 * the sync afterwards.
 */
export function toMessageRow(
  message: GmailMessage,
  mailbox: { userId: string; ownEmail: string },
): MessageRow | null {
  const labels = message.labelIds ?? [];
  if (labels.includes("DRAFT")) return null;

  const [from] = parseAddressList(header(message, "From"));
  if (!from) return null;

  const millis = Number(message.internalDate);
  if (!Number.isFinite(millis)) return null;

  const outbound =
    labels.includes("SENT") || from.email === mailbox.ownEmail.trim().toLowerCase();

  return {
    user_id: mailbox.userId,
    gmail_message_id: message.id,
    thread_id: message.threadId,
    internal_date: new Date(millis).toISOString(),
    from_email: from.email,
    from_name: from.name,
    to_emails: parseAddressList(header(message, "To")).map((a) => a.email),
    cc_emails: parseAddressList(header(message, "Cc")).map((a) => a.email),
    subject: parseSubject(header(message, "Subject")),
    direction: outbound ? "outbound" : "inbound",
    has_list_unsubscribe: header(message, "List-Unsubscribe") !== undefined,
  };
}
