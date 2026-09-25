import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keyboard focus and hover (UI quality pass, milestone 3).
 *
 * Before: a few buttons drew an accent ring, inputs a ring of ink at 10%
 * (about 1.1:1 on white, which nobody can see), and everything else fell back
 * to the browser's own outline, a different colour on every element. Now one
 * rule in app/globals.css draws the same ring on anything focused from the
 * keyboard. The way to break that is quietly: an `outline-none` on one
 * element, with nothing drawn in its place. These tests read the source, as
 * tests/navigation.test.ts does, and hold every such place to account.
 */

const CSS = readFileSync("app/globals.css", "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    // Forward slashes on every system, so paths compare with EXCUSED below on
    // Windows too (join gives app\app-shell.tsx there).
    const path = join(dir, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

/** Every string in the app's components: "…" and `…`, class lists included. */
function strings(): { file: string; value: string }[] {
  return tsxFiles("app").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((match) => ({ file, value: match[1] ?? match[2] }));
  });
}

/**
 * The places that turn the shared ring off and draw no ring of their own,
 * each with where its focus shows instead. `mark` finds the string.
 */
const EXCUSED = [
  {
    file: "app/contacts/search-box.tsx",
    mark: "w-full min-w-0 bg-transparent text-sm",
    // The pill around the input draws the ring (focus-within), so the ring
    // goes round the whole search box, not the bare text inside it.
    instead: "focus-within:outline-accent",
  },
  {
    file: "app/assistant/composer.tsx",
    mark: "max-h-32 min-h-10 min-w-0 flex-1 resize-none",
    // The Assistant's box darkens its border instead. It has focus most of
    // the time it is on screen, and a ring round it all the time would shout;
    // the user's decision, 2026-09-25.
    instead: "focus-within:border-ink-soft",
  },
  {
    file: "app/shell-frame.tsx",
    mark: "flex min-w-0 flex-1 flex-col focus:outline-none",
    // #main-content: where "Skip to main content" puts focus. tabIndex -1,
    // so Tab never reaches it; a ring round the whole page would be noise.
    instead: "tabIndex={-1}",
  },
];

describe("keyboard focus", () => {
  it("is one ring for everything, in the accent, drawn by one rule", () => {
    const base = CSS.slice(CSS.indexOf("@layer base {"));
    expect(base).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--color-accent\);\s*outline-offset: 2px;/);
  });

  it("never comes back as the invisible ring of ink at 10%", () => {
    for (const { file, value } of strings()) {
      // Focus rings only: the draft card's chosen tone wears a faint ring as
      // a "this one" mark, which is not focus.
      expect(value, file).not.toMatch(/focus(-visible|-within)?:(after:)?ring-ink\/\d+/);
      // A ring on :focus shows for a mouse click too; the shared ring is
      // :focus-visible, keyboard only.
      expect(value, file).not.toMatch(/(^|\s)focus:ring-/);
    }
  });

  it("is never turned off without being drawn some other way", () => {
    const offenders: string[] = [];
    for (const { file, value } of strings()) {
      if (!/(^|[\s:])outline-none(\s|$)/.test(value)) continue;
      // Draws its own ring on the same element: the dark rail's white one.
      if (/focus-visible:ring-2/.test(value)) continue;
      const excuse = EXCUSED.find((entry) => entry.file === file && value.includes(entry.mark));
      if (excuse) continue;
      offenders.push(`${file}: "${value.slice(0, 80)}…"`);
    }
    expect(offenders).toEqual([]);
  });

  it("is shown some other way wherever it is excused, as each excuse says", () => {
    for (const { file, instead } of EXCUSED) {
      expect(readFileSync(file, "utf8"), file).toContain(instead);
    }
  });

  it("draws round the whole row when the row is the link", () => {
    // The stretched link hides its own ring and draws the shared one on the
    // ::after that covers the row, just inside it.
    const utility = CSS.slice(CSS.indexOf("@utility stretched-link"));
    expect(utility).toMatch(/&:focus-visible::after \{\s*outline: 2px solid var\(--color-accent\);\s*outline-offset: -2px;/);
  });

  it("stays inside the phone's bottom bar, which sits on the screen's edge", () => {
    const shell = readFileSync("app/shell-frame.tsx", "utf8");
    const item = shell.slice(shell.indexOf("function BottomItem("), shell.indexOf("function NavItem("));
    expect(item).toContain("focus-visible:-outline-offset-2");
  });
});

describe("hover", () => {
  it("has one rule per kind of link, and only on a device that can hover", () => {
    for (const name of ["link-action", "link-inline"]) {
      const utility = CSS.slice(CSS.indexOf(`@utility ${name}`));
      expect(utility, name).toMatch(/^@utility [\w-]+ \{[\s\S]*?@media \(hover: hover\) \{\s*&:hover \{/);
    }
  });

  it("underlines a card's link when the pointer is on it", () => {
    // The blue links in the Assistant's cards ("Open contact") changed
    // nothing on hover. A link written that way uses link-action now.
    for (const file of tsxFiles("app")) {
      const source = readFileSync(file, "utf8");
      for (const [tag] of source.matchAll(/<(?:Link|a)\s[^>]*className="[^"]*text-info-ink[^"]*"[^>]*>/g)) {
        expect(tag, file).toMatch(/link-action|hover:/);
      }
    }
  });

  it("darkens a link in a sentence when the pointer is on it", () => {
    // Seven on the legal and pricing pages had an underline and nothing on
    // hover. An underline written by hand has to bring its own hover.
    for (const { file, value } of strings()) {
      if (!/(^|\s)underline(\s|$)/.test(value)) continue;
      expect(value, file).toMatch(/hover:/);
    }
  });
});
