import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { MAX_QUERY_LENGTH, ilikePattern, normaliseQuery } from "@/lib/contacts/search";
import { avatarColors, countOf, daysAgo, initials } from "@/lib/format";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { describeSync, type SyncLine, type SyncSummary } from "@/lib/sync/describe";
import { AppShell } from "./app-shell";
import { DisconnectGmailButton } from "./disconnect-gmail-button";
import { SignOutButton } from "./sign-out-button";
import { SyncButton } from "./sync-button";

/**
 * The home page: your contacts, most recent contact first — never A–Z
 * (AGENTS.md, core premise).
 *
 * Built from design/ContactList.dc.html: the Contacts / Seen once tabs, the
 * search box and "Add contact" on the top row, the table card. The status
 * line comes from design/Main.dc.html.
 *
 * Differences from ContactList, on purpose:
 *   - Whose turn and Warmth columns, the filter chips and the sort menu: slice 3.
 *     "Messages" stands in, since slice 2 can count them.
 *   - A white Sync now pill sits where the design's sort menu is — the
 *     temporary button (slice-1-plan.md, decision 5).
 *   - The design has no visible heading; the page has a hidden one, so screen
 *     readers still get a title.
 */

const PAGE_SIZE = 50;
const MAX_ROWS = 1_000;

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const DARK_PILL =
  "flex items-center gap-[7px] rounded-full bg-ink-deep px-4 py-[9px] text-[12.5px] font-semibold text-white transition hover:bg-ink/85";

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
  message_count: number;
  last_contact_at: string | null;
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
  if (gmailError) throw supabaseError(gmailError, "Couldn't check the Gmail connection");

  const signOut = <SignOutButton />;

  if (!gmail) {
    return (
      <AppShell userEmail={user.email} headerRight={signOut}>
        <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[26px] sm:px-[30px]">
          <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Contacts</h1>
          <EmptyCard title="Connect Gmail to begin">
            <p>
              Once Gmail is connected, everyone you&rsquo;ve written to and
              heard back from shows up here, most recent first.
            </p>
            <Link href="/connect" className={`${DARK_PILL} mt-5 self-start`}>
              Connect Gmail
            </Link>
          </EmptyCard>
        </main>
      </AppShell>
    );
  }

  const { show, q } = await searchParams;
  const query = normaliseQuery(q);
  const requested = typeof show === "string" ? Number.parseInt(show, 10) : NaN;
  const limit = requested > 0 ? Math.min(requested, MAX_ROWS) : PAGE_SIZE;

  let contactsQuery = supabase
    .from("contact_list")
    .select("id, first_name, last_name, company, primary_email, message_count, last_contact_at", {
      count: "exact",
    })
    .eq("user_id", user.id)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (query) contactsQuery = contactsQuery.ilike("search_text", ilikePattern(query));

  const [syncQuery, contactsResult, seenOnceResult, allContactsResult] = await Promise.all([
    supabase
      .from("gmail_sync_state")
      .select("status, message_count, last_synced_at, last_error")
      .eq("user_id", user.id)
      .maybeSingle(),
    contactsQuery,
    supabase
      .from("person_tiers")
      .select("email", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null),
    // While searching, the tab still shows how many contacts there are in all.
    query
      ? supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      : null,
  ]);
  if (syncQuery.error) throw supabaseError(syncQuery.error, "Couldn't load the sync status");
  if (contactsResult.error) throw supabaseError(contactsResult.error, "Couldn't load contacts");
  if (seenOnceResult.error) throw supabaseError(seenOnceResult.error, "Couldn't count Seen once");
  if (allContactsResult?.error) {
    throw supabaseError(allContactsResult.error, "Couldn't count contacts");
  }

  const sync = syncQuery.data as SyncSummary | null;
  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const matching = contactsResult.count ?? contacts.length;
  const totalContacts = allContactsResult?.count ?? matching;
  const seenOnce = seenOnceResult.count ?? 0;

  return (
    <AppShell
      userEmail={user.email}
      seenOnceCount={seenOnce}
      headerRight={
        <>
          <span className="hidden text-[13px] text-ink-faint md:inline">{gmail.email}</span>
          <DisconnectGmailButton />
          {signOut}
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-[26px] sm:px-[30px]">
        <h1 className="sr-only">Contacts</h1>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <ListTabs contacts={totalContacts} seenOnce={seenOnce} />

          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            <SearchBox query={query} />
            {sync?.status === "needs_reconnect" ? (
              <Link
                href="/connect"
                className="flex items-center rounded-full bg-white px-4 py-[9px] text-[12.5px] font-semibold text-ink shadow-[0_1px_2px_rgba(20,20,25,.04)] hover:bg-paper-tint"
              >
                Reconnect Gmail
              </Link>
            ) : (
              <SyncButton />
            )}
            <Link href="/contacts/new" className={DARK_PILL}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-3.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add contact
            </Link>
          </div>
        </div>

        <StatusLine line={describeSync(sync, totalContacts)} />

        {contacts.length > 0 ? (
          <ContactTable contacts={contacts} total={matching} limit={limit} query={query} />
        ) : query ? (
          <EmptyCard title={`No contacts match “${query}”`}>
            <p>Search looks at names, companies, roles, tags and every address.</p>
            <Link href="/" className="mt-3 self-start font-semibold text-ink hover:text-ink-soft">
              Clear the search
            </Link>
          </EmptyCard>
        ) : (
          <NoContactsYet sync={sync} seenOnce={seenOnce} />
        )}
      </main>
    </AppShell>
  );
}

/** ContactList's segmented tabs. The Seen once tab leads to the review queue. */
function ListTabs({ contacts, seenOnce }: { contacts: number; seenOnce: number }) {
  return (
    <nav aria-label="Lists" className="flex items-center gap-[3px] rounded-full bg-chip-track p-[3px]">
      <span
        aria-current="page"
        className="flex items-center gap-[7px] rounded-full bg-white px-[15px] py-[7px] shadow-[0_1px_2px_rgba(20,20,25,.06)]"
      >
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Contacts</span>
        <span className="text-[11.5px] font-semibold text-ink-faint tabular-nums">
          {contacts.toLocaleString("en-GB")}
        </span>
      </span>
      <Link
        href="/seen-once"
        className="flex items-center gap-[7px] rounded-full px-[15px] py-[7px] transition-colors hover:bg-white/60"
      >
        <span className="text-[13px] font-medium text-ink-soft">Seen once</span>
        <span className="text-[11.5px] font-semibold text-ink-hush tabular-nums">
          {seenOnce.toLocaleString("en-GB")}
        </span>
      </Link>
    </nav>
  );
}

/**
 * A plain GET form: pressing Enter loads /?q=…, so search works without any
 * JavaScript and the address can be bookmarked.
 */
function SearchBox({ query }: { query: string }) {
  return (
    <form
      role="search"
      action="/"
      className="flex w-full items-center gap-2 rounded-full bg-white px-[15px] py-2 shadow-[0_1px_2px_rgba(20,20,25,.04)] focus-within:ring-2 focus-within:ring-ink/10 sm:w-[206px]"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        className="size-[15px] shrink-0 text-ink-hush"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.4 15.4 4.1 4.1" />
      </svg>
      <label htmlFor="contact-search" className="sr-only">
        Search contacts
      </label>
      <input
        id="contact-search"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search name, company, tag"
        className="w-full min-w-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-hush"
      />
    </form>
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

function ContactTable({
  contacts,
  total,
  limit,
  query,
}: {
  contacts: ContactRow[];
  total: number;
  limit: number;
  query: string;
}) {
  const heading = "px-2 pt-[11px] pb-[9px] text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

  const more = new URLSearchParams({ show: String(limit + PAGE_SIZE) });
  if (query) more.set("q", query);

  return (
    <div className={`${CARD} overflow-hidden`}>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="hidden w-[186px] md:table-column" />
          <col className="hidden w-[128px] md:table-column" />
          <col className="w-[74px]" />
        </colgroup>

        <thead>
          <tr>
            <th scope="col" className={`${heading} pl-[22px] text-left`}>Name</th>
            <th scope="col" className={`${heading} hidden text-left md:table-cell`}>Company</th>
            <th scope="col" className={`${heading} hidden text-left md:table-cell`}>Messages</th>
            <th scope="col" className={`${heading} pr-[22px] text-right`}>Last</th>
          </tr>
        </thead>

        <tbody>
          {contacts.map((contact) => {
            const name = displayName(contact);
            const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
            const colors = avatarColors(contact.primary_email ?? contact.id);

            return (
              // The name's link stretches over the whole row (after:inset-0),
              // so anywhere on the row opens the contact.
              <tr
                key={contact.id}
                className="relative h-[38px] border-t border-line-soft transition-colors hover:bg-paper-tint"
              >
                <td className="py-0 pr-2 pl-[22px]">
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <span
                      aria-hidden="true"
                      style={colors}
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold"
                    >
                      {initials(
                        hasName ? name : null,
                        contact.primary_email ?? contact.first_name ?? "?",
                      )}
                    </span>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="truncate text-[13.5px] font-semibold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ink/20 focus-visible:after:ring-inset"
                    >
                      {name}
                    </Link>
                  </div>
                </td>
                <td className="hidden truncate px-2 text-[12.5px] text-ink-muted md:table-cell">
                  {contact.company ?? <span className="text-ink-hush">—</span>}
                </td>
                <td className="hidden px-2 text-[12.5px] font-semibold tabular-nums md:table-cell">
                  {contact.message_count}
                </td>
                <td className="pr-[22px] pl-2 text-right text-[12px] font-semibold text-ink-muted">
                  {contact.last_contact_at ? (
                    <time dateTime={contact.last_contact_at}>{daysAgo(contact.last_contact_at)}</time>
                  ) : (
                    <span className="text-ink-hush">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-line-soft px-[22px] py-2.5">
        <span className="text-[11.5px] font-medium text-ink-ghost">
          Showing {contacts.length.toLocaleString("en-GB")} of {countOf(total, "contact")}
        </span>
        {contacts.length < total && limit < MAX_ROWS && (
          <Link
            href={`/?${more}`}
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

function NoContactsYet({ sync, seenOnce }: { sync: SyncSummary | null; seenOnce: number }) {
  const days = lookbackDays();

  if (sync?.status === "backfilling" || sync?.status === "incremental") {
    return (
      <EmptyCard title="Reading your mail…">
        <p>
          Contacts appear when the sync finishes: everyone you&rsquo;ve written
          to and heard back from.
        </p>
      </EmptyCard>
    );
  }

  if (sync?.status === "synced") {
    return (
      <EmptyCard title="No contacts yet">
        <p>
          Nobody in the last {days} days both wrote to you and got a reply.
          {seenOnce > 0 && " People who only wrote once are waiting in Seen once."}
        </p>
        {seenOnce > 0 && (
          <Link href="/seen-once" className="mt-3 self-start font-semibold text-ink hover:text-ink-soft">
            Review {countOf(seenOnce, "person", "people")}
          </Link>
        )}
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
        Press Sync now to read the last {days} days of email headers. Everyone
        you&rsquo;ve written to and heard back from becomes a contact. Nothing
        else is read.
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
