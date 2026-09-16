/** Longer search text is cut to this, not rejected. */
export const MAX_QUERY_LENGTH = 100;

/**
 * The search box's `?q=` as clean text: the first value if the parameter was
 * repeated, trimmed, inner whitespace collapsed, at most MAX_QUERY_LENGTH.
 */
export function normaliseQuery(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * A pattern for `ilike` that finds `query` anywhere in the text.
 *
 * In SQL patterns `%` means "anything" and `_` means "any one character". A
 * search for "50%" should find the text "50%", not everything starting with 50,
 * so both — and the backslash that escapes them — are escaped first.
 */
export function ilikePattern(query: string): string {
  const escaped = query.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
