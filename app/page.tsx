import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { avatarColors, countOf, daysAgo, initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { describeSync, type SyncLine, type SyncSummary } from "@/lib/sync/describe";
import { AppShell } from "./app-shell";
import { DisconnectGmailButton } from "./disconnect-gmail-button";
import { SignOutButton } from "./sign-out-button";
import { SyncButton } from "./sync-button";

/**
 * The home page: everyone you've exchanged mail with, most recent first —
 * never A–Z (AGENTS.md, core premise).
 *
 * Layout from the designs: heading and status line from design/Main.dc.html,
 * the table card from design/ContactList.dc.html.
 *
 * Differences from ContactList, on purpose — slice 1 doesn't have the data:
 *   - Company → Email. Company arrives with contact records in slice 2.
 *   - Whose turn, Warmth → Sent, Received. Those are slice 3 calculations;
 *     slice 1 only counts messages.
 *   - No Contacts / Seen once tabs, filter chips, search or Add contact:
 *     the two-tier import and manual contacts are slice 2.
 *   - Main's date on the right is left out: rendered on a server in UTC it
 *     can show the wrong day near midnight in Sweden.
 *
 * It will be noisy: newsletters and no-reply senders show up. Filtering them
 * is slice 2.
 */

const PAGE_SIZE = 50;
const MAX_ROWS = 1_000;

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const DARK_PILL =
  "flex items-center gap-[7px] rounded-full bg-ink-deep px-4 py-[9px] text-[12.5px] font-semibold text-white transition hover:bg-ink/85";

type Person = {
  email: string;
  name: string | null;
  message_count: number;
  sent_count: number;
  received_count: number;
  last_contact_at: string;
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const supabase = await createClient();

  // Signed-in client, so RLS applies. The user_id filters are there anyway:
  // queries that scope themselves stay correct if the client ever changes.
  const { data: gmail, error: gmailError } = await supabase
    .from("google_accounts")
    .select("email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (gmailError) throw gmailError;

  const signOut = <SignOutButton />;

  if (!gmail) {
    return (
      <AppShell userEmail={user.email} headerRight={signOut}>
        <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[26px] sm:px-[30px]">
          <Heading />
          <EmptyCard title="Connect Gmail to begin">
            <p>
              Once Gmail is connected, this page lists the people you actually
              talk to, most recent first.
            </p>
            <Link href="/connect" className={`${DARK_PILL} mt-5 self-start`}>
              Connect Gmail
            </Link>
          </EmptyCard>
        </main>
      </AppShell>
    );
  }

  const { show } = await searchParams;
  const requested = typeof show === "string" ? Number.parseInt(show, 10) : NaN;
  const limit = requested > 0 ? Math.min(requested, MAX_ROWS) : PAGE_SIZE;

  const [syncQuery, peopleQuery] = await Promise.all([
    supabase
      .from("gmail_sync_state")
      .select("status, message_count, last_synced_at, last_error")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("people")
      .select("email, name, message_count, sent_count, received_count, last_contact_at", {
        count: "exact",
      })
      .eq("user_id", user.id)
      .order("last_contact_at", { ascending: false })
      .limit(limit),
  ]);
  if (syncQuery.error) throw syncQuery.error;
  if (peopleQuery.error) throw peopleQuery.error;

  const sync = syncQuery.data as SyncSummary | null;
  const people = (peopleQuery.data ?? []) as Person[];
  const total = peopleQuery.count ?? people.length;

  return (
    <AppShell
      userEmail={user.email}
      headerRight={
        <>
          <span className="hidden text-[13px] text-ink-faint md:inline">{gmail.email}</span>
          <DisconnectGmailButton />
          {signOut}
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[26px] sm:px-[30px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Heading />
            <StatusLine line={describeSync(sync, total)} />
          </div>

          {sync?.status === "needs_reconnect" ? (
            <Link href="/connect" className={DARK_PILL}>
              Reconnect Gmail
            </Link>
          ) : (
            <SyncButton />
          )}
        </div>

        {people.length > 0 ? (
          <PeopleTable people={people} total={total} limit={limit} />
        ) : (
          <NobodyYet sync={sync} />
        )}
      </main>
    </AppShell>
  );
}

function Heading() {
  return (
    <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">People</h1>
  );
}

const DOT: Record<SyncLine["tone"], string> = {
  ok: "bg-affirm",
  busy: "bg-info animate-pulse",
  problem: "bg-accent",
  idle: "bg-ink-faint",
};

function StatusLine({ line }: { line: SyncLine }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[line.tone]}`} />
      <p role="status" className="text-[12.5px] font-medium text-ink-quiet">
        {line.text}
      </p>
    </div>
  );
}

function PeopleTable({ people, total, limit }: { people: Person[]; total: number; limit: number }) {
  const heading = "px-2 pt-[11px] pb-[9px] text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

  return (
    <div className={`${CARD} overflow-hidden`}>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="hidden w-[186px] md:table-column" />
          <col className="hidden w-[128px] md:table-column" />
          <col className="hidden w-[118px] md:table-column" />
          <col className="w-[74px]" />
        </colgroup>

        <thead>
          <tr>
            <th scope="col" className={`${heading} pl-[22px] text-left`}>Name</th>
            <th scope="col" className={`${heading} hidden text-left md:table-cell`}>Email</th>
            <th scope="col" className={`${heading} hidden text-left md:table-cell`}>Sent</th>
            <th scope="col" className={`${heading} hidden text-left md:table-cell`}>Received</th>
            <th scope="col" className={`${heading} pr-[22px] text-right`}>Last</th>
          </tr>
        </thead>

        <tbody>
          {people.map((person) => {
            const colors = avatarColors(person.email);

            return (
              <tr
                key={person.email}
                className="h-[38px] border-t border-line-soft transition-colors hover:bg-paper-tint"
              >
                <td className="py-0 pr-2 pl-[22px]">
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <span
                      aria-hidden="true"
                      style={colors}
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold"
                    >
                      {initials(person.name, person.email)}
                    </span>
                    <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">
                      {person.name ?? person.email}
                    </span>
                  </div>
                </td>
                <td className="hidden truncate px-2 text-[12.5px] text-ink-muted md:table-cell">
                  {person.email}
                </td>
                <td className="hidden px-2 text-[12.5px] font-semibold tabular-nums md:table-cell">
                  {person.sent_count}
                </td>
                <td className="hidden px-2 text-[12.5px] font-semibold tabular-nums md:table-cell">
                  {person.received_count}
                </td>
                <td className="pr-[22px] pl-2 text-right text-[12px] font-semibold text-ink-muted">
                  <time dateTime={person.last_contact_at}>{daysAgo(person.last_contact_at)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-line-soft px-[22px] py-2.5">
        <span className="text-[11.5px] font-medium text-ink-ghost">
          Showing {people.length.toLocaleString("en-GB")} of {countOf(total, "person", "people")}
        </span>
        {people.length < total && limit < MAX_ROWS && (
          <Link
            href={`/?show=${limit + PAGE_SIZE}`}
            scroll={false}
            className="text-[11.5px] font-semibold text-ink-muted hover:text-ink"
          >
            Load more
          </Link>
        )}
      </div>
    </div>
  );
}

function NobodyYet({ sync }: { sync: SyncSummary | null }) {
  const days = lookbackDays();

  if (sync?.status === "backfilling" || sync?.status === "incremental") {
    return (
      <EmptyCard title="Reading your mail…">
        <p>People appear here as each page of messages is saved.</p>
      </EmptyCard>
    );
  }

  if (sync?.status === "synced") {
    return (
      <EmptyCard title="No one found">
        <p>No conversations in the last {days} days.</p>
      </EmptyCard>
    );
  }

  if (sync?.status === "needs_reconnect" || sync?.status === "error") {
    return (
      <EmptyCard title="Nobody to show yet">
        <p>The sync stopped before it found anyone — see the line above for why.</p>
      </EmptyCard>
    );
  }

  return (
    <EmptyCard title="Nothing synced yet">
      <p>
        Press Sync now to read the last {days} days of email headers — who
        wrote, who received it, and when. Nothing else is read.
      </p>
    </EmptyCard>
  );
}

function EmptyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${CARD} flex max-w-xl flex-col px-[22px] py-6 sm:px-8`}>
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
      <div className="mt-2 flex flex-col text-[13.5px] leading-[1.55] text-ink-soft">{children}</div>
    </section>
  );
}
