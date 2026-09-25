import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { RowLink } from "@/app/nav-pending";
import { CARD } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { AssistantChat } from "./chat";
import { DoneMark } from "./done-mark";
import { UndoButton } from "./undo-button";
import { assistantMonthlyCapUsd } from "@/lib/ai/config";
import { countPendingPromises } from "@/lib/ai/promise-list";
import { assistantSpentThisMonth } from "@/lib/ai/spend";
import { APP_NAME } from "@/lib/app-config";
import { recentActions, type ActivityRow } from "@/lib/assistant/activity";
import { thingsToDecide, type DecideRow } from "@/lib/assistant/cards";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { countDuplicates } from "@/lib/contacts/duplicate-list";
import { displayName } from "@/lib/contacts/display";
import { suggestName } from "@/lib/contacts/name-suggestion";
import { avatarColors, dayMonth, initials, timeAgo, weekdayDayMonth } from "@/lib/format";
import { calendarConnection } from "@/lib/google/calendar-tokens";
import { allowanceLine, allowanceOf } from "@/lib/plans/allowance";
import { currentPlan } from "@/lib/plans/current";
import { limitsOf } from "@/lib/plans/plans";
import { usesThisMonth } from "@/lib/plans/usage";
import { pickBrief, thisWeek, type BriefEntry } from "@/lib/relationship/brief";
import { todayIn } from "@/lib/relationship/dates";
import { dateBadge, standingPill } from "@/lib/relationship/describe";
import { NO_MAIL, loadRelationships, type Relationship } from "@/lib/relationship/load";
import { prompts, standingOf } from "@/lib/relationship/standing";
import type { OpenTouch, Person } from "@/lib/relationship/today";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Assistant · ${APP_NAME}` };

/**
 * The scan card's "Read my mail" runs as a Server Action posted to this page,
 * so this page's time budget is the scan's. SCAN_BATCH (lib/ai/promise-scan.ts)
 * is sized to fit inside it; it moved here with the scan from /promises.
 */
export const maxDuration = 60;

/**
 * The Assistant (slice 11; docs/slice-11-plan.md), built from its approved
 * design — https://claude.ai/artifact/5ZpxKE8QYemKm7ceo9Twgg, "Assistant —
 * resting".
 *
 * The three cards come from what the app already computes, with no AI in
 * them. "It must be useful with the AI switched off" (AGENTS.md). The chat
 * under them is the Assistant itself.
 *
 * Differences from the design, on purpose, each for an honest reason:
 *   - The chat (./chat.tsx) comes last, under the strip, as the design
 *     has it: the page is worth opening before a single token is spent.
 *   - A meeting row shows the person and what is open with them, not the
 *     event's title ("Karin Lindqvist — Teams" in the design). Titles are only
 *     read live while the Calendar page draws the week, and never stored;
 *     reading Google here too would add a Gmail-sized wait to a page whose
 *     point is to be quick.
 *   - The strip shows the latest thing the Assistant did in its own words
 *     ("Added a note to Karin Lindqvist"), not the design's combined
 *     sentence: each action is its own row, with its own Undo.
 *   - Real people from your contacts, not the design's fictional cast.
 */

const WHO_NEEDS_YOU_ROWS = 4;
const MEETING_ROWS = 3;

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
};

type MeetingRow = { contact_id: string; started_at: string; ended_at: string };

export default async function AssistantPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Premium (migration 0025). Off: this address does not exist for you, and
  // Home is where you would have been going anyway.
  if (!(await hasAssistant(supabase, user.id))) redirect("/");

  const now = new Date();
  const today = todayIn("Europe/Stockholm", now);
  const week = thisWeek(now);

  const [contacts, relationships, touchesResult, duplicates, summariesResult, promises, calendar, spent, latest] =
    await Promise.all([
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
      countDuplicates(supabase, user.id),
      supabase
        .from("contact_summaries")
        .select("contact_id", { count: "exact" })
        .eq("user_id", user.id)
        .eq("status", "pending")
        .limit(1),
      countPendingPromises(supabase, user.id),
      calendarConnection(supabase, user.id),
      assistantSpentThisMonth(supabase, user.id, now),
      recentActions(supabase, user.id, 1),
    ]);
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");
  if (summariesResult.error) throw supabaseError(summariesResult.error, "Couldn't count summaries");
  // A count that comes back null answered nothing -- not the same as zero
  // (slice 7 found /privacy reporting "0" for a table that did not exist).
  if (summariesResult.count === null) throw new Error("Couldn't count summaries: no count came back");

  const people: Person<ContactRow>[] = contacts.map((contact) => ({
    contact,
    relationship: relationships.get(contact.id) ?? NO_MAIL,
  }));
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const plannedOn = earliestTouch(touchesResult.data);

  // ── Who needs you: the brief's own choice and wording (slice 6b) ────────
  const brief = pickBrief(people, touchesResult.data, week);

  // ── Today and this week: meetings with contacts, from the stored ones ──
  let meetings: MeetingRow[] = [];
  let metNoFollowUp: { contact: ContactRow; endedAt: string } | null = null;
  if (calendar) {
    const { data, error } = await supabase
      .from("calendar_meetings")
      .select("contact_id, started_at, ended_at")
      .eq("user_id", user.id)
      .eq("accepted", true)
      .gte("started_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
      .order("started_at")
      .returns<MeetingRow[]>();
    if (error) throw supabaseError(error, "Couldn't load meetings");

    meetings = data.filter((meeting) => {
      const day = todayIn("Europe/Stockholm", new Date(meeting.started_at));
      return day >= today && day <= week.end && byId.has(meeting.contact_id);
    });

    // The Calendar page's own rule (slice 8b): you met, and nothing has gone
    // back since — unless it is settled or they are never chased.
    const past = data
      .filter((meeting) => new Date(meeting.ended_at) <= now && byId.has(meeting.contact_id))
      .reverse();
    const found = past.find((meeting) => {
      const relationship = relationships.get(meeting.contact_id) ?? NO_MAIL;
      const { turn } = relationship;
      if (turn.kind !== "none" && turn.at.getTime() > new Date(meeting.ended_at).getTime()) return false;
      return prompts(
        standingOf({ turn, settledAt: relationship.settledAt, neverChase: relationship.neverChase }, today),
      );
    });
    if (found) metNoFollowUp = { contact: byId.get(found.contact_id)!, endedAt: found.ended_at };
  }

  // ── Things to decide: the queues that exist elsewhere, in one place ────
  const named = contacts
    .map((contact) => ({ contact, suggestion: suggestName(contact) }))
    .filter((entry) => entry.suggestion !== null);
  const decide = thingsToDecide({
    duplicates,
    summaries: {
      count: summariesResult.count,
      firstContactId: (summariesResult.data?.[0]?.contact_id as string | undefined) ?? null,
    },
    promises,
    names: {
      count: named.length,
      firstContactId: named[0]?.contact.id ?? null,
      firstShownAs: named[0] ? displayName(named[0].contact) : null,
    },
  });

  // Slice 13: Free sees its questions left; a paid plan its own dollar budget.
  const [plan, uses] = await Promise.all([currentPlan(supabase, user.id), usesThisMonth(supabase, user.id, now)]);
  const questions = allowanceOf(plan, uses, "assistant");
  const cap = limitsOf(plan, "assistant", assistantMonthlyCapUsd()).capUsd;
  const meter = questions
    ? { label: allowanceLine(questions, "assistant"), share: questions.allowed > 0 ? questions.used / questions.allowed : 1 }
    : { label: `$${spent.toFixed(2)} of $${cap.toFixed(0)} this month`, share: cap > 0 ? Math.min(1, spent / cap) : 1 };

  return (
    <AppShell userEmail={user.email} active="assistant" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-5 px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-[7px]">
            <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Assistant</h1>
            <p className="text-[12.5px] font-medium text-ink-soft">
              Everything the app worked out, and one place to ask for the rest.
            </p>
          </div>
          <p className="pb-1 text-[13px] font-medium text-ink-soft">{weekdayDayMonth(now)}</p>
        </div>

        <div className="flex flex-col gap-[18px] lg:flex-row">
          <WhoNeedsYou entries={brief} />
          <ThisWeek
            connected={calendar !== null}
            meetings={meetings}
            byId={byId}
            relationships={relationships}
            plannedOn={plannedOn}
            today={today}
            metNoFollowUp={metNoFollowUp}
          />
          <ThingsToDecide rows={decide} />
        </div>

        <SpendStrip meter={meter} latest={latest[0] ?? null} now={now} />

        {/* Last, on purpose: the cards above work with the AI switched off. */}
        <AssistantChat />
      </main>
    </AppShell>
  );
}

// ── Who needs you ─────────────────────────────────────────────────────────

function WhoNeedsYou({ entries }: { entries: BriefEntry<ContactRow>[] }) {
  const shown = entries.slice(0, WHO_NEEDS_YOU_ROWS);
  const waiting = entries.filter((entry) => entry.waitingOnThem).length;
  const needYou = entries.length - waiting;

  return (
    <section className={`${CARD} flex min-w-0 flex-col overflow-hidden lg:flex-1`}>
      {/* "3 this week", not the design's "4 waiting": a row below can say
          "Waiting on them", and two meanings of waiting side by side was the
          first thing that read wrong on real data. Nor "3 need you", its
          first replacement: beside Home's "Your turn: nobody is waiting on a
          reply from you" it read as the two pages disagreeing, when this list
          counts the days you planned too (QA, 2026-09-23). */}
      <CardHeading dot="bg-accent" title="Who needs you" count={needYou > 0 ? `${needYou} this week` : null} />

      {shown.length === 0 ? (
        <p className="px-5 pb-5 text-[12.5px] leading-[1.5] text-ink-soft">
          Nobody is waiting on you this week. When someone writes and you haven&rsquo;t answered, they
          show up here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((entry, index) => (
            <li
              key={entry.contact.id}
              className={`relative flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-paper-tint ${index === 0 ? "bg-paper-tint" : ""}`}
            >
              <Avatar contact={entry.contact} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <RowLink
                    href={`/contacts/${entry.contact.id}`}
                    className="truncate text-[14px] font-semibold tracking-[-0.01em]"
                  >
                    {displayName(entry.contact)}
                  </RowLink>
                  {entry.contact.company && (
                    <span className="hidden min-w-0 truncate text-[12.5px] text-ink-soft sm:inline">
                      {entry.contact.company}
                    </span>
                  )}
                </div>
                <span className="text-[12.5px] leading-[1.45] text-ink-soft">{entry.because}</span>
              </div>
              {/* Waiting on them offers nothing to draft (slice 9a): the next
                  move is theirs. The first row's button is the design's black
                  one; the rest are the quiet chip, so four rows are not four
                  black buttons. */}
              {!entry.waitingOnThem && (
                <Link
                  href={`/contacts/${entry.contact.id}#draft`}
                  className={`relative z-10 shrink-0 rounded-full px-[13px] py-[7px] text-[12px] font-semibold transition ${
                    index === 0 ? "bg-ink-deep text-white hover:bg-ink/85" : "bg-chip text-ink hover:bg-chip-track"
                  }`}
                >
                  Draft reply
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-chip px-5 pt-3 pb-4">
        <span className="text-[12px] font-medium text-ink-soft">
          {waiting > 0
            ? `Waiting on them: ${waiting === 1 ? "1 person" : `${waiting} people`}, nothing for you to do`
            : entries.length > shown.length
              ? `${entries.length - shown.length} more this week`
              : "That's everyone this week"}
        </span>
        <Link href="/" className="text-[12px] font-semibold text-accent hover:text-accent-dark">
          All of today on Home
        </Link>
      </div>
    </section>
  );
}

// ── Today and this week ───────────────────────────────────────────────────

function ThisWeek({
  connected,
  meetings,
  byId,
  relationships,
  plannedOn,
  today,
  metNoFollowUp,
}: {
  connected: boolean;
  meetings: MeetingRow[];
  byId: Map<string, ContactRow>;
  relationships: Map<string, Relationship>;
  plannedOn: Map<string, string>;
  today: string;
  metNoFollowUp: { contact: ContactRow; endedAt: string } | null;
}) {
  const shown = meetings.slice(0, MEETING_ROWS);

  return (
    <section className={`${CARD} flex min-w-0 flex-col overflow-hidden lg:flex-1`}>
      <CardHeading dot="bg-info-ink" title="Today and this week" count={null} />

      {!connected ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <p className="text-[12.5px] leading-[1.5] text-ink-soft">
            Connect your calendar and the people you are meeting this week show up here, with what
            is open with each of them.
          </p>
          <Link href="/calendar" className="self-start text-[12px] font-semibold text-accent hover:text-accent-dark">
            Connect it on Calendar
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 pb-4 text-[12.5px] leading-[1.5] text-ink-soft">
          No meetings with your contacts for the rest of this week.
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((meeting, index) => {
            const contact = byId.get(meeting.contact_id)!;
            const relationship = relationships.get(contact.id) ?? NO_MAIL;
            const pill = standingPill(
              standingOf(
                {
                  turn: relationship.turn,
                  settledAt: relationship.settledAt,
                  plannedOn: plannedOn.get(contact.id) ?? null,
                  neverChase: relationship.neverChase,
                },
                today,
              ),
            );
            const isToday = todayIn("Europe/Stockholm", new Date(meeting.started_at)) === today;
            return (
              <li
                key={`${meeting.contact_id}-${meeting.started_at}`}
                className={`relative flex items-start gap-3 px-5 py-2.5 ${index === 0 ? "bg-paper-tint" : ""}`}
              >
                <MeetingBadge startedAt={meeting.started_at} isToday={isToday} />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <RowLink
                    href={`/contacts/${contact.id}`}
                    className="truncate text-[13.5px] font-semibold tracking-[-0.01em]"
                  >
                    {displayName(contact)}
                  </RowLink>
                  <span className="text-[12px] leading-[1.45] text-ink-soft">
                    {pill ? pill.text : "Nothing open with them."}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {metNoFollowUp && (
        <div className="mt-auto flex flex-col gap-2 border-t border-chip px-5 pt-3.5 pb-4">
          <span className="text-[12.5px] font-semibold">
            You met {displayName(metNoFollowUp.contact)} on {dayMonth(metNoFollowUp.endedAt)} and never
            wrote after.
          </span>
          <Link
            href={`/contacts/${metNoFollowUp.contact.id}#draft`}
            className="self-start rounded-full bg-ink-deep px-[13px] py-[7px] text-[12px] font-semibold text-white transition hover:bg-ink/85"
          >
            Draft a follow-up
          </Link>
        </div>
      )}
    </section>
  );
}

function MeetingBadge({ startedAt, isToday }: { startedAt: string; isToday: boolean }) {
  if (isToday) {
    const time = new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Stockholm",
    }).format(new Date(startedAt));
    return (
      <div className="flex w-[42px] shrink-0 flex-col items-center rounded-[10px] bg-info-tint py-[5px] text-info-ink">
        <span className="text-[11px] leading-[1.2] font-bold">{time}</span>
        <span className="text-[9.5px] font-semibold tracking-[0.05em] uppercase">Today</span>
      </div>
    );
  }
  const { day, month } = dateBadge(todayIn("Europe/Stockholm", new Date(startedAt)));
  return (
    <div className="flex w-[42px] shrink-0 flex-col items-center rounded-[10px] bg-chip py-[5px]">
      <span className="text-[14px] leading-[1.1] font-bold">{day}</span>
      <span className="text-[9.5px] font-semibold tracking-[0.05em] text-ink-soft uppercase">{month}</span>
    </div>
  );
}

// ── Things to decide ──────────────────────────────────────────────────────

function ThingsToDecide({ rows }: { rows: DecideRow[] }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col overflow-hidden lg:flex-1`}>
      <CardHeading dot="bg-decide" title="Things to decide" count={rows.length > 0 ? String(rows.length) : null} />

      {rows.length === 0 ? (
        <p className="px-5 pb-4 text-[12.5px] leading-[1.5] text-ink-soft">
          Nothing waiting on a decision: no duplicates, summaries, promises or names to look at.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className={`flex items-center gap-3 px-5 py-[11px] ${index === 0 ? "bg-paper-tint" : ""}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold tracking-[-0.01em]">{row.title}</span>
                <span className="text-[12px] leading-[1.45] text-ink-soft">{row.detail}</span>
              </div>
              <Link
                href={row.href}
                className="shrink-0 rounded-full bg-chip px-[13px] py-[7px] text-[12px] font-semibold transition-colors hover:bg-chip-track"
              >
                {row.action}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto border-t border-chip px-5 pt-3 pb-4">
        <span className="text-[12px] font-medium text-ink-soft">
          The Assistant never merges or deletes. Those stay yours.
        </span>
      </div>
    </section>
  );
}

// ── The strip ─────────────────────────────────────────────────────────────

/**
 * The design's quiet strip: this month's spend on the Assistant's own line --
 * or, on Free, the questions left of its 20 (slice 13), the number a person
 * can act on where a dollar figure would not be.
 * The activity half — "added a note to Karin · Undo" — arrives with the
 * conversation, when there is something to show.
 */
function SpendStrip({
  meter,
  latest,
  now,
}: {
  meter: { label: string; share: number };
  latest: ActivityRow | null;
  now: Date;
}) {
  const share = Math.min(1, meter.share);

  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-[14px] bg-white px-[18px] py-[11px] shadow-[0_1px_2px_rgba(20,20,25,.04)]">
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="text-[12px] font-semibold text-ink-body">
          {meter.label}
        </span>
        <span
          aria-hidden="true"
          className="relative block h-[5px] w-[110px] overflow-hidden rounded-full bg-chip"
        >
          <span className="absolute inset-y-0 left-0 block rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
        </span>
      </div>
      <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-chip sm:block" />
      {latest ? (
        // Its own line on a phone: squeezed beside the spend it went one word per
        // line. The phone design puts this behind a header button instead; the
        // strip stays, stacked, so the Undo is one tap away on every width.
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-[9px] gap-y-1 sm:basis-0 sm:flex-1">
          <DoneMark undone={latest.undoneAt !== null} />
          <span
            className={`min-w-0 text-[12.5px] ${latest.undoneAt ? "text-ink-soft line-through" : "text-ink-body"}`}
          >
            {latest.summary}
          </span>
          <span className="shrink-0 text-[12px] text-ink-soft">{timeAgo(latest.createdAt, now)}</span>
          {latest.undoneAt ? (
            <span className="shrink-0 text-[12px] font-semibold text-ink-soft">Undone</span>
          ) : (
            <UndoButton actionId={latest.id} label={latest.summary} />
          )}
        </div>
      ) : (
        <span className="min-w-0 basis-full text-[12.5px] text-ink-soft sm:basis-0 sm:flex-1">
          Nothing done yet. What the Assistant does on its own will show here, with Undo.
        </span>
      )}
      {latest && (
        <Link href="/assistant/activity" className="link-action shrink-0 text-[12.5px] font-semibold">
          Everything it did
        </Link>
      )}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────

function CardHeading({ dot, title, count }: { dot: string; title: string; count: string | null }) {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-[17px] pb-3">
      <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${dot}`} />
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
      {count && <span className="text-[12px] font-semibold text-ink-soft">{count}</span>}
    </div>
  );
}

function Avatar({ contact }: { contact: ContactRow }) {
  const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
  return (
    <span
      aria-hidden="true"
      style={avatarColors(contact.primary_email ?? contact.id)}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
    >
      {initials(hasName ? displayName(contact) : null, contact.primary_email ?? displayName(contact))}
    </span>
  );
}

/** The soonest open touch per contact: what "planned" means for the pill. */
function earliestTouch(touches: OpenTouch[]): Map<string, string> {
  const soonest = new Map<string, string>();
  for (const touch of touches) {
    const current = soonest.get(touch.contact_id);
    if (!current || touch.due_on < current) soonest.set(touch.contact_id, touch.due_on);
  }
  return soonest;
}
