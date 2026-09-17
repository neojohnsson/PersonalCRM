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
      <main className="flex flex-1 flex-col px-4 pb-[30px] sm:px-[30px]">
        <ProfileForm initial={profile} savedAt={updated_at} email={user.email ?? ""} />
      </main>
    </AppShell>
  );
}
