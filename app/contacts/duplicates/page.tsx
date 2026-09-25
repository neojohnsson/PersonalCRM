import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { EmptyCard } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { loadDuplicates } from "@/lib/contacts/duplicate-list";
import { countOf } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { DuplicatePairCard } from "./pair-card";

export const metadata = { title: `Possible duplicates · ${APP_NAME}` };

/**
 * Contacts that are probably the same person (plan.md §3.7).
 *
 * No design has this screen — every design is slices 1–3 (design/canvas.json)
 * — so it is built from ContactList's white card and the summary card's two
 * columns, and says so here.
 *
 * The whole point is that nothing happens on its own: both records are shown,
 * with the reason they were paired, and a person presses the button.
 */
export default async function DuplicatesPage() {
  const user = await requireUser();
  const pairs = await loadDuplicates(await createClient(), user.id);

  return (
    <AppShell userEmail={user.email} active="contacts" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-[26px] sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href="/contacts" className="text-[12.5px] font-medium text-ink-soft hover:text-ink">
            ← Contacts
          </Link>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.035em]">Possible duplicates</h1>
          <p className="max-w-[640px] text-[13.5px] leading-[1.5] text-ink-soft">
            The same person often has two addresses: you write to one and they answer from
            another. Nothing is merged until you press a button, and a merge can&rsquo;t be undone.
          </p>
        </div>

        {pairs.length > 0 ? (
          <>
            <p className="text-[12.5px] font-medium text-ink-soft">
              {countOf(pairs.length, "pair")} to look at
            </p>
            <ul className="flex flex-col gap-4">
              {pairs.map((pair) => (
                <li key={`${pair.a}:${pair.b}`}>
                  <DuplicatePairCard pair={pair} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyCard title="No duplicates found">
            <p>
              Nobody in your contacts looks like the same person twice. The check runs on names,
              phone numbers and the names inside email addresses — never on a shared first name or
              a shared company.
            </p>
            <Link href="/contacts" className="mt-3 self-start font-semibold text-ink hover:text-ink-soft">
              Back to contacts
            </Link>
          </EmptyCard>
        )}
      </main>
    </AppShell>
  );
}
