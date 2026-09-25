import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

  it("give Night its structure with edges instead of shadows", () => {
    // UI quality pass, milestone 2 (2026-09-25): a card on the page is
    // 1.10:1, so without shadows Night was one flat field. Every surface
    // that had a shadow gets a 1px edge in the one line colour instead.
    expect(css).toMatch(
      /:root\[data-theme="night"\] \.bg-white\[class\*="shadow-"\]:not\(\[class~="border"\]\) \{\s*--tw-inset-ring-shadow: inset 0 0 0 1px var\(--theme-line\);/,
    );
    const night = block(':root[data-theme="night"]');
    // The rail is its own plane, with its own line.
    expect(night).toMatch(/--theme-rail-edge: #[0-9a-f]{6};/);
    expect(readFileSync("app/shell-frame.tsx", "utf8")).toContain("border-r border-rail-edge bg-rail");
    // The scrollbar is Night's, not Paper's light thumb on a dark page.
    expect(night).toContain("--scrollbar-thumb:");
  });

  it("draw outlines with rings, never with inset shadows, which Night erases", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
      });
    for (const file of files("app")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/shadow-\[inset_/);
    }
  });

  it("leave no colour written into a class where a theme cannot reach it", () => {
    // text-[#7c3a12] was in three files; a theme cannot change a colour that
    // is not a token.
    for (const file of ["app/assistant/chat.tsx", "app/contacts/contact-form.tsx", "app/intro-screen.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
    }
  });

  it("have four text greys, each clearing WCAG AA where text actually sits", () => {
    // UI quality pass, milestone 1 (2026-09-25): five of the design's eight
    // greys failed AA on white while carrying calendar hours, form labels and
    // table headers. Each text grey must clear 4.5:1 on the card AND on the
    // page behind it, in both themes.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    for (const selector of [":root", ':root[data-theme="night"]']) {
      const theme = block(selector);
      const value = (name: string) => theme.match(new RegExp(`--theme-${name}: (#[0-9a-f]{6});`))![1];
      for (const text of ["ink", "ink-body", "ink-soft", "ink-meta"]) {
        for (const surface of ["white", "paper"]) {
          expect(ratio(value(text), value(surface)), `${selector} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // The smallest text also sits on raised tiles: the month on a date badge.
      expect(ratio(value("ink-meta"), value("chip")), `${selector} ink-meta on chip`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("have no deleted grey left in a class, and no Studio", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    for (const file of [...files("app"), ...files("lib")]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/ink-(muted|quiet|faint|ghost|hush)\b/);
    }
    expect(css).not.toMatch(/ink-(muted|quiet|faint|ghost|hush)\b/);
    expect(css).not.toContain('data-theme="studio"');
  });

  it("have one type and shape scale, and nothing off it", () => {
    // UI quality pass, milestone 4 (2026-09-25): 23 font sizes and 14 radii,
    // most a half-step apart. Seven sizes, each with a line height on the
    // 4px grid; three radii; three weights.
    const steps = [...css.matchAll(/--text-([0-9a-z]+): (\d+)px;\s*--text-\1--line-height: (\d+)px;/g)];
    expect(steps.map((step) => step[1])).toEqual(["2xs", "xs", "sm", "base", "lg", "xl", "2xl"]);
    for (const [, name, , lineHeight] of steps) expect(Number(lineHeight) % 4, `${name} line height`).toBe(0);
    expect(css).toContain("--text-*: initial;");
    expect(css).toContain("--radius-*: initial;");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    for (const file of [...files("app"), ...files("lib")]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file}: a font size off the scale`).not.toMatch(/\btext-\[[0-9.]+px\]/);
      expect(source, `${file}: a radius off the scale`).not.toMatch(/\brounded(-[trbl]{1,2})?-\[[0-9.]+px\]/);
      expect(source, `${file}: a weight off the scale`).not.toMatch(/\bfont-(medium|extrabold|black|light|thin)\b/);
      expect(source, `${file}: a line height off the grid`).not.toMatch(/\bleading-\[[0-9.]+\]/);
    }
  });

  it("keep the sidebar's logo white in every theme", () => {
    // Night repaints .bg-white; the logo used it and disappeared.
    expect(readFileSync("app/shell-frame.tsx", "utf8")).toContain("bg-rail-logo");
    expect(css).toMatch(/--color-rail-logo: #ffffff;/);
  });
});
