import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailApiError, GmailRateLimited, listMessageIds } from "@/lib/google/gmail";

/**
 * Telling "slow down" apart from real failures. The 403 body below is the
 * one Gmail actually sent on the preview, 2026-09-15.
 */

const TOKEN = "ya29.fake-access-token";

function fakeGmail(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gmail rate limits", () => {
  it("recognises the per-user quota 403 as a rate limit", async () => {
    fakeGmail(403, {
      error: {
        code: 403,
        message:
          "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:650004665494'.",
        status: "PERMISSION_DENIED",
        errors: [{ reason: "rateLimitExceeded", domain: "usageLimits" }],
      },
    });

    const failure = listMessageIds(TOKEN, { lookbackDays: 90 });

    await expect(failure).rejects.toBeInstanceOf(GmailRateLimited);
    await expect(failure).rejects.toMatchObject({ status: 403 });
  });

  it("recognises userRateLimitExceeded by its reason alone", async () => {
    fakeGmail(403, { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } });

    await expect(listMessageIds(TOKEN, { lookbackDays: 90 })).rejects.toBeInstanceOf(
      GmailRateLimited,
    );
  });

  it("treats 429 Too Many Requests as a rate limit", async () => {
    fakeGmail(429, { error: { code: 429, message: "Too many requests" } });

    await expect(listMessageIds(TOKEN, { lookbackDays: 90 })).rejects.toBeInstanceOf(
      GmailRateLimited,
    );
  });

  it("doesn't mistake other 403s for a rate limit", async () => {
    fakeGmail(403, {
      error: { code: 403, message: "Metadata scope does not support 'q' parameter" },
    });

    const failure = listMessageIds(TOKEN, { lookbackDays: 90 });

    await expect(failure).rejects.toBeInstanceOf(GmailApiError);
    await expect(failure).rejects.not.toBeInstanceOf(GmailRateLimited);
  });
});
