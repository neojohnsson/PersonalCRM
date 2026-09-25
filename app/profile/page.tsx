import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { DisconnectGmailButton } from "@/app/disconnect-gmail-button";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { loadEntitlement } from "@/lib/plans/current";
import { usesThisMonth } from "@/lib/plans/usage";
import { loadProfile } from "@/lib/profile/store";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { PlanCard } from "./plan-card";
import { ProfileForm } from "./profile-form";

export const metadata = { title: `Profile · ${APP_NAME}` };

/**
 * Profile: what drafts know about you (design/Profile.dc.html;
 * docs/slice-5a-plan.md, Part 2). The form and its differences from the design
 * are in profile-form.tsx.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { updated_at, ...profile } = await loadProfile(supabase, user.id);

  const [gmailResult, calendarResult, entitlement, uses] = await Promise.all([
    supabase.from("google_accounts").select("email").eq("user_id", user.id).maybeSingle(),
    supabase.from("google_calendar").select("email").eq("user_id", user.id).maybeSingle(),
    loadEntitlement(supabase, user.id),
    usesThisMonth(supabase, user.id),
  ]);
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");
  if (calendarResult.error) {
    throw supabaseError(calendarResult.error, "Couldn't check the calendar connection");
  }

  return (
    <AppShell userEmail={user.email} active="profile" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[18px] px-4 pb-[30px] sm:px-[30px]">
        <ProfileForm initial={profile} savedAt={updated_at} email={user.email ?? ""} />

        <PlanCard entitlement={entitlement} uses={uses} />

        {/* Slice 9b, Part 1: Disconnect Gmail used to sit in the header of
            Home, Contacts, Seen once and every contact page. On a phone it was
            the first thing a thumb reached, and pressing it throws away the
            connection and everything the sync needs. A rare, destructive
            action belongs with the account, beside the calendar it matches.

            No design covers this card. It reuses the "Your data" card below
            and the Connect screen's rows. */}
        <section className="flex max-w-[680px] flex-col gap-[13px] rounded-[18px] bg-white px-[22px] py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]">
          <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Connections</h2>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line-soft pt-[13px]">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Gmail</span>
              <span className="truncate text-[12.5px] text-ink-soft">
                {gmailResult.data ? gmailResult.data.email : "Not connected"}
              </span>
            </div>
            <div className="ml-auto">
              {gmailResult.data ? (
                <DisconnectGmailButton />
              ) : (
                <Link
                  href="/connect"
                  className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
                >
                  Connect Gmail
                </Link>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line-soft pt-[13px]">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Calendar</span>
              <span className="truncate text-[12.5px] text-ink-soft">
                {calendarResult.data ? calendarResult.data.email : "Not connected"}
              </span>
            </div>
            {/* Connecting, reading and disconnecting the calendar all live on
                the Calendar page, where you can see what the last read found
                (slice 8b). One place for it, not two. */}
            <Link
              href="/calendar"
              className="ml-auto rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
            >
              {calendarResult.data ? "Manage on Calendar" : "Connect on Calendar"}
            </Link>
          </div>
        </section>

        {/* Slice 7: "privacy controls — a real feature, not a footer link"
            (plan.md §3.12). It lives in the account area next to the rest of
            your settings, not in the sidebar with the daily screens. */}
        <Link
          href="/privacy"
          className="flex max-w-[680px] flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] bg-white px-[22px] py-[17px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] transition-colors hover:bg-paper-tint"
        >
          <span className="text-[14.5px] font-bold tracking-[-0.015em]">Your data</span>
          <span className="text-[12.5px] text-ink-soft">
            Everything stored, what leaves the app, export and delete
          </span>
          <span className="ml-auto text-[12px] font-semibold text-ink-faint">Open</span>
        </Link>
      </main>
    </AppShell>
  );
}
