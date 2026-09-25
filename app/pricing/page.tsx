import Link from "next/link";
import { BrandTile, Item } from "@/app/intro-screen";
import { APP_NAME } from "@/lib/app-config";
import { loadEntitlement } from "@/lib/plans/current";
import { PLANS, PLAN_NAMES, PRICE_SEK, includes, type Plan } from "@/lib/plans/plans";
import { createClient } from "@/lib/supabase/server";
import { choosePlanAction, managePlanAction } from "./actions";

export const metadata = { title: `Plans · ${APP_NAME}` };

/**
 * The three plans (docs/slice-13-plan.md §3).
 *
 * Public: a person deciding whether to sign in should be able to see what it
 * costs, and Stripe will not switch on live payments for a site without it.
 * Signed in, it shows which plan is yours.
 *
 * No design covers it. It is the Login screen's frame (design/Login.dc.html):
 * the paper page, the brand tile, a heading and white cards with its check
 * and cross lists, because it is the same kind of page, read before or
 * outside the app, not a working screen inside it.
 *
 * Everything a plan includes is built from lib/plans/plans.ts, so the page
 * cannot promise more than the limits give.
 *
 * "Choose" sends you to Stripe's Checkout (./actions.ts); the plan changes
 * only when Stripe's signed webhook says you paid. Coming back here with
 * ?paid=1 proves nothing, so the page says only that it updates in a moment.
 */
export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const { paid } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  const entitlement = userId ? await loadEntitlement(supabase, userId) : null;
  const mine = entitlement?.plan ?? null;

  return (
    <main className="flex flex-1 justify-center bg-paper px-4 py-12 text-ink sm:px-6 sm:py-14">
      <div className="flex w-full max-w-[1000px] flex-col gap-[26px]">
        <div className="flex flex-col gap-[18px]">
          <BrandTile />
          <div className="flex flex-col gap-2.5">
            <h1 className="text-xl font-bold tracking-[-0.035em] sm:text-2xl">Plans</h1>
            <p className="max-w-[560px] text-base text-ink-soft">
              Whose turn it is, warmth and next touch are free, always. The plans add the AI: summaries,
              drafts, the Assistant and web research. Prices a month, VAT included. Cancel whenever you like;
              nothing you made is deleted.
            </p>
          </div>
        </div>

        {paid === "1" && (
          <p role="status" className="rounded-xl bg-info-tint px-4 py-3 text-sm text-info-ink">
            Thank you. Stripe is confirming the payment, and your plan changes as soon as it does, usually within a
            minute. Reload this page to see it.
          </p>
        )}

        <div className="grid gap-[18px] md:grid-cols-3">
          {PLAN_NAMES.map((name) => (
            <PlanCard
              key={name}
              plan={PLANS[name]}
              mine={mine?.name === name}
              signedIn={userId !== null}
              onFree={mine?.name === "free"}
              paying={mine !== null && mine.name !== "free" && entitlement!.hasStripeCustomer}
            />
          ))}
        </div>

        <p className="px-1 text-sm text-ink-soft">
          {mine ? (
            <>
              You&rsquo;re on {mine.label}.{" "}
              <Link href="/profile" className="font-semibold text-ink-soft link-inline">
                See what you&rsquo;ve used this month
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="font-semibold text-ink-soft link-inline">
                Sign in
              </Link>{" "}
              to start on Free. Invite only for now: Google keeps the app in testing mode.
            </>
          )}
        </p>

        {/* Managed Payments (lib/stripe/checkout.ts): the person should know
            who they are buying from before the card page says so. */}
        <p className="px-1 text-sm text-ink-soft">
          Plans are sold through Link, Stripe&rsquo;s reseller: Link takes the payment, handles VAT and receipts, and
          your right to withdraw from the purchase under EU consumer law. Cancelling or changing plan is always on the
          Manage or cancel button in your profile.
        </p>

        <nav className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm text-ink-soft" aria-label="Legal pages">
          <Link href="/terms" className="link-inline">
            Terms
          </Link>
          <Link href="/privacy-policy" className="link-inline">
            Privacy policy
          </Link>
          <Link href="/sub-processors" className="link-inline">
            Sub-processors
          </Link>
        </nav>
      </div>
    </main>
  );
}

type ButtonProps = { plan: Plan; mine: boolean; signedIn: boolean; onFree: boolean; paying: boolean };

function PlanCard(props: ButtonProps) {
  const { plan, mine } = props;
  const price = PRICE_SEK[plan.name];
  return (
    <section
      aria-label={plan.label}
      className={`flex flex-col gap-[18px] rounded-xl bg-white px-6 py-[22px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] ${
        mine ? "ring-2 ring-info" : ""
      }`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold tracking-[-0.02em]">{plan.label}</h2>
          {mine && (
            <span className="rounded-full bg-info-tint px-2 py-0.5 text-2xs font-semibold text-info-ink">
              Your plan
            </span>
          )}
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tracking-[-0.035em]">{price} kr</span>
          <span className="text-sm text-ink-soft">a month</span>
        </p>
      </div>
      <ul className="flex flex-col gap-[9px]">
        {includes(plan).map((line) => (
          <Item key={line.text} icon={line.yes ? "check" : "cross"} tone={line.yes ? "info" : "muted"}>
            <span className={line.yes ? "" : "text-ink-soft"}>{line.text}</span>
          </Item>
        ))}
      </ul>
      <PlanButton {...props} />
    </section>
  );
}

const SOLID =
  "w-full rounded-full bg-ink-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/85";
const GHOST =
  "w-full rounded-full bg-line-soft px-4 py-2.5 text-sm font-semibold text-ink-body transition-colors hover:bg-chip-track";

/**
 * One button per card, or none: Free is where everybody starts, so it has
 * nothing to choose; a plan you pay for is changed or cancelled in Stripe's
 * portal, which also moves you between Pro and Premium. A paid plan set by
 * hand in the database, with no Stripe behind it, gets no buttons at all.
 */
function PlanButton({ plan, mine, signedIn, onFree, paying }: ButtonProps) {
  if (!signedIn || plan.name === "free") return null;
  if (paying) {
    return (
      <form action={managePlanAction} className="mt-auto">
        <button type="submit" className={GHOST}>
          {mine ? "Manage or cancel" : `Change to ${plan.label}`}
        </button>
      </form>
    );
  }
  if (mine || !onFree) return null;
  return (
    <form action={choosePlanAction.bind(null, plan.name)} className="mt-auto">
      <button type="submit" className={SOLID}>
        Choose {plan.label}
      </button>
    </form>
  );
}
