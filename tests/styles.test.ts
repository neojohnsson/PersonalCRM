import { readFileSync } from "node:fs";
import { transform } from "lightningcss";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet, and the themes in it (2026-09-24).
 *
 * Found the hard way: a Night rule targeting Tailwind's
 * `shadow-[0_1px_2px_rgba(20,20,25,.04),…]` class left the "." in ".04"
 * unescaped. The CSS parser refused the whole file, every page answered 500,
 * and all 921 tests still passed, because none of them read the CSS. This one
 * parses it with the same parser Next uses.
 */

const css = readFileSync("app/globals.css", "utf8");

describe("the stylesheet", () => {
  it("parses: one bad selector takes every page down with it", () => {
    expect(() =>
      transform({ filename: "globals.css", code: Buffer.from(css), errorRecovery: false }),
    ).not.toThrow();
  });
});

describe("the themes", () => {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} is missing`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("give Night its own value for every colour that carries a meaning", () => {
    // Left on their light values, these were dark ink on dark cards: the
    // green Done box, amber, the red of danger, the orange inks.
    const night = block(':root[data-theme="night"]');
    for (const name of ["affirm", "cooling", "danger", "decide", "done-tint", "needs-ink", "alert-ink", "ink", "paper", "line"]) {
      expect(night, name).toContain(`--theme-${name}:`);
    }
  });

  it("keep Night to a few quiet layers, and no shadows", () => {
    // 2026-09-24, the user: "so many different colours and layers, and the
    // stuff around looks so sharp". It had 13 backgrounds, 3 border greys and
    // 4 kinds of shadow on one page.
    const night = block(':root[data-theme="night"]');
    const value = (name: string) => night.match(new RegExp(`--theme-${name}: (#[0-9a-f]{6});`))![1];
    // One border colour, not three.
    expect(value("line-soft")).toBe(value("line"));
    // Chips and their track are one raised tone.
    expect(value("chip-track")).toBe(value("chip"));
    // Every Tailwind shadow is emptied in Night.
    expect(css).toMatch(/:root\[data-theme="night"\] \* \{\s*--tw-shadow: 0 0 #0000 !important;/);
    // Avatars are theme variables, so Night can mute the six pastels.
    for (let n = 1; n <= 6; n += 1) expect(night).toContain(`--avatar-${n}-bg:`);
  });

  it("leave no colour written into a class where a theme cannot reach it", () => {
    // text-[#7c3a12] was in three files; a theme cannot change a colour that
    // is not a token.
    for (const file of ["app/assistant/chat.tsx", "app/contacts/contact-form.tsx", "app/intro-screen.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
    }
  });

  it("keep the sidebar's logo white in every theme", () => {
    // Night repaints .bg-white; the logo used it and disappeared.
    expect(readFileSync("app/app-shell.tsx", "utf8")).toContain("bg-rail-logo");
    expect(css).toMatch(/--color-rail-logo: #ffffff;/);
  });
});
