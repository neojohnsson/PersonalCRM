import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { DisconnectGmailButton } from "@/app/disconnect-gmail-button";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { countOf, dayMonth } from "@/lib/format";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { SeenOnceQueue, type SeenOncePerson } from "./queue";

export const metadata = { title: `Seen once · ${APP_NAME}` };

/**
 * The Seen once queue: people who wrote to you, or you wrote to, but never
 * both. Built from design/ReviewQueue.dc.html.
 *
 * Differences from the design, on purpose:
 *   - "412 automated senders" → "… automated messages": the sync counts what it
 *     skipped without storing who sent it (slice-2-plan.md, decision A).
 *   - Each row's second line shows the address's domain where the design shows
 *     a company name: slice 2 has no company for people who aren't contacts.
 *   - "Newest first" is a label, not a menu — it's the only order there is.
 *   - A "← Contacts" link on phones, where the sidebar is hidden.
 *   - A "Dismissed" link beside "Newest first", to the page where a dismissal
 *     can be undone (./dismissed). The design has no way back from Dismiss.
 */

const PAGE_SIZE = 50;
const MAX_ROWS = 1_000;

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

export default async function SeenOncePage({ searchParams }: PageProps<"/seen-once">) {
  const user = await requireUser();
  const supabase = await createClient();

  const { show } = await searchParams;
  const requested = typeof show === "string" ? Number.parseInt(show, 10) : NaN;
  const limit = requested > 0 ? Math.min(requested, MAX_ROWS) : PAGE_SIZE;

  const [gmailResult, peopleResult, syncResult] = await Promise.all([
    supabase.from("google_accounts").select("email").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("person_tiers")
      .select("email, name, sent_count, received_count, last_contact_at, last_subject", {
        count: "exact",
      })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null)
      .order("last_contact_at", { ascending: false })
      .limit(limit),
    supabase.from("gmail_sync_state").select("filtered_count").eq("user_id", user.id).maybeSingle(),
  ]);
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");
  if (peopleResult.error) throw supabaseError(peopleResult.error, "Couldn't load Seen once");
  if (syncResult.error) throw supabaseError(syncResult.error, "Couldn't load the sync status");

  const total = peopleResult.count ?? 0;
  const filtered = syncResult.data?.filtered_count ?? 0;

  const people: SeenOncePerson[] = (peopleResult.data ?? []).map((row) => ({
    email: row.email,
    name: row.name,
    fromThem: row.received_count,
    fromYou: row.sent_count,
    subject: row.last_subject,
    day: row.last_contact_at ? dayMonth(row.last_contact_at) : null,
  }));

  return (
    <AppShell
      userEmail={user.email}
      active="seen-once"
      seenOnceCount={total}
      headerRight={
        <>
          {gmailResult.data && (
            <>
              <span className="hidden text-[13px] text-ink-faint md:inline">
                {gmailResult.data.email}
              </span>
              <DisconnectGmailButton />
            </>
          )}
          <SignOutButton />
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-2">
            <Link href="/contacts" className="text-[12.5px] font-medium text-ink-soft sm:hidden">
              ← Contacts
            </Link>
            <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.035em]">Seen once</h1>
            <p className="max-w-[640px] text-[13.5px] leading-[1.5] text-ink-soft">
              {countOf(total, "person", "people")} wrote to you, or you wrote to them, but never
              both. They stay out of your contact list until you say otherwise — one exchange in
              each direction is what makes someone a contact.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/seen-once/dismissed"
              className="rounded-full bg-white px-[15px] py-2 text-[12.5px] font-medium text-ink-soft shadow-[0_1px_2px_rgba(20,20,25,.04)] transition-colors hover:text-ink"
            >
              Dismissed
            </Link>
            <div className="flex shrink-0 items-center gap-2 rounded-full bg-white px-[15px] py-2 shadow-[0_1px_2px_rgba(20,20,25,.04)]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[15px] text-ink-faint"
              >
                <path d="M5 6h14M8 12h8M10.5 18h3" />
              </svg>
              <span className="text-[12.5px] text-ink-faint">Newest first</span>
            </div>
          </div>
        </div>

        {total > 0 ? (
          <SeenOnceQueue
            people={people}
            total={total}
            filtered={filtered}
            moreHref={people.length < total && limit < MAX_ROWS ? `/seen-once?show=${limit + PAGE_SIZE}` : null}
          />
        ) : (
          <section className={`${CARD} flex max-w-xl flex-col px-[22px] py-6 sm:px-8`}>
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Nobody waiting</h2>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-soft">
              {gmailResult.data
                ? `Everyone you've exchanged mail with in the last ${lookbackDays()} days is a contact or has been dismissed.`
                : "Connect Gmail, and people who wrote to you once — or you wrote to once — show up here."}
            </p>
            {filtered > 0 && (
              <p className="mt-2 text-[12.5px] text-ink-faint">
                {countOf(filtered, "automated message")} were filtered out — newsletters, no-reply,
                calendar invites.
              </p>
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}
