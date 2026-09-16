/**
 * Supabase returns errors as plain objects ({ code, message, details, hint }),
 * not as Error instances. Thrown as they are, Next.js shows them as
 * "Uncaught Error: {code: …}" — unreadable, and with no hint of which query
 * failed.
 *
 * This turns one into a real Error that says what was being done, keeps
 * Supabase's own message and code, and keeps the original as `cause`.
 */
export function supabaseError(
  error: { message: string; code?: string | null },
  whatFailed: string,
): Error {
  const code = error.code ? ` (${error.code})` : "";
  return new Error(`${whatFailed}: ${error.message}${code}`, { cause: error });
}
