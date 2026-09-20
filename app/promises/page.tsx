import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { CARD, EmptyCard } from "@/app/page-parts";
import { PromiseCard } from "@/app/promises/promise-card";
import { ScanButton } from "@/app/promises/scan-button";
import { SignOutButton } from "@/app/sign-out-button";
import { loadPendingPromises } from "@/lib/ai/promise-list";
import { SCAN_BATCH, planScan } from "@/lib/ai/promise-scan";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { countOf } from "@/lib/format";
import { getAccessToken } from "@/lib/google/tokens";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Promises · ${APP_NAME}` };

/**
 * A scan waits on the model for most of its time, so the request needs longer
 * than a page normally gets. SCAN_BATCH is sized to fit inside this.
 */
export const maxDuration = 60;

/**
 * The promises found in your mail, waiting to be accepted or rejected
 * (plan.md §3.4; docs/slice-6d-plan.md).
 *
 * Built from design/ReviewQueue.dc.html: the lead paragraph, the white toolbar
 * strip with its actions on the right, and one card of divided rows. The rows
 * themselves are PromiseCard, which lists what it changed and why.
 *
 * Differences from the design, on purpose:
 *   - The toolbar holds the scan button and what it would cost, where the
 *     design has a selection count and bulk actions. Nothing here is bulk
 *     work, and the button spends money, so it says how much first.
 *   - No "Newest first" control. The queue is ordered by the day each promise
 *     is about, soonest first, which is the only order that matters when the
 *     question is what to do this week.
 */
export default async function PromisesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // No Gmail, or a token that won't refresh: the queue still shows, with
  // nothing to read each promise against. It says so on every row.
  const token = await getAccessToken(supabase, user.id).catch(() => null);

  const [promises, plan, seenOnceResult] = await Promise.all([
    loadPendingPromises(supabase, user.id, token, displayName),
    planScan(supabase, user.id, { limit: SCAN_BATCH }),
    supabase
      .from("person_tiers")
      .select("email", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null),
  ]);

  return (
    <AppShell
      userEmail={user.email}
      active="promises"
      seenOnceCount={seenOnceResult.count ?? 0}
      headerRight={<SignOutButton />}
    >
      <main className="flex flex-1 flex-col gap-[18px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.035em]">Promises</h1>
          <p className="max-w-[640px] text-[13.5px] leading-[1.5] text-ink-soft">
            Where somebody said they would do something &mdash; you or them. Each one is read out
            of your mail and waits here until you decide: accepting it sets a next touch, and
            nothing else happens on its own.
          </p>
        </div>

        <div
          className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[14px] bg-white px-[22px] py-[11px] shadow-[0_1px_2px_rgba(20,20,25,.04)]`}
        >
          <span className="text-[12.5px] font-semibold">
            {promises.length > 0
              ? `${countOf(promises.length, "promise")} to decide`
              : "Nothing waiting"}
          </span>
          <ScanButton
            contacts={plan.contacts.length}
            estimateUsd={plan.estimateUsd}
            remaining={plan.remaining}
          />
        </div>

        {promises.length > 0 ? (
          <section className={`${CARD} max-w-3xl overflow-hidden`}>
            <ul>
              {promises.map((promise) => (
                <PromiseCard key={promise.id} promise={promise} />
              ))}
            </ul>
          </section>
        ) : (
          <EmptyCard title="Nothing to decide">
            <p>
              Press <strong>Look for promises</strong> to read the conversations that have moved
              since last time. Contacts you have settled, planned a date for, or marked as just a
              contact are left alone.
            </p>
            <Link
              href="/brief"
              className="mt-5 self-start rounded-full bg-line-soft px-[15px] py-2 text-[12px] font-semibold text-ink-body transition hover:bg-chip-track"
            >
              Back to your week
            </Link>
          </EmptyCard>
        )}

        <p className="max-w-3xl px-1 text-[11.5px] leading-[1.55] font-medium text-ink-faint">
          The message under each one is read from Gmail as this page opens and is never stored.
          The line above it is written by the AI, so read the words before you accept it &mdash; a
          negation turns a promise into its opposite.
        </p>
      </main>
    </AppShell>
  );
}
