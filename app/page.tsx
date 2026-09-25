import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { ConversationDoneButton } from "@/app/conversation-done-button";
import { CARD, EmptyCard, StatusLine } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { SyncButton } from "@/app/sync-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { avatarColors, countOf, initials, weekdayDayMonth } from "@/lib/format";
import { todayIn } from "@/lib/relationship/dates";
import { dateBadge } from "@/lib/relationship/describe";
import { isWaitingKind } from "@/lib/relationship/touch-date";
import { NO_MAIL, loadRelationships } from "@/lib/relationship/load";
import { whoNeedsYou, type ComingUp, type OpenTouch, type Person } from "@/lib/relationship/today";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { describeSync, type SyncSummary } from "@/lib/sync/describe";

export const metadata = { title: `Who needs you today · ${APP_NAME}` };

/**
 * Home: "Who needs you today", built from design/Main.dc.html — Your turn and
 * Going quiet on the left, Coming up and Seen once on the right
 * (docs/slice-3-plan.md, decision C). The answer to "who needs me today",
 * never "here are your contacts, A–Z" (AGENTS.md, core premise).
 *
 * Differences from the design, on purpose:
 *   - Your turn holds only people something is actually owed to: anyone you
 *     have settled, planned a day for, or never chase drops out, because
 *     lib/relationship/standing.ts decides who may be asked about (slice 6c).
 *   - Your turn's second line is the latest subject, where the design has an
 *     AI summary ("Asked about your thesis timeline"). Summaries are slice 6;
 *     the subject is what's stored. Going quiet uses the design's own
 *     computed wording, "You wrote 24 days ago. No answer since."
 *   - Your turn rows have the design's "Draft reply" — a link to the contact's
 *     draft panel, since the draft is read and edited there (slice 5a). The
 *     design shows it on one row; here it appears on the row under the pointer
 *     or keyboard focus, so a list of them doesn't read as nine black pills.
 *   - Long lists stop at a few rows with a link to the full, filtered contact
 *     list; the design is a fixed 900px frame and never had to say.
 *   - Coming up: a touch that's due or overdue has an orange badge, so it
 *     doesn't read like a future date.
 *   - Seen once says "people", not "new people": nothing yet knows who is new
 *     (lib/sync/describe.ts has the same reason).
 *   - The temporary Sync now pill sits beside the date (slice-1-plan.md,
 *     decision 5). The header's search and bell are left out as on the other
 *     pages; its centred page switcher arrived in slice 9b
 *     (app/app-shell.tsx).
 */

const YOUR_TURN_ROWS = 8;
const GOING_QUIET_ROWS = 5;
const COMING_UP_ROWS = 6;

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
};

const DARK_PILL =
  "flex items-center gap-[7px] rounded-full bg-ink-deep px-4 py-[9px] text-[12.5px] font-semibold text-white transition hover:bg-ink/85";

export default async function Home() {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();

  const { data: gmail, error: gmailError } = await supabase
    .from("google_accounts")
    .select("email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (gmailError) throw supabaseError(gmailError, "Couldn't check the Gmail connection");

  if (!gmail) {
    return (
      <AppShell userEmail={user.email} active="home" headerRight={<SignOutButton />}>
        <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[30px] sm:px-[30px]">
          <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Who needs you today</h1>
          <EmptyCard title="Connect Gmail to begin">
            <p>
              Once Gmail is connected, this page shows who is waiting on a reply from you, whose
              threads are going quiet, and who you meant to get back to.
            </p>
            <Link href="/connect" className={`${DARK_PILL} mt-5 self-start`}>
              Connect Gmail
            </Link>
          </EmptyCard>
        </main>
      </AppShell>
    );
  }

  const today = todayIn("Europe/Stockholm", now);

  const [contacts, relationships, touchesResult, syncResult, seenOnceResult] = await Promise.all([
    readAll<ContactRow>(
      (from, to) =>
        supabase
          .from("contact_list")
          .select("id, first_name, last_name, company, primary_email")
          .eq("user_id", user.id)
          .order("id")
          .range(from, to),
      "Couldn't load contacts",
    ),
    loadRelationships(supabase, user.id, { now }),
    supabase
      .from("next_touches")
      .select("id, contact_id, due_on, reason, kind")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("due_on")
      .limit(200)
      .returns<OpenTouch[]>(),
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
  ]);
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");
  if (syncResult.error) throw supabaseError(syncResult.error, "Couldn't load the sync status");
  if (seenOnceResult.error) throw supabaseError(seenOnceResult.error, "Couldn't count Seen once");

  const sync = syncResult.data as SyncSummary | null;
  const seenOnce = seenOnceResult.count ?? 0;

  const people: Person<ContactRow>[] = contacts.map((contact) => ({
    contact,
    relationship: relationships.get(contact.id) ?? NO_MAIL,
  }));
  const { yours, quiet, comingUp } = whoNeedsYou(people, touchesResult.data, today);

  return (
    <AppShell
      userEmail={user.email}
      active="home"
      seenOnceCount={seenOnce}
      headerRight={
        <>
          <span className="hidden text-[13px] text-ink-soft lg:inline">{gmail.email}</span>
          <SignOutButton />
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-2">
            <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Who needs you today</h1>
            <StatusLine line={describeSync(sync, contacts.length, now)} />
          </div>
          <div className="flex items-center gap-3 pb-1">
            <p className="text-[13px] font-medium text-ink-soft">{weekdayDayMonth(now)}</p>
            {sync?.status === "needs_reconnect" ? (
              <Link
                href="/connect"
                className="rounded-full bg-white px-[14px] py-2 text-[12.5px] font-semibold shadow-[0_1px_2px_rgba(20,20,25,.04)] hover:bg-paper-tint"
              >
                Reconnect Gmail
              </Link>
            ) : (
              <SyncButton />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
            <PeopleCard
              title="Your turn"
              dot="bg-accent"
              subtitle={
                yours.length > 0
                  ? `${countOf(yours.length, "person is", "people are")} waiting on a reply from you`
                  : "Nobody is waiting on a reply from you"
              }
              empty="When someone writes and you haven't answered, they show up here — longest wait first."
              rows={yours.slice(0, YOUR_TURN_ROWS).map((person) => ({
                person,
                line: subjectOf(person),
                daysClass: "text-accent",
                draftHref: `/contacts/${person.contact.id}#draft`,
              }))}
              more={
                yours.length > YOUR_TURN_ROWS
                  ? { href: "/contacts?filter=yours", text: `See all ${yours.length}` }
                  : null
              }
            />

            <PeopleCard
              title="Going quiet"
              dot="bg-ink-soft"
              subtitle="You spoke last and nothing came back"
              empty="Nothing yet. A thread shows up here when you wrote last and two weeks pass without an answer."
              rows={quiet.slice(0, GOING_QUIET_ROWS).map((person) => ({
                person,
                line: quietLine(person),
                daysClass: "text-ink-soft",
              }))}
              more={
                quiet.length > GOING_QUIET_ROWS
                  ? { href: "/contacts?filter=quiet", text: `See all ${quiet.length}` }
                  : null
              }
            />
          </div>

          <div className="flex flex-col gap-[18px] lg:w-[296px] lg:shrink-0">
            <ComingUpCard touches={comingUp} />

            <section className={`${CARD} flex flex-col gap-[11px] px-5 py-[18px]`}>
              <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Seen once</h2>
              {seenOnce > 0 ? (
                <>
                  <p className="text-[12.5px] leading-[1.5] text-ink-soft">
                    {countOf(seenOnce, "person", "people")} wrote to you — or you wrote to them — but
                    never both. They&rsquo;re waiting out of the way.
                  </p>
                  <Link
                    href="/seen-once"
                    className="self-start rounded-full bg-chip px-4 py-[9px] text-[12.5px] font-semibold transition-colors hover:bg-chip-track"
                  >
                    Review them
                  </Link>
                </>
              ) : (
                <p className="text-[12.5px] leading-[1.5] text-ink-soft">
                  Nobody waiting. People you&rsquo;ve only exchanged one-way mail with land here.
                </p>
              )}
            </section>
          </div>
        </div>

      </main>
    </AppShell>
  );
}

function subjectOf({ relationship: { turn } }: Person<ContactRow>): string {
  return turn.kind === "none" ? "" : (turn.subject ?? "No subject");
}

function quietLine(person: Person<ContactRow>): string {
  const { turn } = person.relationship;
  if (turn.kind === "none") return "";
  return `You wrote ${turn.days} days ago. No answer since.`;
}

type Row = {
  person: Person<ContactRow>;
  line: string;
  daysClass: string;
  /** Set on the rows where they wrote last: the design's "Draft reply" button. */
  draftHref?: string;
};

/** The conversation a row is about, for Conversation done. Null when there is no mail. */
function threadOf({ relationship: { turn } }: Person<ContactRow>): string | null {
  return turn.kind === "none" ? null : turn.threadId;
}

/** One of Main's left-hand cards: a coloured dot, a title, and people. */
function PeopleCard({
  title,
  dot,
  subtitle,
  empty,
  rows,
  more,
}: {
  title: string;
  dot: string;
  subtitle: string;
  empty: string;
  rows: Row[];
  more: { href: string; text: string } | null;
}) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-[22px] pt-[17px] pb-[13px]">
        <span aria-hidden="true" className={`size-[7px] rounded-full ${dot}`} />
        <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
        <span className="text-[12px] font-semibold text-ink-soft">{subtitle}</span>
      </div>

      {rows.length > 0 ? (
        <ul className="pb-[5px]">
          {rows.map((row) => (
            <PersonRow key={row.person.contact.id} {...row} />
          ))}
        </ul>
      ) : (
        <p className="px-[22px] pb-[18px] text-[12.5px] leading-[1.5] text-ink-soft">{empty}</p>
      )}

      {more && (
        <div className="border-t border-line-soft px-[22px] py-2.5">
          <Link href={more.href} className="text-[11.5px] font-semibold text-ink-soft hover:text-ink">
            {more.text}
          </Link>
        </div>
      )}
    </section>
  );
}

function PersonRow({ person, line, daysClass, draftHref }: Row) {
  const { contact, relationship } = person;
  const threadId = threadOf(person);
  const name = displayName(contact);
  const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
  const days = relationship.turn.kind === "none" ? null : relationship.turn.days;

  return (
    <li className="group relative flex flex-wrap items-center gap-x-[13px] gap-y-2.5 px-[22px] py-[11px] transition-colors hover:bg-paper-tint">
      <span
        aria-hidden="true"
        style={avatarColors(contact.primary_email ?? contact.id)}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      >
        {initials(hasName ? name : null, contact.primary_email ?? name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {/* The link stretches over the whole row (after:inset-0). */}
          <Link
            href={`/contacts/${contact.id}`}
            className="stretched-link truncate text-[14px] font-semibold tracking-[-0.01em]"
          >
            {name}
          </Link>
          {contact.company && (
            // One line, ending in "…"; the full name on hover.
            <span title={contact.company} className="hidden min-w-0 truncate text-[12.5px] text-ink-soft sm:inline">
              {contact.company}
            </span>
          )}
        </div>
        <span className="truncate text-[12.5px] text-ink-soft">{line}</span>
      </div>
      {/* Slice 6c: say the conversation is finished, without opening it.
          Shown with Draft reply, on the row under the pointer or keyboard
          focus, so a list of rows doesn't read as a wall of buttons.

          Slice 9b, Part 1: that only works where there is a pointer. On a
          phone both were `hidden`, so the two things you can do to a row
          could not be done at all. They are plainly visible below sm and on
          any device that cannot hover, and stay hover-revealed on a mouse. */}
      {(threadId || draftHref) && (
        // On a phone the actions drop to their own line under the name, indented
        // past the avatar: four things in one 390px row left the name a stub.
        <div className="order-last flex w-full shrink-0 items-center gap-2 pl-[45px] sm:order-none sm:w-auto sm:pl-0">
          {threadId && (
            <ConversationDoneButton
              contactId={contact.id}
              threadId={threadId}
              className="relative z-10 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:no-hover:opacity-100"
            />
          )}
          {draftHref && (
            <Link
              href={draftHref}
              className="relative z-10 rounded-full bg-ink-deep px-3.5 py-[13px] text-[12px] font-semibold text-white transition hover:bg-ink/85 sm:py-[7px] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:no-hover:opacity-100"
            >
              Draft reply
            </Link>
          )}
        </div>
      )}
      {days !== null && (
        <span className={`w-[34px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums ${daysClass}`}>
          {days === 0 ? "today" : `${days}d`}
        </span>
      )}
    </li>
  );
}

function ComingUpCard({ touches }: { touches: ComingUp<ContactRow>[] }) {
  const shown = touches.slice(0, COMING_UP_ROWS);

  return (
    <section className={`${CARD} flex flex-col gap-[15px] px-5 py-[18px]`}>
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Coming up</h2>

      {shown.length === 0 ? (
        <p className="-mt-1.5 text-[12.5px] leading-[1.5] text-ink-soft">
          No next touches set. Give a contact one from their page, and it shows up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-[15px]">
          {shown.map((touch) => {
            const { day, month } = dateBadge(touch.due_on);
            const due = touch.overdue || touch.dueToday;
            return (
              <li key={touch.id} className="relative flex items-start gap-3">
                <div
                  className={`flex w-10 shrink-0 flex-col items-center rounded-[10px] py-[5px] ${
                    due ? "bg-accent-tint text-accent" : "bg-chip"
                  }`}
                >
                  <span className="text-[14px] leading-[1.1] font-bold">{day.padStart(2, "0")}</span>
                  <span
                    className={`text-[9.5px] font-semibold tracking-[0.05em] uppercase ${
                      due ? "text-accent" : "text-ink-meta"
                    }`}
                  >
                    {month}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/contacts/${touch.contact.id}`}
                    className="stretched-link truncate text-[13.5px] font-semibold tracking-[-0.01em] hover:text-ink-soft"
                  >
                    {displayName(touch.contact)}
                  </Link>
                  {/* Slice 9a: a reminder to check is not a thing to do. */}
                  {isWaitingKind(touch.kind) && (
                    <span className="text-[11px] font-semibold tracking-[0.04em] text-info-ink uppercase">
                      Waiting on them
                    </span>
                  )}
                  {touch.reason ? (
                    <span className="text-[12px] leading-[1.4] break-words text-ink-soft">
                      &ldquo;{touch.reason}&rdquo;
                    </span>
                  ) : (
                    <span className="text-[12px] leading-[1.4] text-ink-soft">No reason written down</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {touches.length > shown.length && (
        // Slice 9b, Part 6: it read as a link and was a full stop. The rest of
        // the days you have planned are the contact list's "Planned" filter.
        <Link
          href="/contacts?filter=planned"
          className="text-[11.5px] font-medium text-ink-soft transition-colors hover:text-ink"
        >
          and {touches.length - shown.length} more later
        </Link>
      )}
    </section>
  );
}
