import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES, visiblePages } from "@/lib/nav";

/**
 * Slice 9b, Part 1: the app had no navigation at all on a phone. The sidebar
 * is hidden below the sm breakpoint and nothing replaced it — no hamburger, no
 * bar. The first outside test of the app found it in a minute:
 *
 *   "There is no navigation on mobile. The row actions only show on hover, so
 *    touch users can't reach them."
 *
 * There is no DOM in this suite, so these read the source, the way
 * tests/no-send.test.ts does for the send rule. That is enough for the claims
 * that matter, because each one is about what the code says, not what a
 * browser paints: one list of pages behind every navigation, every entry
 * leading somewhere real, no action reachable by hover alone, and no
 * destructive button in a page header.
 */

const SHELL = readFileSync("app/shell-frame.tsx", "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * The source with its comments taken out, for checks about what a screen
 * *says*. A comment that explains what a button used to be called is exactly
 * the kind of history this project keeps, so it must not fail a test about
 * today's wording.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `className="…"` in the app, as one string each. */
function classNames(): { file: string; value: string }[] {
  return tsxFiles("app").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/className="([^"]*)"/g)].map((match) => ({ file, value: match[1] }));
  });
}

describe("the pages you can navigate to", () => {
  it("each lead somewhere that exists", () => {
    // "A nav item that goes nowhere would be a lie" (app/app-shell.tsx). This
    // is that sentence as a test: /calendar needs app/calendar/page.tsx.
    for (const page of PAGES) {
      const file = page.href === "/" ? "app/page.tsx" : `app${page.href}/page.tsx`;
      expect(existsSync(file), `${page.href} has no page`).toBe(true);
    }
  });

  it("are five at most, with a word short enough for a bottom bar", () => {
    expect(PAGES.length).toBeLessThanOrEqual(5);
    for (const page of PAGES) {
      expect(page.label.length, `${page.label} is too long for the bar`).toBeLessThanOrEqual(10);
    }
  });

  it("do not include Your week or Promises, which the Assistant replaced in slice 11", () => {
    const hrefs = PAGES.map((page) => page.href);
    expect(hrefs).not.toContain("/brief");
    expect(hrefs).not.toContain("/promises");
    // Gone, not hidden: no page at either address...
    expect(existsSync("app/brief/page.tsx")).toBe(false);
    expect(existsSync("app/promises/page.tsx")).toBe(false);
    // ...and nothing anywhere links to one. The promise queue lives on under
    // the Assistant, at /assistant/promises.
    const linking = sourceFiles("app").filter((file) => /["'`]\/(brief|promises)["'`/?#]/.test(readFileSync(file, "utf8")));
    expect(linking).toEqual([]);
    expect(existsSync("app/assistant/promises/page.tsx")).toBe(true);
  });

  it("keep the promise queue behind the Assistant, page and actions alike", () => {
    const page = readFileSync("app/assistant/promises/page.tsx", "utf8");
    expect(page).toContain('if (!(await hasAssistant(supabase, user.id))) redirect("/")');
    // Accept, dismiss and scan each check for themselves: a POST does not
    // come through the page.
    const actions = readFileSync("app/assistant/promises/actions.ts", "utf8");
    const exported = actions.match(/^export async function \w+/gm) ?? [];
    const gated = actions.match(/if \(!\(await hasAssistant\(supabase, user\.id\)\)\) notFound\(\);/g) ?? [];
    expect(exported).toHaveLength(3);
    expect(gated).toHaveLength(exported.length);
  });
});

/** Every source file under a folder. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the sidebar and the bottom bar", () => {
  it("are both built from the same list", () => {
    // The rail maps it and the bottom bar maps it. If one grows a hard-coded
    // entry, they drift and a page goes missing from one. Since slice 11 it
    // is the list filtered for this person -- still one list, worked out once
    // in the shell and handed to both. (The header's page switcher mapped it
    // too, until the UI quality pass removed it.)
    // The bottom bar leaves one out, Seen once, which folds into Contacts on
    // a phone (UI quality pass, milestone 5): five items fit, six did not.
    expect(SHELL.match(/pages(?:\s*\.filter\([\s\S]*?\))?\s*\.map\(/g)).toHaveLength(2);
    expect(SHELL).toContain('.filter((page) => page.key !== "seen-once")');
    // Worked out by AppShell for this person; the loading skeleton uses the
    // same function for its frame (every plan has the Assistant).
    expect(readFileSync("app/app-shell.tsx", "utf8").match(/visiblePages\(/g)).toHaveLength(1);
    expect(readFileSync("app/skeletons.tsx", "utf8")).toContain("visiblePages(true)");
    for (const page of PAGES) {
      if (page.href === "/") continue;
      expect(SHELL.includes(`href="${page.href}"`), `${page.href} is hard-coded`).toBe(false);
    }
  });

  it("has a bottom bar that only shows on a phone, and gets out of the way of the content", () => {
    expect(SHELL).toContain("function BottomBar(");
    // Fixed to the bottom, hidden from sm up, with room reserved for it so it
    // doesn't cover the last row of a list.
    expect(SHELL).toMatch(/fixed inset-x-0 bottom-0[^"]*sm:hidden/);
    expect(SHELL).toMatch(/pb-\[74px\] sm:pb-0/);
  });

  it("puts a word under every icon on the bottom bar", () => {
    // The report could not tell the icons apart even on desktop, where they
    // had tooltips. Labels, then.
    expect(SHELL).toMatch(/\{label\}/);
    expect(SHELL).toContain('label="You"');
  });

  it("has one navigation per screen, with a word under every icon on the rail too", () => {
    // UI quality pass, milestone 3 (the user's decision, 2026-09-25): the
    // header's page switcher and the rail held the same links on every
    // desktop screen, so a screen reader heard them twice. The switcher went;
    // its words, there because the first outside test could not tell the
    // rail's icons apart, moved under the rail's icons.
    expect(SHELL).not.toContain("function PageSwitcher(");
    expect(SHELL).not.toContain('aria-label="Switch page"');
    // The rail on a wide screen, the bottom bar on a phone: one landmark each.
    expect(SHELL.match(/aria-label="Main"/g)).toHaveLength(1);
    expect(SHELL.match(/aria-label="Pages"/g)).toHaveLength(1);
    // The word is on screen, not only for a screen reader.
    const navItem = SHELL.slice(SHELL.indexOf("function NavItem("), SHELL.indexOf("function HoverLabel("));
    expect(navItem).toMatch(/<span className=\{`[^`]*\btext-(?:2xs|xs)\b[^`]*`\}>\{label\}<\/span>/);
    expect(navItem).not.toMatch(/sr-only[^>]*>\{label\}/);
  });

  it("gives the rail's icons a label that doesn't wait a second for a tooltip", () => {
    expect(SHELL).toContain("function HoverLabel(");
    expect(SHELL).toMatch(/group-hover:opacity-100 group-focus-visible:opacity-100/);
    // The `title` attribute was what it had before, and what was not enough.
    expect(SHELL.includes("title={label}")).toBe(false);
  });
});

describe("going to another page", () => {
  // UI quality pass, milestone 3: a press on a link changed nothing on screen
  // until the next page arrived, and every page here is built on the server
  // per request. useLinkStatus (next/link) says a Link is on its way.
  const PENDING = readFileSync("app/nav-pending.tsx", "utf8");
  const CSS = readFileSync("app/globals.css", "utf8");

  it("shows on every navigation item: the rail, the Profile avatar and the bottom bar", () => {
    for (const name of ["function NavItem(", "function BottomItem("]) {
      const start = SHELL.indexOf(name);
      const body = SHELL.slice(start, SHELL.indexOf("\n}\n", start));
      expect(body, name).toContain("<NavPending");
    }
    const profile = SHELL.slice(SHELL.indexOf('href="/profile"'), SHELL.indexOf("</aside>"));
    expect(profile).toContain("<NavPending");
    expect(PENDING).toMatch(/export function NavPending[\s\S]*useLinkStatus\(\)/);
  });

  it("fades the row of a contact while their page opens, in every list", () => {
    // Six lists open a contact from a row. All of them go through RowLink, so
    // the stretched link and the fade are written once.
    expect(PENDING).toMatch(/export function RowLink[\s\S]*stretched-link[\s\S]*<RowPending \/>/);
    for (const file of tsxFiles("app")) {
      if (file.endsWith("nav-pending.tsx")) continue;
      expect(readFileSync(file, "utf8"), `${file} stretches a link by hand`).not.toContain("stretched-link");
    }
    const rows = tsxFiles("app").filter((file) => readFileSync(file, "utf8").includes("<RowLink"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("waits 100ms before showing, so a fast page does not flash it", () => {
    expect(CSS).toMatch(/\.nav-pending\.is-pending \{\s*animation: nav-pending 0\.9s ease-in-out 0\.1s infinite;/);
    expect(CSS).toMatch(/\.row-pending\.is-pending \{\s*animation: row-pending 0\.2s ease-out 0\.1s forwards;/);
    // Less motion asked for: a steady bar, not a pulse.
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*nav-pending-steady/);
  });
});

describe("what you can do to a row", () => {
  it("is never hidden from a screen that cannot hover", () => {
    // Draft reply and Not needed were `hidden ... group-hover:opacity-100`:
    // invisible on a phone, and there is no hover to bring them back.
    for (const { file, value } of classNames()) {
      // The shell's one hover-revealed thing is HoverLabel: a decoration on a
      // rail icon, and the rail itself does not exist below sm. It is right
      // for that to be hidden on a phone; a row action never is.
      if (file.endsWith(join("app", "shell-frame.tsx"))) continue;
      if (!value.includes("group-hover:opacity-100")) continue;
      expect(value.includes("hidden"), `${file}: a hover-only action is hidden`).toBe(false);
      expect(value, `${file}: a hover-only action needs no-hover:`).toContain(
        "no-hover:opacity-100",
      );
    }
  });

  it("has the no-hover variant it depends on", () => {
    // The classes above do nothing at all unless the variant is declared.
    expect(readFileSync("app/globals.css", "utf8")).toContain(
      "@custom-variant no-hover (@media (hover: none))",
    );
  });
});

describe("Disconnect Gmail", () => {
  it("is only on Profile, never in a page header", () => {
    // It throws away the connection and everything the sync needs. In the
    // header it was the first thing a thumb reached on a phone.
    const users = tsxFiles("app").filter(
      (file) =>
        !file.endsWith(join("app", "disconnect-gmail-button.tsx")) &&
        readFileSync(file, "utf8").includes("DisconnectGmailButton"),
    );
    expect(users).toEqual([join("app", "profile", "page.tsx")]);
  });
});

/**
 * Slice 9b, Part 2: the contact page's header. Seven controls in a row, one
 * of which ("Dismiss") deleted the contact without saying so, and one of
 * which ("Draft reply") did nothing at all.
 */
describe("the contact page's header", () => {
  const PAGE = readFileSync(join("app", "contacts", "[id]", "page.tsx"), "utf8");
  const MENU = readFileSync(join("app", "contacts", "[id]", "contact-menu.tsx"), "utf8");

  it("is the design's three controls: the pill, the menu, Draft reply", () => {
    expect(PAGE).toContain("<ContactMenu");
    expect(PAGE).toContain("<HeaderDraftButton");
    expect(PAGE).toContain("<TurnPillBadge");
    // Everything else it had grown is in the menu now, and the two components
    // that held them are gone.
    expect(existsSync(join("app", "contacts", "[id]", "dismiss-contact.tsx"))).toBe(false);
    expect(existsSync(join("app", "contacts", "[id]", "standing-actions.tsx"))).toBe(false);
    expect(PAGE.includes("StandingActions")).toBe(false);
    expect(PAGE.includes("DismissContact")).toBe(false);
  });

  it("can wrap, so the page stops scrolling sideways on a phone", () => {
    // `shrink-0` on a `flex-wrap` row is why the page was 872px wide at 390px:
    // the row could never wrap.
    expect(PAGE).toContain('className="flex flex-wrap items-center gap-[9px] pt-1"');
    expect(PAGE.includes('flex shrink-0 flex-wrap items-center gap-[9px]')).toBe(false);
  });

  it("says that deleting deletes, in red", () => {
    expect(MENU).toContain("Delete contact and their mail");
    expect(MENU).toContain("LINE_DANGER");
    expect(MENU).toContain("bg-danger");
    // A colour class needs its token, or it silently does nothing.
    expect(readFileSync(join("app", "globals.css"), "utf8")).toContain("--color-danger:");
    // "Dismiss" was the word nobody read as "delete".
    expect(MENU.includes(">Dismiss<")).toBe(false);
  });

  it("has one name for finishing a conversation, not three", () => {
    // "Nothing owed here", "Not needed" and "Nothing more is owed in this
    // conversation" were the same action under three names. Comments are
    // stripped first: the components still explain what they used to say, and
    // that history is worth keeping.
    for (const file of tsxFiles("app")) {
      const source = withoutComments(readFileSync(file, "utf8"));
      expect(source.includes("Nothing owed here"), `${file} still says "Nothing owed here"`).toBe(false);
      expect(source.includes("Not needed"), `${file} still says "Not needed"`).toBe(false);
    }
    expect(MENU).toContain("Mark this conversation done");
    expect(readFileSync(join("app", "conversation-done-button.tsx"), "utf8")).toContain(
      "Conversation done",
    );
  });

  it("has a Draft reply that drafts, and no Draft reply when it cannot", () => {
    const BUTTON = readFileSync(join("app", "contacts", "[id]", "header-draft-button.tsx"), "utf8");
    // It was href="#draft" on a page where the panel is already visible.
    expect(BUTTON).toContain("generateDraftAction");
    expect(PAGE).toContain("{canDraftNow && <HeaderDraftButton");
    // The four facts that decide it are the four the panel below is given.
    for (const fact of ["budget.ready", "canDraft(gmailScopes)", "relationship.messageCount > 0"]) {
      expect(PAGE).toContain(fact);
    }
  });
});

/**
 * Slice 9b, Part 6: the controls that were not controls, and the words that
 * were not true.
 */
describe("nothing that looks interactive and isn't", () => {
  it("has a 404 of its own, for a page and for a contact", () => {
    expect(existsSync(join("app", "not-found.tsx"))).toBe(true);
    expect(existsSync(join("app", "contacts", "[id]", "not-found.tsx"))).toBe(true);
    // Both keep the app shell, so a 404 has a way out of it.
    for (const file of [join("app", "not-found.tsx"), join("app", "contacts", "[id]", "not-found.tsx")]) {
      expect(readFileSync(file, "utf8")).toContain("<AppShell");
    }
  });

  it("no longer dresses the sort label as a pill", () => {
    const source = readFileSync(join("app", "contacts", "page.tsx"), "utf8");
    // It read as a dropdown beside Sync now, and was a label.
    expect(source.includes("${WHITE_PILL} hidden lg:flex")).toBe(false);
    expect(source).toContain("sortLabel(sort)");
    // The order is chosen in the headings instead, and they are real links.
    expect(source).toContain("function SortHeading(");
    expect(source).toContain("aria-sort");
  });

  it("gives the date inputs a Swedish order", () => {
    // mm/dd/yyyy to somebody in Växjö.
    for (const file of [
      join("app", "contacts", "[id]", "next-touch-card.tsx"),
      join("app", "assistant", "promises", "promise-card.tsx"),
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('type="date"');
      expect(source, `${file} has a date input with no lang`).toContain('lang="sv"');
    }
  });

  it("tells the AI to write dates the way people say them", () => {
    // It was given ISO dates and wrote them straight back out: "on 2026-09-21".
    expect(readFileSync(join("lib", "ai", "summary.ts"), "utf8")).toContain("never 2026-09-11");
  });

  it("warns before an edited contact form is abandoned", () => {
    const source = readFileSync(join("app", "contacts", "contact-form.tsx"), "utf8");
    expect(source).toContain("beforeunload");
    // Cancel is this app's own link, so it asks in words instead.
    expect(source).toContain("Leave without saving?");
    // A failed save moves to the first thing that is wrong.
    expect(source).toContain("scrollIntoView");
  });
});

/**
 * Slice 11: the Assistant is premium. It is in the navigation only for an
 * account that includes it, and in the same place in all three.
 */
describe("the Assistant in the navigation", () => {
  it("is second, and only for an account that includes it", () => {
    expect(visiblePages(true).map((page) => page.key)).toEqual([
      "home",
      "assistant",
      "calendar",
      "contacts",
      "seen-once",
    ]);
    expect(visiblePages(false).map((page) => page.key)).toEqual(["home", "calendar", "contacts", "seen-once"]);
  });

  it("is the only premium page, so nothing else can vanish for a free account", () => {
    expect(PAGES.filter((page) => page.premium).map((page) => page.key)).toEqual(["assistant"]);
  });
});

describe("the Assistant page", () => {
  it("sends anyone without the Assistant back Home before loading anything", () => {
    const source = readFileSync(join("app", "assistant", "page.tsx"), "utf8");
    const check = source.indexOf("hasAssistant(supabase, user.id)");
    const firstLoad = source.indexOf("Promise.all(");
    expect(check).toBeGreaterThan(-1);
    expect(source).toContain('redirect("/")');
    // The check comes first: nobody without it causes a single query about
    // their contacts to run on this page.
    expect(check).toBeLessThan(firstLoad);
  });

  it("puts the chat last, under the cards that work without it", () => {
    const source = readFileSync(join("app", "assistant", "page.tsx"), "utf8");
    expect(source.indexOf("<AssistantChat")).toBeGreaterThan(source.indexOf("<ThingsToDecide"));
  });

  it("scrolls the chat as ChatGPT does: the page, not a box inside it", () => {
    // 2026-09-24: a conversation capped at 60% of the window with its own
    // scrollbar jumped about while answers came in. It is part of the page
    // now, followed down while you are at the bottom, with an arrow back.
    const chat = readFileSync(join("app", "assistant", "chat.tsx"), "utf8");
    const section = chat.slice(chat.indexOf('aria-label="Conversation"'), chat.indexOf("{entries.map"));
    expect(section).not.toMatch(/overflow-y-(auto|scroll)|max-h-/);
    expect(chat).toContain("function useFollowLatest(");
    expect(chat).toContain('aria-label="Scroll to the latest"');
  });

  it("never has a send button, even in the chat", () => {
    // The app's rule against send buttons covers words too: the chat's
    // button says Ask. Since the bar became round (2026-09-23) the word is
    // what a screen reader hears, as the button shows only an arrow.
    const bar = readFileSync(join("app", "assistant", "composer.tsx"), "utf8");
    // The button's word on a line of its own, as JSX lays it out.
    expect(bar).toMatch(/^\s*Ask\s*$/m);
    for (const file of ["composer.tsx", "chat.tsx", "needs-you.tsx"]) {
      const source = readFileSync(join("app", "assistant", file), "utf8");
      expect(source, file).not.toMatch(/^\s*Send\s*$/m);
      expect(source, file).not.toMatch(/aria-label="Send/);
    }
  });
});
