import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { listDismissals } from "@/lib/contacts/dismissals";
import { avatarColors, countOf, dayMonth, initials } from "@/lib/format";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { UndoButtons } from "./undo-button";

export const metadata = { title: `Dismissed · ${APP_NAME}` };

/**
 * Everyone you've dismissed — from Seen once, or from a contact page — with a
 * way to take it back.
 *
 * No design has this page. It reuses Seen once's (design/ReviewQueue.dc.html):
 * the same title block, and rows in one white card with the avatar, the
 * address, and Seen once's two buttons — ghost "Undo", solid "Undo and add as
 * contact". No checkboxes or bulk bar: undoing is rare and one at a time.
 *
 * All that's kept about a dismissed person is their address and when, so a
 * row has no name, subject or counts to show.
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

export default async function DismissedPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [dismissals, seenOnceResult] = await Promise.all([
    listDismissals(supabase, user.id),
    supabase
      .from("person_tiers")
      .select("email", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null),
  ]);
  if (seenOnceResult.error) throw supabaseError(seenOnceResult.error, "Couldn't count Seen once");

  return (
    <AppShell
      userEmail={user.email}
      active="seen-once"
      seenOnceCount={seenOnceResult.count ?? 0}
      headerRight={<SignOutButton />}
    >
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href="/seen-once" className="text-[12.5px] font-medium text-ink-soft hover:text-ink">
            ← Seen once
          </Link>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.035em]">Dismissed</h1>
          <p className="max-w-[640px] text-[13.5px] leading-[1.5] text-ink-soft">
            {countOf(dismissals.length, "address", "addresses")} whose mail is skipped. Undo, and the
            mail they sent in the last {lookbackDays()} days is read back in from Gmail — they
            show up in Seen once, or as a contact if you&rsquo;ve written to each other. Notes and
            tags from a dismissed contact don&rsquo;t come back.
          </p>
        </div>

        {dismissals.length > 0 ? (
          <div className={`${CARD} overflow-hidden`}>
            <ul>
              {dismissals.map((dismissal) => (
                <li
                  key={dismissal.email}
                  className="flex flex-wrap items-center gap-x-[14px] gap-y-2 border-t border-line-soft px-[22px] py-[13px] first:border-t-0"
                >
                  <span
                    aria-hidden="true"
                    style={avatarColors(dismissal.email)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  >
                    {initials(null, dismissal.email)}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">
                      {dismissal.email}
                    </span>
                    <span className="truncate text-[12px] text-ink-soft">
                      Dismissed {dayMonth(dismissal.dismissedAt)}
                    </span>
                  </div>

                  <UndoButtons email={dismissal.email} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <section className={`${CARD} flex max-w-xl flex-col px-[22px] py-6 sm:px-8`}>
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Nobody dismissed</h2>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-soft">
              People you dismiss from Seen once or from a contact page show up here.
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}
