import { describe, expect, it } from "vitest";
import { googleCallbackUrl } from "@/lib/google/redirect";

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
