/**
 * Where web research never looks (docs/slice-12-plan.md §3; plan.md §4.1).
 *
 * Passed to OpenAI's web_search as `blocked_domains`, so these are refused by
 * the search itself -- and checked again on every link that comes back,
 * because a list in someone else's API is a promise, and this is the proof.
 * Subdomains count: "se.linkedin.com" is LinkedIn.
 *
 *   LinkedIn        forbids automated access; the app never reads it
 *   people search   Swedish and international lookups of people: home
 *                   addresses, ages, incomes, phone numbers. A data broker is
 *                   the fastest way to process personal data with no lawful
 *                   basis (plan.md §4.1)
 *   sales data      the enrichment tools that sell contact details
 *   social media    personal accounts are private life, not work (decided
 *                   2026-09-23)
 *
 * tests/research.test.ts pins every one of them; dropping one fails it.
 */
export const BLOCKED_DOMAINS = [
  // LinkedIn
  "linkedin.com",
  // People search, Sweden
  "ratsit.se",
  "merinfo.se",
  "mrkoll.se",
  "hitta.se",
  "eniro.se",
  "upplysning.se",
  "birthday.se",
  "adresskollen.se",
  // People search, elsewhere
  "spokeo.com",
  "whitepages.com",
  "pipl.com",
  "beenverified.com",
  "truepeoplesearch.com",
  "radaris.com",
  // Sales data and enrichment
  "zoominfo.com",
  "apollo.io",
  "rocketreach.co",
  "lusha.com",
  "contactout.com",
  "signalhire.com",
  "hunter.io",
  "clearbit.com",
  // Personal social media
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "snapchat.com",
] as const;

/** Whether a link is on a blocked domain or one of its subdomains. */
export function isBlocked(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    // Not a link at all: nothing a fact could cite.
    return true;
  }
  return BLOCKED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
