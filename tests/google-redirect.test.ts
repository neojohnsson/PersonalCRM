import { describe, expect, it } from "vitest";
import { calendarReturnPage, googleCallbackUrl } from "@/lib/google/redirect";

describe("googleCallbackUrl", () => {
  it("uses localhost when running locally", () => {
    expect(googleCallbackUrl({ url: "http://localhost:3000/api/auth/google" })).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("uses the preview address on a Vercel preview", () => {
    expect(
      googleCallbackUrl({
        url: "https://personal-crm-git-slice-1-sync-newcus-projects.vercel.app/api/auth/google",
      }),
    ).toBe("https://personal-crm-git-slice-1-sync-newcus-projects.vercel.app/api/auth/google/callback");
  });

  it("gives the callback the same value the consent request sent, despite Google's query string", () => {
    const sent = googleCallbackUrl({ url: "https://personal-crm-delta-lemon.vercel.app/api/auth/google" });
    const received = googleCallbackUrl({
      url: "https://personal-crm-delta-lemon.vercel.app/api/auth/google/callback?state=abc&code=xyz&scope=gmail",
    });

    expect(received).toBe(sent);
    expect(received).toBe("https://personal-crm-delta-lemon.vercel.app/api/auth/google/callback");
  });
});

/**
 * Where the calendar's consent sends you back to (2026-09-23). The Calendar
 * page's own Connect button landed you on /connect; now you go back to the
 * page you started on -- and only ever to one of two.
 */
describe("calendarReturnPage", () => {
  it("goes back to the Calendar page or the Connect page, whichever you came from", () => {
    expect(calendarReturnPage("/calendar")).toBe("/calendar");
    expect(calendarReturnPage("/connect")).toBe("/connect");
  });

  it("never goes anywhere a form or a cookie names", () => {
    // Taken from the request, a return address is an open redirect: a crafted
    // form could send a signed-in person through Google's real consent screen
    // and on to a site of the attacker's choosing.
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/calendar/../admin",
      "/calendar?x=1",
      "/Calendar",
      " /calendar",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(calendarReturnPage(value), String(value)).toBe("/connect");
    }
  });
});
