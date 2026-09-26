import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShellFrame } from "@/app/shell-frame";
import { rememberEmail } from "@/app/shell-memory";
import { RouteSkeleton } from "@/app/skeletons";
import { visiblePages } from "@/lib/nav";

/**
 * 2026-09-26, reported by the user: on a phone "You" vanished from the bottom
 * bar on every press, and came back when the page had loaded -- on a computer
 * the avatar and Sign out did the same. The loading skeleton drew the frame
 * without knowing who was signed in, and the frame left those out for nobody.
 *
 * There is no DOM in this suite, so these render to HTML as the server does.
 */

const profileLinks = (html: string) => html.match(/href="\/profile"/g)?.length ?? 0;

describe("the frame", () => {
  it("draws Profile and You even before it knows the address", () => {
    const html = renderToStaticMarkup(
      createElement(ShellFrame, { pages: visiblePages(true), active: "home", userEmail: undefined, children: null }),
    );
    // The rail's avatar tile and the bottom bar's You: both there, no letters.
    expect(profileLinks(html)).toBe(2);
    expect(html).toContain(">You<");
    expect(html).toContain("Profile</span>");
  });

  it("puts the letters on the avatar once it does", () => {
    const html = renderToStaticMarkup(
      createElement(ShellFrame, { pages: visiblePages(true), active: "home", userEmail: "alva.berg@example.com", children: null }),
    );
    expect(html).toContain(">AB<");
    expect(html).toContain("Profile · alva.berg@example.com");
  });
});

describe("the loading skeleton", () => {
  it("keeps the frame's own parts: Profile, You and Sign out", () => {
    const html = renderToStaticMarkup(createElement(RouteSkeleton));
    expect(profileLinks(html)).toBe(2);
    expect(html).toContain(">You<");
    expect(html).toContain("Sign out");
  });

  it("never shows a remembered address when drawn on the server", () => {
    // The memory is a module variable, and on the server one module serves
    // every person's request. Even if something wrote to it there, the
    // server's snapshot is "nobody", so no one sees another's letters.
    rememberEmail("alva.berg@example.com");
    const html = renderToStaticMarkup(createElement(RouteSkeleton));
    expect(html).not.toContain("alva.berg@example.com");
    expect(html).not.toContain(">AB<");
  });

  it("is told the address by every real page", () => {
    // AppShell is the frame of every signed-in page; it leaves the address.
    expect(readFileSync("app/app-shell.tsx", "utf8")).toContain("<RememberEmail email={userEmail} />");
  });
});
