import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { emptyContactValues } from "@/lib/contacts/contact-form";
import { ContactForm } from "../contact-form";

export const metadata = { title: `New contact · ${APP_NAME}` };

/** Manual add (plan.md §3.2): a contact that never came from an email at all. */
export default async function NewContactPage() {
  const user = await requireUser();

  return (
    <AppShell userEmail={user.email} headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href="/contacts" className="text-sm font-normal text-ink-soft hover:text-ink">
            ← Contacts
          </Link>
          <h1 className="text-xl font-bold tracking-[-0.035em]">New contact</h1>
          <p className="max-w-[640px] text-sm text-ink-soft">
            For someone you haven&rsquo;t emailed from this account — met at an event, a phone
            call, a referral. Everything here can be changed later.
          </p>
        </div>

        <ContactForm contactId={null} initial={emptyContactValues()} cancelHref="/contacts" />
      </main>
    </AppShell>
  );
}
