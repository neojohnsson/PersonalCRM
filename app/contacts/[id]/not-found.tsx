import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { EmptyCard } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";

export const metadata = { title: `Contact not found · ${APP_NAME}` };

/**
 * The 404 for a contact (docs/slice-9b-plan.md, Part 6).
 *
 * Every `notFound()` in this folder lands here: a mistyped id, a contact that
 * was deleted in another tab, and — on purpose — somebody else's contact,
 * which must be indistinguishable from one that does not exist
 * (app/contacts/[id]/page.tsx says so where it decides).
 *
 * So the words have to cover all three without guessing which it was, and
 * without ever implying the contact exists but is not yours.
 *
 * requireUser is right here, unlike the app-wide 404: to be looking at
 * /contacts/<id> at all you are signed in, and if you are not, signing in is
 * the honest next step.
 */
export default async function ContactNotFound() {
  const user = await requireUser();

  return (
    <AppShell userEmail={user.email} active="contacts" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <Link
          href="/contacts"
          aria-label="Back to contacts"
          className="flex size-[34px] items-center justify-center rounded-[11px] bg-white text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.05)] transition-colors hover:text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[17px]"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </Link>

        <EmptyCard title="This contact doesn't exist">
          <p>
            It may have been deleted, or the address may be mistyped. If you deleted them, their
            record can be brought back from Seen once &rarr; Dismissed &mdash; though notes, tags
            and the next touch don&rsquo;t come back.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/contacts"
              className="rounded-full bg-ink-deep px-4 py-[9px] text-[12.5px] font-semibold text-white transition hover:bg-ink/85"
            >
              All contacts
            </Link>
            <Link
              href="/seen-once/dismissed"
              className="rounded-full bg-line-soft px-4 py-[9px] text-[12.5px] font-semibold text-ink-body transition-colors hover:bg-chip-track"
            >
              Dismissed contacts
            </Link>
          </div>
        </EmptyCard>
      </main>
    </AppShell>
  );
}
