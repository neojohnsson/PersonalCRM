import Link from "next/link";
import { managePlanAction } from "@/app/pricing/actions";
import type { Entitlement } from "@/lib/plans/current";
import { PRICE_SEK, type AiPurpose } from "@/lib/plans/plans";
import { allowanceLine, allowanceOf, type Uses } from "@/lib/plans/allowance";

/**
 * Your plan (docs/slice-13-plan.md §3): which one, and on Free what is left
 * of this month's allowance.
 *
 * No design covers this card. It is the Connections card below it on this
 * page: the same white card, heading and label/value rows.
 *
 * "Manage or cancel" opens Stripe's own customer portal (slice 13, commit 5),
 * only for somebody Stripe knows. A plan set by hand has nothing to manage.
 */

const COUNTED: AiPurpose[] = ["summary", "draft", "promises", "assistant"];

export function PlanCard({ entitlement, uses }: { entitlement: Entitlement; uses: Uses }) {
  const { plan, currentPeriodEnd } = entitlement;

  return (
    <section className="flex max-w-[680px] flex-col gap-[13px] rounded-[18px] bg-white px-[22px] py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Your plan</h2>
        <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10.5px] font-semibold text-info-ink">
          {plan.label}
        </span>
        <Link href="/pricing" className="ml-auto text-[12px] font-semibold text-ink-soft hover:text-ink">
          See plans
        </Link>
      </div>

      {plan.allowance ? (
        <ul className="flex flex-col">
          {COUNTED.map((purpose) => {
            const allowance = allowanceOf(plan, uses, purpose)!;
            return (
              <li
                key={purpose}
                className="flex items-center gap-3 border-t border-line-soft py-[9px] text-[13px] text-ink-body"
              >
                <span className="min-w-0 flex-1">{allowanceLine(allowance, purpose)}</span>
                <Meter share={allowance.allowed > 0 ? allowance.used / allowance.allowed : 1} />
              </li>
            );
          })}
          <li className="border-t border-line-soft pt-[9px] text-[12.5px] text-ink-soft">
            They come back on the 1st. Pro, {PRICE_SEK.pro} kr a month, has no monthly count.
          </li>
        </ul>
      ) : (
        <p className="border-t border-line-soft pt-[13px] text-[13px] leading-[1.5] text-ink-body">
          Summaries, drafts, scans and the Assistant have no monthly count
          {plan.research ? ", and web research is included" : ""}.
          {currentPeriodEnd && ` Paid until ${dateOf(currentPeriodEnd)}.`}
        </p>
      )}

      {entitlement.hasStripeCustomer && (
        <form action={managePlanAction} className="border-t border-line-soft pt-[13px]">
          <button
            type="submit"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
          >
            Manage or cancel
          </button>
        </form>
      )}
    </section>
  );
}

function Meter({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="relative block h-[5px] w-[90px] shrink-0 overflow-hidden rounded-full bg-chip">
      <span
        className="absolute inset-y-0 left-0 block rounded-full bg-accent"
        style={{ width: `${Math.min(1, share) * 100}%` }}
      />
    </span>
  );
}

function dateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" }).format(
    new Date(iso),
  );
}
