/**
 * The places you can go in the signed-in app, in the order the sidebar shows
 * them.
 *
 * It is a list of plain data, away from the shell that draws it, for two
 * reasons. The rail, the bottom bar on a phone and the header's page switcher
 * all read this one list, so a page can never appear in one and be missing
 * from another — which is exactly how the phone ended up with no navigation at
 * all until slice 9b. And a list is something tests/navigation.test.ts can
 * read: it checks that every entry here has a page behind it, because
 * "a nav item that goes nowhere would be a lie" (app/app-shell.tsx).
 *
 * `label` is the word on the bottom bar, the page switcher and the rail's
 * hover label. `title` is the longer name where there is room for it — Home is
 * the only one where they differ, because the page is called "Who needs you
 * today" and no bottom bar has room for four words.
 *
 * Profile is not here: it sits apart at the foot of the rail, as in
 * design/Profile.dc.html, and the bottom bar adds it at the end itself.
 *
 * `premium` pages are shown only to somebody entitled to them (slice 11):
 * the Assistant, switched on per account in `entitlements`. Everybody else
 * gets the four, and /assistant sends them Home.
 */
export const PAGES = [
  { key: "home", href: "/", label: "Home", title: "Who needs you today", premium: false },
  { key: "assistant", href: "/assistant", label: "Assistant", title: "Assistant", premium: true },
  { key: "calendar", href: "/calendar", label: "Calendar", title: "Calendar", premium: false },
  { key: "contacts", href: "/contacts", label: "Contacts", title: "Contacts", premium: false },
  { key: "seen-once", href: "/seen-once", label: "Seen once", title: "Seen once", premium: false },
] as const;

export type PageKey = (typeof PAGES)[number]["key"];

/** The pages this person may see, in rail order. One list for every navigation. */
export function visiblePages(assistant: boolean) {
  return PAGES.filter((page) => !page.premium || assistant);
}

/** Which navigation entry is the current page. */
export type ActivePage = PageKey | "profile";
