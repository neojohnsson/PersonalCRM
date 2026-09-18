/**
 * An email as Gmail's API wants it: one RFC 2822 message, base64url.
 *
 * Two details that break Swedish mail if you get them wrong:
 *   - Headers are ASCII only, so a subject with å ä ö is encoded
 *     (RFC 2047: =?UTF-8?B?<base64>?=).
 *   - The body is sent as UTF-8 base64, with the headers saying so, rather
 *     than raw bytes that a line-wrapping proxy could mangle.
 *
 * Only ever used to create a DRAFT (AGENTS.md: no send capability, ever).
 */

export type ReplyMessage = {
  to: string;
  subject: string;
  body: string;
  /** The Message-ID being answered, and the thread's ids so far. */
  inReplyTo: string | null;
  references: string | null;
};

/** Base64 in 76-character lines, as mail bodies are written. */
function base64Lines(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** A header value: left as it is when ASCII, encoded when not. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** The whole message, ready for Gmail's `raw` field. */
export function buildReplyMessage(message: ReplyMessage): string {
  const headers = [
    `To: ${encodeHeader(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : null,
    message.references ? `References: ${message.references}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);

  const raw = `${headers.join("\r\n")}\r\n\r\n${base64Lines(message.body)}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Reads a message built above — for tests, and for reading back what was sent. */
export function decodeRawMessage(raw: string): { headers: string; body: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const split = text.indexOf("\r\n\r\n");
  const headers = split === -1 ? text : text.slice(0, split);
  const encodedBody = split === -1 ? "" : text.slice(split + 4);
  return { headers, body: Buffer.from(encodedBody.replace(/\r\n/g, ""), "base64").toString("utf8") };
}
