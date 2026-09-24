/**
 * Small text helpers for the screens. Pure functions, so they're tested
 * directly (tests/format.test.ts) and safe in server and client code alike.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "1 message", "1,234 messages", "1 person", "48 people". */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? singular : plural}`;
}

/** For "Last synced …": "just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(date: Date | string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(date).getTime();

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${countOf(Math.floor(elapsed / MINUTE), "minute")} ago`;
  if (elapsed < DAY) return `${countOf(Math.floor(elapsed / HOUR), "hour")} ago`;
  return `${countOf(Math.floor(elapsed / DAY), "day")} ago`;
}

/** The table's "Last" column, as in the design: "today", "6d", "120d". */
export function daysAgo(date: Date | string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(date).getTime()) / DAY);
  return days < 1 ? "today" : `${days}d`;
}

/**
 * "3 September", in Swedish time by default.
 *
 * Pages render on Vercel's servers, which run in UTC. Without a time zone,
 * mail sent at 23:30 in Sweden would show as the day before. The app has one
 * user, in Sweden; a user setting can replace the default when that changes.
 */
export function dayMonth(date: Date | string, timeZone = "Europe/Stockholm"): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone }).format(
    new Date(date),
  );
}

/** "Thursday, 11 September" — the date beside "Who needs you today". */
export function weekdayDayMonth(date: Date | string, timeZone = "Europe/Stockholm"): string {
  // Put together from parts: whether en-GB puts a comma after the weekday
  // differs between ICU versions.
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).formatToParts(new Date(date));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}

/** "4 March 2026" — dayMonth with the year, for dates that may be long ago. */
export function dayMonthYear(date: Date | string, timeZone = "Europe/Stockholm"): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(date));
}

/**
 * Avatar initials: first and last word of the name — "Maja Öberg" → "MÖ".
 * No name: the parts of the address before the @ — "karin.lindqvist@…" → "KL".
 */
export function initials(name: string | null, email: string): string {
  const words = name?.trim()
    ? name.trim().split(/\s+/)
    : email.split("@")[0].split(/[._-]+/);

  const letters = words
    .map((word) => Array.from(word).find((char) => /\p{L}/u.test(char)))
    .filter((letter): letter is string => Boolean(letter));

  if (letters.length === 0) return "?";

  const picked = letters.length === 1 ? [letters[0]] : [letters[0], letters[letters.length - 1]];
  return picked.join("").toUpperCase();
}

/**
 * The six soft avatar colour pairs used in design/ContactList.dc.html, as CSS
 * variables (app/globals.css) so a theme can change them: Paper keeps the
 * design's pastels, Night mutes them (2026-09-24).
 */
export const AVATAR_COLORS = [1, 2, 3, 4, 5, 6].map((n) => ({
  background: `var(--avatar-${n}-bg)`,
  color: `var(--avatar-${n}-ink)`,
}));

/** The same person always gets the same colour. */
export function avatarColors(key: string): { background: string; color: string } {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
