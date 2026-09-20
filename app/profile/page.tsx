import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { loadProfile } from "@/lib/profile/store";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export const metadata = { title: `Profile · ${APP_NAME}` };

/**
 * Profile: what drafts know about you (design/Profile.dc.html;
 * docs/slice-5a-plan.md, Part 2). The form and its differences from the design
 * are in profile-form.tsx.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const { updated_at, ...profile } = await loadProfile(await createClient(), user.id);

  return (
    <AppShell userEmail={user.email} active="profile" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[18px] px-4 pb-[30px] sm:px-[30px]">
        <ProfileForm initial={profile} savedAt={updated_at} email={user.email ?? ""} />

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
