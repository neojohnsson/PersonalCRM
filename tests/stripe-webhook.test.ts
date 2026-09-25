import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type User } from "@supabase/supabase-js";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WITHDRAWAL_TEXT, checkoutParams } from "@/lib/stripe/checkout";
import { LiveKeyOutsideProduction, StripeNotConfigured, stripeSecretKey } from "@/lib/stripe/client";
import { planForLookupKey } from "@/lib/stripe/prices";
import { handleStripeWebhook, type WebhookDeps } from "@/lib/stripe/webhook";

/**
 * The payment webhook (slice 13, commit 5; docs/slice-13-plan.md §4): the one
 * place in the app that writes a plan. Stripe's real signature code with a
 * test secret, a fake "what is this subscription now", the real database.
 * Nothing here reaches Stripe.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const WEBHOOK_SECRET = "whsec_test_the_one_only_stripe_and_the_server_know";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = new Stripe("sk_test_never_used_to_call_stripe");

let alva: User;
let contactId: string;
/** What Stripe would say each subscription is right now. */
const now: Record<string, Stripe.Subscription> = {};

function subscription(
  id: string,
  over: { status?: Stripe.Subscription.Status; lookup?: string | null; userId?: string } = {},
): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status: over.status ?? "active",
    customer: "cus_test_alva",
    metadata: { user_id: over.userId ?? alva.id },
    items: {
      object: "list",
      data: [{ current_period_end: 1_793_000_000, price: { lookup_key: over.lookup === undefined ? "pro_monthly" : over.lookup } }],
    },
  } as unknown as Stripe.Subscription;
}

function event(type: string, object: unknown): string {
  return JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type, data: { object }, created: 1_790_000_000 });
}

const signed = (body: string, secret = WEBHOOK_SECRET) =>
  stripe.webhooks.generateTestHeaderString({ payload: body, secret });

const deps = (): WebhookDeps => ({
  stripe: {
    webhooks: stripe.webhooks,
    subscriptions: {
      retrieve: async (id: string) => {
        if (!now[id]) throw new Error(`no such subscription ${id}`);
        return now[id];
      },
    },
  },
  admin,
  secret: WEBHOOK_SECRET,
});

const send = (body: string, signature: string | null = signed(body)) => handleStripeWebhook(deps(), body, signature);

async function row() {
  const { data } = await admin
    .from("entitlements")
    .select("plan, stripe_customer_id, stripe_subscription_id, current_period_end, withdrawal_waived_at")
    .eq("user_id", alva.id)
    .maybeSingle();
  return data;
}

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `stripe-alva-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  alva = data.user;
  const { data: contact } = await admin
    .from("contacts")
    .insert({ user_id: alva.id, first_name: "Karin", source: "manual", notes: "Met at the fair." })
    .select("id")
    .single();
  contactId = contact!.id;
});

afterAll(async () => {
  if (alva) await admin.auth.admin.deleteUser(alva.id);
});

beforeEach(async () => {
  await admin.from("entitlements").delete().eq("user_id", alva.id);
  for (const id of Object.keys(now)) delete now[id];
});

describe("a call that is not from Stripe", () => {
  it("is refused unsigned, and changes nothing", async () => {
    now.sub_a = subscription("sub_a");
    const body = event("customer.subscription.created", now.sub_a);
    expect(await send(body, null)).toMatchObject({ status: 400 });
    expect(await row()).toBeNull();
  });

  it("is refused when signed with any other secret", async () => {
    now.sub_a = subscription("sub_a");
    const body = event("customer.subscription.created", now.sub_a);
    expect(await send(body, signed(body, "whsec_a_guess"))).toMatchObject({ status: 400 });
    expect(await row()).toBeNull();
  });

  it("is refused when the body was changed after signing", async () => {
    now.sub_a = subscription("sub_a");
    const body = event("customer.subscription.created", now.sub_a);
    const signature = signed(body);
    const altered = body.replace("pro_monthly", "premium_monthly");
    expect(await send(altered, signature)).toMatchObject({ status: 400 });
    expect(await row()).toBeNull();
  });
});

describe("a subscription", () => {
  it("that is paid sets the plan, with Stripe's ids and the paid-until date", async () => {
    now.sub_a = subscription("sub_a");
    expect(await send(event("customer.subscription.created", now.sub_a))).toMatchObject({ status: 200 });
    expect(await row()).toMatchObject({
      plan: "pro",
      stripe_customer_id: "cus_test_alva",
      stripe_subscription_id: "sub_a",
      current_period_end: new Date(1_793_000_000 * 1000).toISOString().replace(".000Z", "+00:00"),
    });
  });

  it("is harmless twice: the same event again leaves the same row", async () => {
    now.sub_a = subscription("sub_a");
    const body = event("customer.subscription.created", now.sub_a);
    await send(body);
    const first = await row();
    await send(body);
    expect(await row()).toEqual(first);
  });

  it("is read from Stripe as it is now, not as the event said", async () => {
    // The event still says active; Stripe says it has since been cancelled.
    const stale = subscription("sub_a");
    now.sub_a = subscription("sub_a", { status: "canceled" });
    await send(event("customer.subscription.updated", stale));
    expect((await row())?.plan).toBe("free");
  });

  it("moves between plans when the price changes", async () => {
    now.sub_a = subscription("sub_a", { lookup: "premium_monthly" });
    await send(event("customer.subscription.updated", now.sub_a));
    expect((await row())?.plan).toBe("premium");
  });

  it("keeps the plan while a failed renewal is being retried", async () => {
    now.sub_a = subscription("sub_a", { status: "past_due" });
    await send(event("customer.subscription.updated", now.sub_a));
    expect((await row())?.plan).toBe("pro");
  });

  it("that is cancelled returns to Free, and deletes nothing", async () => {
    now.sub_a = subscription("sub_a");
    await send(event("customer.subscription.created", now.sub_a));
    now.sub_a = subscription("sub_a", { status: "canceled" });
    await send(event("customer.subscription.deleted", now.sub_a));

    expect(await row()).toMatchObject({ plan: "free", stripe_subscription_id: null, current_period_end: null, stripe_customer_id: "cus_test_alva" });
    const { data: karin } = await admin.from("contacts").select("notes").eq("id", contactId).single();
    expect(karin).toEqual({ notes: "Met at the fair." });
  });

  it("that is old cannot undo a newer one", async () => {
    now.sub_new = subscription("sub_new");
    await send(event("customer.subscription.created", now.sub_new));
    // Last month's subscription's cancellation, arriving late.
    now.sub_old = subscription("sub_old", { status: "canceled" });
    expect(await send(event("customer.subscription.deleted", now.sub_old))).toMatchObject({
      status: 200,
      body: { outcome: "older_subscription" },
    });
    expect(await row()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_new" });
  });

  it("with a price that is not ours is refused, never guessed at", async () => {
    now.sub_a = subscription("sub_a", { lookup: "gold_forever" });
    expect(await send(event("customer.subscription.created", now.sub_a))).toMatchObject({ status: 422 });
    expect(await row()).toBeNull();
  });

  it("for somebody who does not exist is refused", async () => {
    now.sub_a = subscription("sub_a", { userId: randomUUID() });
    expect(await send(event("customer.subscription.created", now.sub_a))).toMatchObject({ status: 422 });
    now.sub_b = subscription("sub_b", { userId: "not-a-uuid" });
    expect(await send(event("customer.subscription.created", now.sub_b))).toMatchObject({ status: 422 });
  });
});

describe("a finished Checkout", () => {
  it("records when the right of withdrawal was waived, and sets the plan", async () => {
    now.sub_a = subscription("sub_a");
    const session = {
      id: "cs_test_1",
      object: "checkout.session",
      client_reference_id: alva.id,
      subscription: "sub_a",
      created: 1_790_000_000,
      consent: { terms_of_service: "accepted" },
    };
    await send(event("checkout.session.completed", session));
    expect(await row()).toMatchObject({
      plan: "pro",
      withdrawal_waived_at: new Date(1_790_000_000 * 1000).toISOString().replace(".000Z", "+00:00"),
    });
  });

  it("records no waiver the box was not ticked for", async () => {
    now.sub_a = subscription("sub_a");
    const session = { id: "cs_test_2", object: "checkout.session", client_reference_id: alva.id, subscription: "sub_a", created: 1, consent: null };
    await send(event("checkout.session.completed", session));
    expect((await row())?.withdrawal_waived_at).toBeNull();
  });

  it("ignores events that are not about a plan", async () => {
    expect(await send(event("customer.created", { id: "cus_x" }))).toMatchObject({ status: 200, body: { outcome: "ignored" } });
    expect(await row()).toBeNull();
  });
});

describe("the Checkout page", () => {
  const params = checkoutParams({
    userId: "11111111-1111-4111-8111-111111111111",
    email: "alva@example.com",
    customerId: null,
    priceId: "price_test_pro",
    appUrl: "https://contacthub.example",
  });

  it("cannot be paid without ticking the right-of-withdrawal box", () => {
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });
    expect(params.custom_text?.terms_of_service_acceptance).toEqual({
      message: WITHDRAWAL_TEXT.replace("{terms}", "https://contacthub.example/terms"),
    });
    expect(WITHDRAWAL_TEXT).toContain("I understand that I then lose my 14-day right of withdrawal");
  });

  it("names who it is for on the subscription, for every later event", () => {
    expect(params.subscription_data?.metadata).toEqual({ user_id: "11111111-1111-4111-8111-111111111111" });
    expect(params.client_reference_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("sends the browser back only to our own address", () => {
    expect(params.success_url).toBe("https://contacthub.example/pricing?paid=1");
    expect(params.cancel_url).toBe("https://contacthub.example/pricing");
  });

  it("reuses a Stripe customer, so one person is one customer", () => {
    const again = checkoutParams({ userId: "u", email: "a@b.c", customerId: "cus_1", priceId: "p", appUrl: "https://x" });
    expect(again.customer).toBe("cus_1");
    expect(again).not.toHaveProperty("customer_email");
  });
});

describe("the key", () => {
  it("is refused live anywhere but production", () => {
    expect(() => stripeSecretKey({ STRIPE_SECRET_KEY: "sk_live_abc" })).toThrow(LiveKeyOutsideProduction);
    expect(() => stripeSecretKey({ STRIPE_SECRET_KEY: "sk_live_abc", VERCEL_ENV: "preview" })).toThrow(LiveKeyOutsideProduction);
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: "sk_live_abc", VERCEL_ENV: "production" })).toBe("sk_live_abc");
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe("sk_test_abc");
  });

  it("must be there, and must be a secret key", () => {
    expect(() => stripeSecretKey({})).toThrow(StripeNotConfigured);
    expect(() => stripeSecretKey({ STRIPE_SECRET_KEY: "pk_test_publishable" })).toThrow(StripeNotConfigured);
  });
});

describe("the plan table", () => {
  it("knows exactly two prices", () => {
    expect(planForLookupKey("pro_monthly")).toBe("pro");
    expect(planForLookupKey("premium_monthly")).toBe("premium");
    expect(planForLookupKey("free")).toBeNull();
    expect(planForLookupKey(null)).toBeNull();
  });
});

describe("the secret key in the app", () => {
  it("is used in one file, and that file only by the webhook", () => {
    const admin = readFileSync("lib/supabase/admin.ts", "utf8");
    expect(admin).toContain('import "server-only";');
    const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
    expect(route).toContain("createAdminClient()");
    // The signature is over the raw bytes: parsing first would break it.
    expect(route).toContain("await request.text()");
    expect(route).not.toContain("request.json()");
  });
});
