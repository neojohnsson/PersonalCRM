import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { CARD, EmptyCard } from "@/app/page-parts";
import { PromiseCard } from "@/app/assistant/promises/promise-card";
import { SignOutButton } from "@/app/sign-out-button";
import { loadPendingPromises } from "@/lib/ai/promise-list";
import { APP_NAME } from "@/lib/app-config";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { countOf } from "@/lib/format";
import { getAccessToken } from "@/lib/google/tokens";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Promises · ${APP_NAME}` };

/**
 * The promises found in your mail, waiting to be accepted or rejected
 * (plan.md §3.4; docs/slice-6d-plan.md).
 *
 * Built from design/ReviewQueue.dc.html: the lead paragraph, the white toolbar
 * strip with its actions on the right, and one card of divided rows. The rows
 * themselves are PromiseCard, which lists what it changed and why.
 *
 * Moved here from /promises in slice 11 (docs/slice-11-plan.md §8): promises
 * are part of the Assistant now. You ask it to look; its card says what the
 * scan costs and runs it; what it finds waits here. "Things to decide" on
 * /assistant and the scan card both link to this page.
 *
 * Differences from the design, on purpose:
 *   - The toolbar has the count and a way back to the Assistant, where the
 *     design has a selection count and bulk actions. Nothing here is bulk
 *     work, and the scan that used to sit here is the Assistant's card now.
 *   - No "Newest first" control. The queue is ordered by the day each promise
 *     is about, soonest first, which is the only order that matters when the
 *     question is what to do this week.
 */
export default async function PromisesPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // The same gate as /assistant: without it, this address does not exist.
  if (!(await hasAssistant(supabase, user.id))) redirect("/");

  // No Gmail, or a token that won't refresh: the queue still shows, with
  // nothing to read each promise against. It says so on every row.
  const token = await getAccessToken(supabase, user.id).catch(() => null);

  const promises = await loadPendingPromises(supabase, user.id, token, displayName);

  return (
    <AppShell userEmail={user.email} active="assistant" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[18px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href="/assistant" className="text-sm font-normal text-ink-soft hover:text-ink">
            ← Assistant
          </Link>
          <h1 className="text-xl font-bold tracking-[-0.035em]">Promises</h1>
          <p className="max-w-[640px] text-sm text-ink-soft">
            Where somebody said they would do something &mdash; you or them. Each one is read out
            of your mail and waits here until you decide: accepting it sets a next touch, and
            nothing else happens on its own.
          </p>
        </div>

        <div
          className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl bg-white px-[22px] py-[11px] shadow-[0_1px_2px_rgba(20,20,25,.04)]`}
        >
          <span className="text-sm font-semibold">
            {promises.length > 0
              ? `${countOf(promises.length, "promise")} to decide`
              : "Nothing waiting"}
          </span>
          <Link href="/assistant" className="text-sm font-semibold text-ink-soft hover:text-ink">
            Ask the Assistant to look for more
          </Link>
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
              Ask the Assistant to look for promises in your mail. It shows you what reading would
              cost before it reads anything, and only reads the conversations that have moved since
              last time — contacts you have settled, planned a date for, or marked as just a contact
              are left alone.
            </p>
            <Link
              href="/assistant"
              className="mt-5 self-start rounded-full bg-line-soft px-[15px] py-2 text-xs font-semibold text-ink-body transition hover:bg-chip-track"
            >
              Back to the Assistant
            </Link>
          </EmptyCard>
        )}

        <p className="max-w-3xl px-1 text-xs font-normal text-ink-soft">
          The message under each one is read from Gmail as this page opens and is never stored.
          The line above it is written by the AI, so read the words before you accept it &mdash; a
          negation turns a promise into its opposite.
        </p>
      </main>
    </AppShell>
  );
}
