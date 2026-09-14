import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

/**
 * The home page. Signed-out visitors never get past requireUser().
 *
 * For now it only proves sign-in works. Part 4 of slice-1-plan.md replaces the
 * body with the people list, sorted by last contact.
 */
export default async function Home() {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col bg-paper">
      <header className="flex h-[60px] items-center justify-between border-b border-line bg-white px-6">
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          {APP_NAME}
        </span>
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-ink-faint">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-6 py-16">
        <div className="w-full max-w-xl rounded-2xl border border-line bg-white p-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Nobody to show yet
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-soft">
            Connect Gmail and this page will list the people you actually talk
            to, most recent first.
          </p>
          <Link
            href="/connect"
            className="mt-6 inline-block rounded-lg bg-ink px-5 py-3 text-[15px] font-medium text-white transition hover:bg-[#17181a]"
          >
            Connect Gmail
          </Link>
        </div>
      </main>
    </div>
  );
}
