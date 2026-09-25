import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { EmptyCard } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Not found · ${APP_NAME}` };

/**
 * The page for an address that isn't one (docs/slice-9b-plan.md, Part 6).
 *
 * Until now this was Next.js's own black-and-white "404 | This page could not
 * be found" — no navigation, no way back, and nothing saying which app you
 * were in. The first outside test found it by typing a contact id wrong.
 *
 * It keeps the app shell, so the rail and the bottom bar are both still
 * there: the point of a 404 is to get you somewhere real.
 *
 * `requireUser` is deliberately not used. It redirects to /login, and sending
 * a signed-out visitor from a mistyped address to a sign-in page tells them
 * they are logged out when the real answer is that the page does not exist.
 * A signed-out visitor gets the same words without the shell.
 */
export default async function NotFound() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;

  const card = (
    <EmptyCard title="That page doesn't exist">
      <p>
        The address may be mistyped, or whatever was here has been deleted. Nothing is wrong with
        your account.
      </p>
      <Link
        href={email ? "/" : "/login"}
        className="mt-5 self-center rounded-full bg-ink-deep px-4 py-[9px] text-sm font-semibold text-white transition hover:bg-ink/85"
      >
        {email ? "Back to Who needs you today" : "Sign in"}
      </Link>
    </EmptyCard>
  );

  if (!email) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-paper px-4 py-16">{card}</main>
    );
  }

  return (
    <AppShell userEmail={email} active="home" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <h1 className="text-2xl font-bold tracking-[-0.035em]">Not found</h1>
        {card}
      </main>
    </AppShell>
  );
}
