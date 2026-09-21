import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { CalendarPanel } from "@/app/connect/calendar-panel";
import { CARD, EmptyCard } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { buildWeek, clock, mondayOf, weekLabel } from "@/lib/calendar/week";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { avatarColors, dayMonth, initials } from "@/lib/format";
import { listEvents } from "@/lib/google/calendar";
import { calendarConnection, getCalendarAccessToken } from "@/lib/google/calendar-tokens";
import { addDays, isIsoDate, todayIn } from "@/lib/relationship/dates";
import { turnPill } from "@/lib/relationship/describe";
import { NO_MAIL, loadRelationships } from "@/lib/relationship/load";
import { prompts, standingOf } from "@/lib/relationship/standing";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Calendar · ${APP_NAME}` };

/** Reading a week from Google takes a moment; the grid waits for it. */
export const maxDuration = 30;

/**
 * The calendar week (design/Calendar.dc.html; docs/slice-8-plan.md, Part 5).
 *
 * It answers the same question as the rest of the app — who needs me — using
 * meetings as well as mail. No AI anywhere on it: like whose turn it is and
 * warmth, all of this is plain computation.
 *
 * The events are read from Google as the page loads, titles included, and none
 * of the titles are written down: `calendar_meetings` has no column for one
 * (migration 0022), and /privacy says so. The whole week is shown, lectures and
 * focus blocks included, because a week with the other events missing would
 * look wrong and make the meetings hard to place.
 *
 * Differences from the design, on purpose:
 *   - **This is where the calendar is connected.** The design assumes it
 *     already is. Asked for on 2026-09-21: connecting it was buried at the
 *     bottom of the Connect screen, which a person sees once, before they have
 *     any reason to care about a calendar. An unconnected calendar now makes
 *     this page one explanation and one button.
 *   - No Month or Agenda tabs, and no search or bell in the header: one view
 *     exists, and a tab that switches to nothing would be a lie (app-shell.tsx
 *     leaves out the same header controls for the same reason).
 *   - "Before your 15:30" is "Next with a contact", because the design's card
 *     assumed a meeting later the same day. It shows the next one whenever it
 *     is.
 *   - The design's note about meetings counting toward warmth is kept word for
 *     word: it is the most important sentence on the screen.
 *   - **Nothing scrolls.** The design is a fixed 900px frame, so copying its
 *     64px hours gave the page two scrollbars on a real window: one across,
 *     from the width seven columns needed, and one down, from ten hours of
 *     64px. The grid is a percentage of whatever height it is given and the
 *     columns simply share the width (changed 2026-09-21, at the user's
 *     request). On a phone the columns get narrow rather than sliding sideways.
 */

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
};

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();

  const connection = await calendarConnection(supabase, user.id);
  if (!connection) {
    return (
      <Frame userEmail={user.email}>
        <NotConnected />
      </Frame>
    );
  }

  const { monday: asked } = await searchParams;
  const monday = typeof asked === "string" && isIsoDate(asked) ? mondayOf(asked) : mondayOf(todayIn("Europe/Stockholm", now));

  const [contacts, addresses, relationships, touchesResult, meetingsResult] = await Promise.all([
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
    readAll<{ contact_id: string; email: string }>(
      (from, to) =>
        supabase.from("contact_emails").select("contact_id, email").eq("user_id", user.id).order("id").range(from, to),
      "Couldn't load contact addresses",
    ),
    loadRelationships(supabase, user.id, { now }),
    supabase
      .from("next_touches")
      .select("id, contact_id, due_on, reason")
      .eq("user_id", user.id)
      .eq("status", "open")
      .gte("due_on", monday)
      .lte("due_on", addDays(monday, 6))
      .returns<{ id: string; contact_id: string; due_on: string; reason: string | null }[]>(),
    supabase
      .from("calendar_meetings")
      .select("contact_id, started_at, ended_at")
      .eq("user_id", user.id)
      .eq("accepted", true)
      .lte("ended_at", now.toISOString())
      .order("ended_at", { ascending: false })
      .limit(60)
      .returns<{ contact_id: string; started_at: string; ended_at: string }[]>(),
  ]);
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");
  if (meetingsResult.error) throw supabaseError(meetingsResult.error, "Couldn't load meetings");

  const addressToContact = new Map(addresses.map((row) => [row.email.toLowerCase(), row.contact_id]));
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));

  // Read the week itself. A refused read leaves the page standing, with the
  // grid replaced by what went wrong — the same principle as the promise queue
  // showing a row whose message Gmail no longer has.
  let week: ReturnType<typeof buildWeek> | null = null;
  let readProblem: string | null = null;
  try {
    const token = await getCalendarAccessToken(supabase, user.id);
    const events = await listEvents(
      token,
      { from: new Date(`${monday}T00:00:00Z`), to: new Date(`${addDays(monday, 7)}T00:00:00Z`) },
      { withTitles: true },
    );
    week = buildWeek(monday, events, addressToContact, now);
  } catch (failure) {
    readProblem = failure instanceof Error ? failure.message : "The calendar could not be read.";
  }

  const today = todayIn("Europe/Stockholm", now);

  // Next with a contact: the soonest meeting from now on.
  const upcoming =
    week?.events.find((event) => event.contactId && event.endedAt.getTime() > now.getTime()) ?? null;

  // Met, no follow-up: the meeting is over and nothing has gone back since.
  const noFollowUp = meetingsResult.data
    .filter((meeting) => {
      const relationship = relationships.get(meeting.contact_id) ?? NO_MAIL;
      const { turn } = relationship;
      if (turn.kind === "none") return true;
      if (turn.at.getTime() > new Date(meeting.ended_at).getTime()) return false;
      // Nothing to nag about if you have settled it or never chase them.
      return prompts(
        standingOf(
          { turn, settledAt: relationship.settledAt, neverChase: relationship.neverChase },
          today,
        ),
      );
    })
    .filter((meeting, index, all) => all.findIndex((m) => m.contact_id === meeting.contact_id) === index)
    .slice(0, 4);

  const meetingCount = meetingsResult.data.length;

  return (
    <Frame userEmail={user.email}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Calendar</h1>
          <div className="flex items-center gap-[9px]">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-affirm" />
            <p className="text-[12.5px] font-medium text-ink-quiet">
              {connection.email} &middot; read-only &middot; nothing is ever created or changed
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3 pb-0.5">
          <Legend />
          <div className="flex items-center gap-1.5">
            <WeekStep monday={addDays(monday, -7)} label="Previous week" arrow="‹" />
            <span className="px-1.5 text-[13px] font-semibold tracking-[-0.01em]">{weekLabel(monday)}</span>
            <WeekStep monday={addDays(monday, 7)} label="Next week" arrow="›" />
            <Link
              href="/calendar"
              className="ml-1 rounded-full bg-white px-3.5 py-[7px] text-[12px] font-semibold text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.05)] transition hover:bg-paper-tint"
            >
              Today
            </Link>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row">
        <section className={`${CARD} flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden`}>
          {week ? (
            <WeekGrid week={week} byId={byId} touches={touchesResult.data} />
          ) : (
            <div className="flex flex-col gap-2 px-[22px] py-6">
              <p className="text-[13.5px] font-semibold">The week couldn&rsquo;t be read</p>
              <p className="text-[12.5px] leading-[1.5] text-ink-soft">{readProblem}</p>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-[18px] lg:w-[296px] lg:shrink-0">
          {upcoming && upcoming.contactId && byId.has(upcoming.contactId) && (
            <NextWithContact event={upcoming} contact={byId.get(upcoming.contactId)!} relationships={relationships} />
          )}

          <section className={`${CARD} flex flex-col gap-3 px-5 py-[18px]`}>
            <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Met, no follow-up</h2>
            {noFollowUp.length === 0 ? (
              <p className="text-[12.5px] leading-[1.5] text-ink-soft">
                {meetingCount === 0
                  ? "No meetings with your contacts have been read yet."
                  : "Nothing outstanding: you have written to everyone you met."}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {noFollowUp.map((meeting) => {
                  const contact = byId.get(meeting.contact_id);
                  if (!contact) return null;
                  const name = displayName(contact);
                  return (
                    <li key={`${meeting.contact_id}-${meeting.started_at}`} className="relative flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        style={avatarColors(contact.primary_email ?? contact.id)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      >
                        {initials(name, contact.primary_email ?? name)}
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="truncate text-[13.5px] font-semibold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:content-[''] hover:text-ink-soft"
                        >
                          {name}
                        </Link>
                        <span className="text-[12px] leading-[1.45] text-ink-soft">
                          Met {dayMonth(meeting.started_at)}. Nothing sent since.
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <CalendarPanel
            email={connection.email}
            meetings={meetingCount}
            readThrough={connection.syncedThrough}
          />

          {/* The design's own note, word for word. */}
          <p className="px-1 text-[11.5px] leading-[1.55] font-medium text-ink-faint">
            A meeting with a contact counts toward warmth, like an exchange does. Only the time,
            title and guest addresses are read &mdash; never the description &mdash; and no event
            is ever created or changed.
          </p>
        </div>
      </div>
    </Frame>
  );
}

function Frame({ userEmail, children }: { userEmail: string | undefined; children: React.ReactNode }) {
  return (
    <AppShell userEmail={userEmail} active="calendar" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[30px] sm:px-[30px]">{children}</main>
    </AppShell>
  );
}

/**
 * The page with no calendar connected — the reason this page exists at all
 * before the grid does (asked for 2026-09-21).
 */
function NotConnected() {
  return (
    <>
      <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Calendar</h1>
      <EmptyCard title="Connect your calendar">
        <p>
          A meeting with someone says more about a relationship than any email does. With your
          calendar connected, a meeting counts towards how warm a contact is, and this page shows
          your week with the people you already know in it.
        </p>
        <p className="mt-3">
          Only the start, the end, the title and the guest addresses are read &mdash; never the
          description. Only meetings with someone already in your contacts are stored, as the date
          and which contact it was. Nothing in your calendar is ever created or changed, because
          the app never asks Google for permission to.
        </p>
        <form action="/api/auth/google/calendar" method="post" className="mt-5">
          <button
            type="submit"
            className="rounded-full bg-ink-deep px-[26px] py-3 text-[13.5px] font-semibold text-white transition hover:bg-ink/85"
          >
            Connect your calendar
          </button>
        </form>
      </EmptyCard>
    </>
  );
}

function Legend() {
  return (
    <div className="hidden items-center gap-3.5 xl:flex">
      {[
        { colour: "bg-info-tint", label: "With a contact" },
        { colour: "bg-chip", label: "Other events" },
        { colour: "bg-accent-tint", label: "Next touch" },
      ].map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-2.5 rounded-[3px] ${item.colour}`} />
          <span className="text-[11.5px] font-medium text-ink-muted">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function WeekStep({ monday, label, arrow }: { monday: string; label: string; arrow: string }) {
  return (
    <Link
      href={`/calendar?monday=${monday}`}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-[11px] bg-white text-[13px] font-bold text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.05)] transition hover:bg-paper-tint"
    >
      {arrow}
    </Link>
  );
}

/** The grid: day headers, the Due row, hour lines and the events. */
function WeekGrid({
  week,
  byId,
  touches,
}: {
  week: ReturnType<typeof buildWeek>;
  byId: Map<string, ContactRow>;
  touches: { id: string; contact_id: string; due_on: string; reason: string | null }[];
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center">
          <div className="w-[52px] shrink-0" />
          {week.days.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-1 items-center justify-center gap-[7px]">
              <span
                className={`text-[10.5px] font-bold tracking-[0.06em] uppercase ${
                  day.isToday ? "text-ink" : "text-ink-ghost"
                }`}
              >
                {day.weekday}
              </span>
              {day.isToday ? (
                <span className="flex size-[26px] items-center justify-center rounded-full bg-ink-deep text-[13px] font-bold text-white">
                  {day.dayOfMonth}
                </span>
              ) : (
                <span className={`text-[15px] font-bold tracking-[-0.02em] ${day.isWeekend ? "text-ink-faint" : ""}`}>
                  {day.dayOfMonth}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Due: this app's own next touches, not anything from Google. */}
        <div className="flex h-9 shrink-0 items-stretch border-y border-line">
          <div className="flex w-[52px] shrink-0 items-center justify-end pr-2">
            <span className="text-[9.5px] font-bold tracking-[0.05em] text-ink-ghost uppercase">Due</span>
          </div>
          {week.days.map((day) => {
            const due = touches.filter((touch) => touch.due_on === day.date);
            return (
              <div
                key={day.date}
                className={`flex min-w-0 flex-1 items-center gap-1 border-l border-chip px-1 ${
                  day.isWeekend ? "bg-paper-tint" : ""
                }`}
              >
                {due.map((touch) => {
                  const contact = byId.get(touch.contact_id);
                  return (
                    <Link
                      key={touch.id}
                      href={`/contacts/${touch.contact_id}`}
                      title={touch.reason ?? undefined}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] bg-accent-tint px-2 py-1"
                    >
                      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-accent" />
                      <span className="truncate text-[11px] font-semibold text-accent-dark">
                        {contact ? displayName(contact) : "A contact"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* The hours fill whatever height is left, so the week always fits. */}
        <div className="relative flex min-h-0 flex-1">
          {week.hours.slice(0, -1).map((hour, index) => (
            <div
              key={hour}
              aria-hidden="true"
              className="absolute right-0 left-[52px] h-px bg-chip"
              style={{ top: `${(index / (week.hours.length - 1)) * 100}%` }}
            />
          ))}

          <div className="relative w-[52px] shrink-0">
            {week.hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute w-11 -translate-y-1/2 text-right text-[10.5px] font-semibold text-ink-ghost"
                style={{ top: `${(index / (week.hours.length - 1)) * 100}%` }}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          </div>

          {week.days.map((day, dayIndex) => (
            <div
              key={day.date}
              className={`relative min-w-0 flex-1 border-l border-chip ${day.isWeekend ? "bg-paper-tint" : ""}`}
            >
              {week.events
                .filter((event) => event.dayIndex === dayIndex)
                .map((event) => {
                  const contact = event.contactId ? byId.get(event.contactId) : null;
                  return (
                    <div
                      key={event.id}
                      className={`absolute inset-x-[3px] flex flex-col gap-px overflow-hidden rounded-[9px] px-1.5 py-1 ${
                        contact ? "bg-info-tint" : "bg-chip/60"
                      }`}
                      // A 15-minute meeting still has to be readable, so the
                      // block has a floor in pixels while its place is a
                      // percentage.
                      style={{
                        top: `${event.topPercent}%`,
                        height: `${event.heightPercent}%`,
                        minHeight: "20px",
                      }}
                    >
                      <span
                        className={`truncate text-[11.5px] leading-[1.3] font-semibold tracking-[-0.01em] ${
                          contact ? "text-info-ink" : "text-ink-body"
                        }`}
                      >
                        {contact ? displayName(contact) : event.title}
                      </span>
                      <span className={`truncate text-[10.5px] leading-[1.3] ${contact ? "text-info" : "text-ink-faint"}`}>
                        {event.when}
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The design's "Before your 15:30", for whenever the next one is. */
function NextWithContact({
  event,
  contact,
  relationships,
}: {
  event: NonNullable<ReturnType<typeof buildWeek>>["events"][number];
  contact: ContactRow;
  relationships: Map<string, ReturnType<typeof loadRelationships> extends Promise<Map<string, infer R>> ? R : never>;
}) {
  const relationship = relationships.get(contact.id) ?? NO_MAIL;
  const pill = turnPill(relationship.turn);
  const name = displayName(contact);

  return (
    <section className={`${CARD} flex flex-col gap-3.5 px-5 py-[18px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
        <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Next with a contact</h2>
        <span className="text-[11.5px] font-semibold text-ink-faint">
          {dayMonth(event.startedAt)}, {clock(event.startedAt)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          style={avatarColors(contact.primary_email ?? contact.id)}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        >
          {initials(name, contact.primary_email ?? name)}
        </span>
        <div className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{name}</span>
          {contact.company && <span className="truncate text-[12px] text-ink-faint">{contact.company}</span>}
        </div>
      </div>

      {pill && (
        <span className="flex items-center gap-2 self-start rounded-full bg-chip px-3 py-1.5">
          <span aria-hidden="true" className="size-[6px] rounded-full bg-ink-faint" />
          <span className="text-[12px] font-bold whitespace-nowrap">{pill.text}</span>
        </span>
      )}

      <Link
        href={`/contacts/${contact.id}`}
        className="self-start rounded-full bg-ink-deep px-[15px] py-2 text-[12px] font-semibold text-white transition hover:bg-ink/85"
      >
        Open contact
      </Link>
    </section>
  );
}
