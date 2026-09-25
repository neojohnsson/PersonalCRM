import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { revokeCalendarAccess } from "@/lib/google/calendar-tokens";
import { deleteEverything, stoppedMessage, type DeleteSteps } from "@/lib/privacy/delete-account";
import { endSubscription } from "@/lib/stripe/end-subscription";

/**
 * "Delete everything" ends everything it started (slice 13, commit 6b): the
 * Gmail and Calendar permissions at Google and a paid plan at Stripe, all
 * before a single row goes, and nothing deleted if any of them fails.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };

async function person(name: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `delete-${name}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

let alva: Person;
let bea: Person;

beforeAll(async () => {
  alva = await person("alva");
  bea = await person("bea");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the order", () => {
  function steps(results: { gmail?: string; calendar?: string; subscription?: string } = {}) {
    const calls: string[] = [];
    const record = (name: string, result: string) => async () => {
      calls.push(name);
      return result as never;
    };
    const fake: DeleteSteps = {
      revokeGmail: record("gmail", results.gmail ?? "revoked"),
      revokeCalendar: record("calendar", results.calendar ?? "revoked"),
      endSubscription: record("subscription", results.subscription ?? "cancelled"),
      deleteRows: async () => {
        calls.push("rows");
      },
    };
    return { fake, calls };
  }

  it("is Gmail, then Calendar, then the paid plan, and only then the rows", async () => {
    const { fake, calls } = steps();
    expect(await deleteEverything(fake)).toEqual({ deleted: true });
    expect(calls).toEqual(["gmail", "calendar", "subscription", "rows"]);
  });

  it("deletes nothing when any outside step fails, and stops there", async () => {
    for (const [failing, stoppedAt, before] of [
      [{ gmail: "failed" }, "gmail", ["gmail"]],
      [{ calendar: "failed" }, "calendar", ["gmail", "calendar"]],
      [{ subscription: "failed" }, "subscription", ["gmail", "calendar", "subscription"]],
    ] as const) {
      const { fake, calls } = steps(failing);
      expect(await deleteEverything(fake)).toMatchObject({ deleted: false, stoppedAt });
      expect(calls).toEqual(before);
    }
  });

  it("counts what is already gone as done, so pressing Delete again finishes the job", async () => {
    const { fake, calls } = steps({ gmail: "already_gone", calendar: "already_gone", subscription: "none" });
    expect(await deleteEverything(fake)).toEqual({ deleted: true });
    expect(calls).toContain("rows");
  });

  it("says what was already done when it stops", () => {
    const message = stoppedMessage({ deleted: false, stoppedAt: "subscription", done: ["gmail", "calendar"] });
    expect(message).toContain("Stripe didn't confirm that your paid plan was cancelled, so nothing has been deleted");
    expect(message).toContain("Already done: the Gmail and Calendar permission is withdrawn at Google.");
  });
});

describe("the Calendar's permission", () => {
  async function connect(who: Person, token: string) {
    await admin.from("google_calendar").delete().eq("user_id", who.user.id);
    const { error } = await admin
      .from("google_calendar")
      .insert({ user_id: who.user.id, email: "alva@example.com", refresh_token_encrypted: encrypt(token) });
    if (error) throw error;
  }

  const realFetch = globalThis.fetch;

  /** A fake Google for the revoke call only; the database client's own calls go through. */
  function google(answer: () => Promise<Response>) {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => answer());
    vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith("https://oauth2.googleapis.com/") ? fetch(String(url), init) : realFetch(url, init),
    );
    return fetch;
  }

  it("is revoked at Google with the real token, decrypted", async () => {
    await connect(alva, "1//calendar-refresh-token");
    const fetch = google(async () => new Response("{}", { status: 200 }));
    expect(await revokeCalendarAccess(alva.db, alva.user.id)).toBe("revoked");
    expect(fetch.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(fetch.mock.calls[0][1]?.body)).toBe("token=1%2F%2Fcalendar-refresh-token");
  });

  it("is already gone with no calendar connected, and Google is not asked", async () => {
    const fetch = google(async () => new Response("{}", { status: 200 }));
    expect(await revokeCalendarAccess(bea.db, bea.user.id)).toBe("already_gone");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is already gone when Google has never heard of the token", async () => {
    await connect(alva, "1//old");
    google(async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 }));
    expect(await revokeCalendarAccess(alva.db, alva.user.id)).toBe("already_gone");
  });

  it("fails when Google refuses or cannot be reached: not knowing is a failure", async () => {
    await connect(alva, "1//t");
    google(async () => new Response("{}", { status: 503 }));
    expect(await revokeCalendarAccess(alva.db, alva.user.id)).toBe("failed");
    google(async () => {
      throw new Error("offline");
    });
    expect(await revokeCalendarAccess(alva.db, alva.user.id)).toBe("failed");
  });

  it("is never somebody else's", async () => {
    await connect(alva, "1//alvas");
    const fetch = google(async () => new Response("{}", { status: 200 }));
    // Bea's session sees no calendar row of Alva's, so nothing of hers is revoked.
    expect(await revokeCalendarAccess(bea.db, alva.user.id)).toBe("already_gone");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a paid plan", () => {
  async function paying(who: Person, subscription: string | null) {
    const { error } = await admin
      .from("entitlements")
      .upsert({ user_id: who.user.id, plan: subscription ? "pro" : "free", stripe_subscription_id: subscription });
    if (error) throw error;
  }

  function stripe(status: Stripe.Subscription.Status | "missing", cancel: () => Promise<unknown> = async () => ({})) {
    const cancelled: string[] = [];
    return {
      cancelled,
      api: () => ({
        retrieve: async (id: string) => {
          if (status === "missing") throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
          return { id, status } as Stripe.Subscription;
        },
        cancel: async (id: string) => {
          cancelled.push(id);
          await cancel();
          return { id, status: "canceled" } as Stripe.Subscription;
        },
      }),
    };
  }

  it("is ended at Stripe, at once", async () => {
    await paying(alva, "sub_alva");
    const fake = stripe("active");
    expect(await endSubscription(alva.db, alva.user.id, fake.api)).toBe("cancelled");
    expect(fake.cancelled).toEqual(["sub_alva"]);
  });

  it("is nothing to end on Free, when already over, or unknown to Stripe", async () => {
    await paying(alva, null);
    expect(await endSubscription(alva.db, alva.user.id, stripe("active").api)).toBe("none");
    await paying(alva, "sub_old");
    const over = stripe("canceled");
    expect(await endSubscription(alva.db, alva.user.id, over.api)).toBe("none");
    expect(over.cancelled).toEqual([]);
    expect(await endSubscription(alva.db, alva.user.id, stripe("missing").api)).toBe("none");
  });

  it("fails when Stripe cannot confirm, or this server has no Stripe key", async () => {
    await paying(alva, "sub_alva");
    const refusing = stripe("active", async () => {
      throw new Error("Stripe is down");
    });
    expect(await endSubscription(alva.db, alva.user.id, refusing.api)).toBe("failed");
    const noKey = () => {
      throw new Error("STRIPE_SECRET_KEY is missing");
    };
    expect(await endSubscription(alva.db, alva.user.id, noKey)).toBe("failed");
  });

  it("is never somebody else's", async () => {
    await paying(alva, "sub_alva");
    const fake = stripe("active");
    // Bea's session cannot read Alva's plan, so Alva's subscription is not hers to end.
    expect(await endSubscription(bea.db, alva.user.id, fake.api)).toBe("none");
    expect(fake.cancelled).toEqual([]);
  });
});
