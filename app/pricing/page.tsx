import Link from "next/link";
import { BrandTile, Item } from "@/app/intro-screen";
import { APP_NAME } from "@/lib/app-config";
import { loadEntitlement } from "@/lib/plans/current";
import { PLANS, PLAN_NAMES, PRICE_SEK, includes, type Plan } from "@/lib/plans/plans";
import { createClient } from "@/lib/supabase/server";

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
 * Differences for honest reasons:
 *   - There is no "Choose Pro" button yet. Paying arrives with Stripe in
 *     the next commit of this slice, and a button that did nothing would be
 *     a lie. Until then the cards only say what each plan is.
 *   - Everything a plan includes is built from lib/plans/plans.ts, so the
 *     page cannot promise more than the limits give.
 */
export default async function PricingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  const mine = userId ? (await loadEntitlement(supabase, userId)).plan : null;

  return (
    <main className="flex flex-1 justify-center bg-paper px-4 py-12 text-ink sm:px-6 sm:py-14">
      <div className="flex w-full max-w-[1000px] flex-col gap-[26px]">
        <div className="flex flex-col gap-[18px]">
          <BrandTile />
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.035em] sm:text-[33px]">Plans</h1>
            <p className="max-w-[560px] text-[15.5px] leading-[1.55] text-ink-soft">
              Whose turn it is, warmth and next touch are free, always. The plans add the AI: summaries,
              drafts, the Assistant and web research. Prices a month, VAT included. Cancel whenever you like;
              nothing you made is deleted.
            </p>
          </div>
        </div>

        <div className="grid gap-[18px] md:grid-cols-3">
          {PLAN_NAMES.map((name) => (
            <PlanCard key={name} plan={PLANS[name]} mine={mine?.name === name} />
          ))}
        </div>

        <p className="px-1 text-[13px] leading-[1.55] text-ink-quiet">
          {mine ? (
            <>
              You&rsquo;re on {mine.label}.{" "}
              <Link href="/profile" className="font-semibold text-ink-soft underline underline-offset-2">
                See what you&rsquo;ve used this month
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="font-semibold text-ink-soft underline underline-offset-2">
                Sign in
              </Link>{" "}
              to start on Free. Invite only for now: Google keeps the app in testing mode.
            </>
          )}
        </p>
      </div>
    </main>
  );
}

function PlanCard({ plan, mine }: { plan: Plan; mine: boolean }) {
  const price = PRICE_SEK[plan.name];
  return (
    <section
      aria-label={plan.label}
      className={`flex flex-col gap-[18px] rounded-[18px] bg-white px-6 py-[22px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] ${
        mine ? "ring-2 ring-info" : ""
      }`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">{plan.label}</h2>
          {mine && (
            <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10.5px] font-semibold text-info-ink">
              Your plan
            </span>
          )}
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-bold tracking-[-0.035em]">{price} kr</span>
          <span className="text-[13px] text-ink-soft">a month</span>
        </p>
      </div>
      <ul className="flex flex-col gap-[9px]">
        {includes(plan).map((line) => (
          <Item key={line.text} icon={line.yes ? "check" : "cross"} tone={line.yes ? "info" : "muted"}>
            <span className={line.yes ? "" : "text-ink-faint"}>{line.text}</span>
          </Item>
        ))}
      </ul>
    </section>
  );
}
