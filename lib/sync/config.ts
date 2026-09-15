/** Used when SYNC_DEFAULT_LOOKBACK_DAYS isn't set: slice-1-plan.md, decision 1. */
export const DEFAULT_LOOKBACK_DAYS = 90;

/** How many days back a first sync reads. */
export function lookbackDays(): number {
  const days = Number(process.env.SYNC_DEFAULT_LOOKBACK_DAYS);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_LOOKBACK_DAYS;
}
