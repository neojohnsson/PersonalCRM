import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES } from "@/lib/nav";

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

const SHELL = readFileSync("app/app-shell.tsx", "utf8");

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

  it("do not include Your week or Promises, which left the rail in 9b", () => {
    // They still work at their addresses; Home links to them (Part 7).
    const hrefs = PAGES.map((page) => page.href);
    expect(hrefs).not.toContain("/brief");
    expect(hrefs).not.toContain("/promises");
    expect(readFileSync("app/page.tsx", "utf8")).toContain('href="/brief"');
    expect(readFileSync("app/brief/page.tsx", "utf8")).toContain('href="/promises"');
  });
});

describe("the sidebar and the bottom bar", () => {
  it("are both built from the same list, and so is the header's switcher", () => {
    // The rail maps it, the bottom bar maps it, the switcher maps it. If one
    // grows a hard-coded entry, they drift and a page goes missing from one.
    expect(SHELL.match(/PAGES\.map\(/g)).toHaveLength(3);
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

  it("has the header's page switcher, in words, on a wide enough window", () => {
    // The designs carry it on five screens and it was left out of all of
    // them until slice 9b. Words, not the icon variant: the same report that
    // could not read the rail's icons would not read four more.
    expect(SHELL).toContain("function PageSwitcher(");
    expect(SHELL).toMatch(/\{page\.label\}/);
    // Hidden below md, where it would sit under Sign out.
    expect(SHELL).toMatch(/absolute left-1\/2 hidden[^"]*md:flex/);
    // Two navigations both called "Pages" would read as one landmark twice.
    expect(SHELL).toContain('aria-label="Switch page"');
    expect(SHELL.match(/aria-label="Pages"/g)).toHaveLength(1);
  });

  it("gives the rail's icons a label that doesn't wait a second for a tooltip", () => {
    expect(SHELL).toContain("function HoverLabel(");
    expect(SHELL).toMatch(/group-hover:opacity-100 group-focus-visible:opacity-100/);
    // The `title` attribute was what it had before, and what was not enough.
    expect(SHELL.includes("title={label}")).toBe(false);
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
      if (file.endsWith(join("app", "app-shell.tsx"))) continue;
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
