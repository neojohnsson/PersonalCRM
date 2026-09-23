import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { EmptyCard, StatusLine } from "@/app/page-parts";
import { SearchBox } from "@/app/contacts/search-box";
import { SignOutButton } from "@/app/sign-out-button";
import { SyncButton } from "@/app/sync-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { compareOn, parseSort, sortLabel, type SortKey } from "@/lib/contacts/sort";
import { ilikePattern, normaliseQuery } from "@/lib/contacts/search";
import { avatarColors, countOf, daysAgo, initials } from "@/lib/format";
import { countDuplicates } from "@/lib/contacts/duplicate-list";
import {
  FILTERS,
  bucketOf,
  countByFilter,
  hasTag,
  matchesFilter,
  parseFilter,
  standingRank,
  topTags,
  type ListFilter,
} from "@/lib/relationship/list";
import { NO_MAIL, loadRelationships, type Relationship } from "@/lib/relationship/load";
import { standingOf, type Standing } from "@/lib/relationship/standing";
import { todayIn } from "@/lib/relationship/dates";
import type { Band } from "@/lib/relationship/warmth";
import { compareTurns } from "@/lib/relationship/whose-turn";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { lookbackDays } from "@/lib/sync/config";
import { describeSync, type SyncSummary } from "@/lib/sync/describe";

export const metadata = { title: `Contacts · ${APP_NAME}` };

/**
 * The contact list, built from design/ContactList.dc.html: Contacts / Seen once
 * tabs, search, the sort label and Add contact on the top row; the filter chips;
 * the table with Whose turn and Warmth.
 *
 * Sorted by whose turn — "that default is the product" (design/canvas.json).
 * Whose turn isn't a database column, so every contact is loaded, worked out
 * with the tested functions in lib/relationship, then filtered, sorted and cut
 * to the page here. Search still happens in the database.
 *
 * Differences from the design, on purpose:
 *   - A white Sync now pill beside Add contact — the temporary button
 *     (slice-1-plan.md, decision 5) — and the status line above the table.
 *   - "Sorted by Whose turn" is a label, not a menu: it's the only order.
 *   - A line above the table when contacts look like the same person twice
 *     (slice 6a), leading to /contacts/duplicates.
 *   - The design has no visible heading; the page has a hidden one.
 */

const PAGE_SIZE = 50;
const MAX_ROWS = 1_000;

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const DARK_PILL =
  "flex items-center gap-[7px] rounded-full bg-ink-deep px-4 py-[9px] text-[12.5px] font-semibold text-white transition hover:bg-ink/85";

const WHITE_PILL =
  "flex items-center gap-[7px] rounded-full bg-white px-[14px] py-2 text-[12.5px] shadow-[0_1px_2px_rgba(20,20,25,.04)]";

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
  tags: string[];
  last_contact_at: string | null;
};

type Item = { contact: ContactRow; relationship: Relationship; standing: Standing };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: gmail, error: gmailError } = await supabase
    .from("google_accounts")
    .select("email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (gmailError) throw supabaseError(gmailError, "Couldn't check the Gmail connection");

  if (!gmail) {
    return (
      <AppShell userEmail={user.email} headerRight={<SignOutButton />}>
        <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[26px] sm:px-[30px]">
          <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Contacts</h1>
          <EmptyCard title="Connect Gmail to begin">
            <p>
              Once Gmail is connected, everyone you&rsquo;ve written to and heard back from shows
              up here — whoever is waiting on you first.
            </p>
            <Link href="/connect" className={`${DARK_PILL} mt-5 self-start`}>
              Connect Gmail
            </Link>
          </EmptyCard>
        </main>
      </AppShell>
    );
  }

  const params = await searchParams;
  const query = normaliseQuery(params.q);
  const filter = parseFilter(params.filter);
  const tag = typeof params.tag === "string" && params.tag.trim() ? params.tag.trim() : null;
  const sort = parseSort(params.sort);
  const requested = typeof params.show === "string" ? Number.parseInt(params.show, 10) : NaN;
  const limit = requested > 0 ? Math.min(requested, MAX_ROWS) : PAGE_SIZE;

  const [contacts, relationships, syncResult, seenOnceResult, totalResult, duplicates, touchesResult] =
    await Promise.all([
    readAll<ContactRow>((from, to) => {
      let page = supabase
        .from("contact_list")
        .select("id, first_name, last_name, company, primary_email, tags, last_contact_at")
        .eq("user_id", user.id);
      if (query) page = page.ilike("search_text", ilikePattern(query));
      return page.order("id").range(from, to);
    }, "Couldn't load contacts"),
    loadRelationships(supabase, user.id),
    supabase
      .from("gmail_sync_state")
      .select("status, message_count, last_synced_at, last_error")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("person_tiers")
      .select("email", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    countDuplicates(supabase, user.id),
    // Slice 9a: a day already planned is part of what the chips mean, so the
    // list has to know about it like every other screen does.
    supabase
      .from("next_touches")
      .select("contact_id, due_on")
      .eq("user_id", user.id)
      .eq("status", "open")
      .limit(1000)
      .returns<{ contact_id: string; due_on: string }[]>(),
  ]);
  if (syncResult.error) throw supabaseError(syncResult.error, "Couldn't load the sync status");
  if (seenOnceResult.error) throw supabaseError(seenOnceResult.error, "Couldn't count Seen once");
  if (totalResult.error) throw supabaseError(totalResult.error, "Couldn't count contacts");
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");

  const sync = syncResult.data as SyncSummary | null;
  const seenOnce = seenOnceResult.count ?? 0;
  const totalContacts = totalResult.count ?? contacts.length;

  // The soonest open touch per contact: what makes a contact "planned".
  const plannedOn = new Map<string, string>();
  for (const row of touchesResult.data) {
    const current = plannedOn.get(row.contact_id);
    if (!current || row.due_on < current) plannedOn.set(row.contact_id, row.due_on);
  }

  const today = todayIn("Europe/Stockholm");

  const items: Item[] = contacts.map((contact) => {
    const relationship = relationships.get(contact.id) ?? NO_MAIL;
    return {
      contact,
      relationship,
      // The same question every other screen asks, asked the same way.
      standing: standingOf(
        {
          turn: relationship.turn,
          settledAt: relationship.settledAt,
          plannedOn: plannedOn.get(contact.id) ?? null,
          neverChase: relationship.neverChase,
        },
        today,
      ),
    };
  });

  // Chip counts cover the current search, before a chip is chosen.
  const counts = countByFilter(items.map((item) => item.standing));
  const tags = topTags(items.map((item) => item.contact.tags));

  // Whose turn is the default, because that default is the product
  // (design/canvas.json). A column sort breaks ties with it rather than
  // replacing it, so two contacts at the same warmth still come out in the
  // order the app would have chosen.
  const byTurn = (a: (typeof items)[number], b: (typeof items)[number]) =>
    standingRank(a.standing) - standingRank(b.standing) ||
    compareTurns(a.relationship.turn, b.relationship.turn) ||
    displayName(a.contact).localeCompare(displayName(b.contact), "sv");

  const sortRow = (item: (typeof items)[number]) => ({
    name: displayName(item.contact),
    company: item.contact.company,
    warmth: item.relationship.warmth?.score ?? null,
    lastAt: item.contact.last_contact_at,
  });

  const shown = items
    .filter((item) => matchesFilter(item.standing, filter))
    .filter((item) => (tag ? hasTag(item.contact.tags, tag) : true))
    .sort(sort === "turn" ? byTurn : (a, b) => compareOn(sort, sortRow(a), sortRow(b)) || byTurn(a, b));

  /** This page's address with some parameters changed; null removes one. */
  const link = (changes: Record<string, string | null>) => {
    const current: Record<string, string | null> = {
      q: query || null,
      filter: filter === "all" ? null : filter,
      tag,
      sort: sort === "turn" ? null : sort,
      ...changes,
    };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(current)) if (value) next.set(key, value);
    const search = next.toString();
    return search ? `/contacts?${search}` : "/contacts";
  };

  return (
    <AppShell
      userEmail={user.email}
      active="contacts"
      seenOnceCount={seenOnce}
      headerRight={
        <>
          <span className="hidden text-[13px] text-ink-faint lg:inline">{gmail.email}</span>
          <SignOutButton />
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-[26px] sm:px-[30px]">
        <h1 className="sr-only">Contacts</h1>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-[24px] leading-[1.1] font-bold tracking-[-0.03em]">Contacts</h1>
            <ListTabs contacts={totalContacts} seenOnce={seenOnce} />
          </div>

          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            <SearchBox query={query} />
            {/* Slice 9b, Part 6: a label, and now it looks like one. As a
                white pill beside Sync now it read as a dropdown, and the
                outside test pressed it. The order is chosen in the column
                headings below. */}
            <span className="hidden items-center gap-1.5 self-center px-1 text-[12.5px] whitespace-nowrap lg:flex">
              <span className="text-ink-faint">Sorted by</span>
              <span className="font-semibold text-ink-soft">{sortLabel(sort)}</span>
            </span>
            {sync?.status === "needs_reconnect" ? (
              <Link href="/connect" className={`${WHITE_PILL} font-semibold hover:bg-paper-tint`}>
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

        <nav aria-label="Filter contacts" className="flex flex-wrap items-center gap-[7px]">
          {FILTERS.map(({ value, label }) => (
            <Chip
              key={value}
              href={link({ filter: value === "all" ? null : value, tag: null })}
              active={filter === value && !tag}
              label={label}
              count={counts[value]}
            />
          ))}
          {tags.length > 0 && <span aria-hidden="true" className="mx-[3px] h-[18px] w-px bg-line" />}
          {tags.map(({ tag: name, count }) => (
            <Chip
              key={name}
              href={link({ filter: null, tag: name })}
              active={tag !== null && tag.toLowerCase() === name.toLowerCase()}
              label={name}
              count={count}
            />
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <StatusLine line={describeSync(sync, totalContacts)} />
          {duplicates > 0 && (
            <Link
              href="/contacts/duplicates"
              className="text-[12.5px] font-medium text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {countOf(duplicates, "possible duplicate")} — look at{" "}
              {duplicates === 1 ? "it" : "them"}
            </Link>
          )}
        </div>

        {shown.length > 0 ? (
          <ContactTable
            items={shown.slice(0, limit)}
            total={shown.length}
            sort={sort}
            sortHref={(next) => link({ sort: next, show: null })}
            moreHref={
              shown.length > limit && limit < MAX_ROWS ? link({ show: String(limit + PAGE_SIZE) }) : null
            }
          />
        ) : query || filter !== "all" || tag ? (
          <EmptyCard title="No contacts here">
            <p>
              {query ? `Nobody matches “${query}”` : "Nobody"}
              {filter !== "all" ? ` under ${FILTERS.find((f) => f.value === filter)!.label}` : ""}
              {tag ? ` tagged ${tag}` : ""}.
            </p>
            <Link href="/contacts" className="mt-3 self-start font-semibold text-ink hover:text-ink-soft">
              Show all contacts
            </Link>
          </EmptyCard>
        ) : (
          <NoContactsYet sync={sync} seenOnce={seenOnce} />
        )}
      </main>
    </AppShell>
  );
}

/** ContactList's segmented tabs. */
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

function Chip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full px-[13px] py-1.5 text-[12px] tabular-nums transition-colors ${
        active
          ? "bg-ink-deep font-semibold text-white"
          : "bg-white font-medium text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.04)] hover:bg-paper-tint"
      }`}
    >
      {label} {count.toLocaleString("en-GB")}
    </Link>
  );
}

const WARMTH_TEXT: Record<Band, string> = {
  warm: "text-affirm",
  cooling: "text-cooling",
  cold: "text-ink-quiet",
};

const WARMTH_BAR: Record<Band, string> = {
  warm: "bg-affirm",
  cooling: "bg-cooling",
  cold: "bg-ink-ghost",
};

function ContactTable({
  items,
  total,
  sort,
  sortHref,
  moreHref,
}: {
  items: Item[];
  total: number;
  sort: SortKey;
  /** This page's address ordered by another column; null means the default. */
  sortHref: (next: SortKey | null) => string;
  moreHref: string | null;
}) {
  const heading = "px-2 pt-[11px] pb-[9px] text-[10.5px] font-bold tracking-[0.07em] text-ink-ghost uppercase";

  return (
    <div className={`${CARD} overflow-hidden`}>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          {/* The design's 186px is the text; the cell's 8px padding each side comes on
              top. From 1280px the column grows to 240px of text, because real company
              names ("Länsstyrelsen i Kronobergs län") run longer than the mock ones and
              the Name column has room to spare there. */}
          <col className="hidden w-[202px] lg:table-column xl:w-[256px]" />
          <col className="w-[118px] sm:w-[128px]" />
          <col className="hidden w-[118px] md:table-column" />
          <col className="w-[64px]" />
        </colgroup>

        {/* Slice 9b, Part 6: the headings sort now. They looked like every
            sortable table anybody has used and did nothing at all. One click
            per heading, one direction per column -- the direction that is
            useful (lib/contacts/sort.ts). */}
        <thead>
          <tr>
            <SortHeading sort={sort} column="name" href={sortHref("name")} className={`${heading} pl-[22px]`}>
              Name
            </SortHeading>
            <SortHeading
              sort={sort}
              column="company"
              href={sortHref("company")}
              className={`${heading} hidden lg:table-cell`}
            >
              Company
            </SortHeading>
            <SortHeading sort={sort} column="turn" href={sortHref(null)} className={heading}>
              Whose turn
            </SortHeading>
            <SortHeading
              sort={sort}
              column="warmth"
              href={sortHref("warmth")}
              className={`${heading} hidden md:table-cell`}
            >
              Warmth
            </SortHeading>
            <SortHeading
              sort={sort}
              column="last"
              href={sortHref("last")}
              className={`${heading} pr-[22px]`}
              align="right"
            >
              Last
            </SortHeading>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => {
            const { contact, relationship } = item;
            const name = displayName(contact);
            const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
            const { turn, warmth } = relationship;

            return (
              // The name's link stretches over the whole row (after:inset-0).
              <tr key={contact.id} className="relative h-[38px] border-t border-line-soft transition-colors hover:bg-paper-tint">
                <td className="py-0 pr-2 pl-[22px]">
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <span
                      aria-hidden="true"
                      style={avatarColors(contact.primary_email ?? contact.id)}
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold"
                    >
                      {initials(hasName ? name : null, contact.primary_email ?? contact.first_name ?? "?")}
                    </span>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="truncate text-[13.5px] font-semibold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ink/20 focus-visible:after:ring-inset"
                    >
                      {name}
                    </Link>
                  </div>
                </td>
                {/* One line, ending in "…" if it still doesn't fit; the full name on hover. */}
                <td
                  title={contact.company ?? undefined}
                  className="hidden truncate px-2 text-[12.5px] text-ink-muted lg:table-cell"
                >
                  {contact.company ?? <span className="text-ink-hush">—</span>}
                </td>
                {/* Slice 9a: the label is the bucket that counted the row, so a
                    row can never say YOUR TURN while its page says Nothing
                    owed — which is exactly what it did. */}
                <td className="px-2 whitespace-nowrap">
                  <BucketLabel bucket={bucketOf(item.standing)} />
                </td>
                <td className="hidden px-2 md:table-cell">
                  {warmth ? (
                    <div className="flex items-center gap-[9px]" title={`Warmth ${warmth.score}, ${warmth.band}`}>
                      <span className={`w-5 text-[12.5px] font-semibold tabular-nums ${WARMTH_TEXT[warmth.band]}`}>
                        {warmth.score}
                      </span>
                      <span aria-hidden="true" className="h-[3px] w-[52px] overflow-hidden rounded-full bg-line">
                        <span className={`block h-full ${WARMTH_BAR[warmth.band]}`} style={{ width: `${warmth.score}%` }} />
                      </span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-hush">—</span>
                  )}
                </td>
                <td
                  className={`pr-[22px] pl-2 text-right text-[12px] font-semibold tabular-nums ${
                    turn.kind === "yours" ? "text-accent" : "text-ink-muted"
                  }`}
                >
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

      <div aria-live="polite" className="flex items-center justify-between border-t border-line-soft px-[22px] py-2.5">
        <span className="text-[11.5px] font-medium text-ink-ghost">
          Showing {items.length.toLocaleString("en-GB")} of {countOf(total, "contact")}
        </span>
        {moreHref && (
          <Link href={moreHref} scroll={false} className="text-[11.5px] font-semibold text-ink-muted hover:text-ink">
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
        <p>Contacts appear when the sync finishes: everyone you&rsquo;ve written to and heard back from.</p>
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
        Press Sync now to read the last {days} days of email headers. Everyone you&rsquo;ve
        written to and heard back from becomes a contact. Nothing else is read.
      </p>
    </EmptyCard>
  );
}

/**
 * What the row says, from the same bucket that counted it into a chip
 * (slice 9a). The accent is kept for "Your turn" alone: it is the only one
 * that is asking for something.
 */
const BUCKET_LABELS: Record<Exclude<ListFilter, "all">, { text: string; className: string }> = {
  yours: {
    text: "Your turn",
    className: "text-[10.5px] font-bold tracking-[0.06em] text-accent uppercase",
  },
  theirs: { text: "Their turn", className: "text-[12px] font-medium text-ink-muted" },
  quiet: { text: "Going quiet", className: "text-[12px] font-medium text-cooling" },
  closed: { text: "No open thread", className: "text-[12px] font-medium text-ink-hush" },
  settled: { text: "Nothing owed", className: "text-[12px] font-medium text-ink-muted" },
  planned: { text: "Planned", className: "text-[12px] font-medium text-info-ink" },
  muted: { text: "Just a contact", className: "text-[12px] font-medium text-ink-hush" },
};

function BucketLabel({ bucket }: { bucket: Exclude<ListFilter, "all"> }) {
  const label = BUCKET_LABELS[bucket];
  return <span className={label.className}>{label.text}</span>;
}

/**
 * One sortable column heading (slice 9b, Part 6).
 *
 * A real link, so it works without JavaScript, can be opened in a new tab and
 * keeps the search, filter and tag it was pressed with. `aria-sort` tells a
 * screen reader which column the list is in — the arrow alone says it only to
 * people who can see it.
 *
 * The column already in use is not a link: pressing it again would do nothing,
 * and a control that does nothing is the thing this part of the slice is about.
 */
function SortHeading({
  sort,
  column,
  href,
  className,
  align = "left",
  children,
}: {
  sort: SortKey;
  column: SortKey;
  href: string;
  className: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort === column;
  const side = align === "right" ? "text-right" : "text-left";

  return (
    <th scope="col" aria-sort={active ? "other" : "none"} className={`${className} ${side}`}>
      {active ? (
        <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""} text-ink-muted`}>
          {children}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" className="size-2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      ) : (
        <Link href={href} className="transition-colors hover:text-ink-muted">
          {children}
        </Link>
      )}
    </th>
  );
}
