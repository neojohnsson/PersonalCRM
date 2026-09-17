import { supabaseError } from "@/lib/supabase/errors";

/**
 * Supabase answers at most 1,000 rows per request by default. Anything that
 * needs every row — every message, every contact — reads page by page.
 */
export const DEFAULT_PAGE_SIZE = 1_000;

export type PageResult = PromiseLike<{
  data: unknown[] | null;
  error: { message: string; code?: string | null } | null;
}>;

/**
 * Reads rows `pageSize` at a time until a page comes back short.
 *
 * `page(from, to)` must return the query for rows `from` to `to` inclusive —
 * `.range(from, to)` — with a stable `.order(...)`, or rows could repeat or be
 * skipped between pages.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PageResult,
  whatFailed: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw supabaseError(error, whatFailed);

    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}
