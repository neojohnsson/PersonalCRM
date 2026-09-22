import Link from "next/link";
import { AppShell } from "@/app/app-shell";
import { NotNeededButton } from "@/app/not-needed-button";
import { countPendingPromises } from "@/lib/ai/promise-list";
import { CARD, EmptyCard } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { displayName } from "@/lib/contacts/display";
import { avatarColors, countOf, dayMonth, initials } from "@/lib/format";
import { pickBrief, thisWeek, type BriefEntry, type BriefReason } from "@/lib/relationship/brief";
import { NO_MAIL, loadRelationships } from "@/lib/relationship/load";
import type { OpenTouch, Person } from "@/lib/relationship/today";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Your week · ${APP_NAME}` };

/**
 * The weekly brief (plan.md §3.9; docs/slice-6b-plan.md): at most eight people
 * worth a message this week, each with one line of why and a one-click draft.
 * Who is picked and what each line says is decided in lib/relationship/brief.ts
 * — this file only draws it.
 *
 * No design covers /brief, so it reuses the nearest ones (AGENTS.md):
 *   - The rows are Main.dc.html's list card — avatar, name, company, a second
 *     line underneath — in one card instead of two, because the brief is one
 *     list with mixed reasons rather than Your turn and Going quiet.
 *   - The reason pill and the solid/ghost button pair are Calendar.dc.html's,
 *     which has the same job: one person, a coloured reason, two actions. Its
 *     urgent pill is the only one the designs show; the calmer reasons use the
 *     chip grey of ContactDetail's quiet pill, so a whole list of them doesn't
 *     read as five alarms.
 *   - Both buttons show on every row, where Main reveals Draft reply on hover.
 *     The brief exists to be acted on, and there are at most eight rows.
 *   - A third button, Not needed, settles the conversation the row is about
 *     (slice 6c). It is Calendar.dc.html's, from the card that suggests a
 *     follow-up — the one place a design says what "this needs nothing from
 *     me" looks like.
 *   - The footnote is Calendar's grey note: it says the list is computed, not
 *     written by AI, since nothing else on the page says so.
 */

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
};

const REASON_LABEL: Record<BriefReason, string> = {
  waiting: "Your turn",
  // Slice 9a: a waiting row keeps its reason but loses the instruction.
  overdue: "Overdue",
  due_this_week: "This week",
  going_quiet: "Going quiet",
  about_to_cool: "Cooling off",
};

/** Calendar.dc.html's pill: a tinted rounded-full box with a dot to match. */
const REASON_PILL: Record<BriefReason, { box: string; dot: string }> = {
  waiting: { box: "bg-accent-tint text-accent", dot: "bg-accent" },
  overdue: { box: "bg-accent-tint text-accent", dot: "bg-accent" },
  due_this_week: { box: "bg-info-tint text-info-ink", dot: "bg-info" },
  going_quiet: { box: "bg-chip text-ink-muted", dot: "bg-ink-faint" },
  about_to_cool: { box: "bg-chip text-cooling", dot: "bg-cooling" },
};

const SOLID =
  "rounded-full bg-ink-deep px-[15px] py-2 text-[12px] font-semibold text-white transition hover:bg-ink/85";
const GHOST =
  "rounded-full bg-line-soft px-3.5 py-2 text-[12px] font-semibold text-ink-body transition hover:bg-chip-track";

export default async function BriefPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();
  const week = thisWeek(now);

  const [contacts, relationships, touchesResult, seenOnceResult, promiseCount] = await Promise.all([
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
      .from("person_tiers")
      .select("email", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("tier", "seen_once")
      .is("contact_id", null),
    countPendingPromises(supabase, user.id),
  ]);
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");
  if (seenOnceResult.error) throw supabaseError(seenOnceResult.error, "Couldn't count Seen once");

  const people: Person<ContactRow>[] = contacts.map((contact) => ({
    contact,
    relationship: relationships.get(contact.id) ?? NO_MAIL,
  }));
  const entries = pickBrief(people, touchesResult.data, week);

  return (
    <AppShell
      userEmail={user.email}
      active="home"
      seenOnceCount={seenOnceResult.count ?? 0}
      headerRight={<SignOutButton />}
    >
      <main className="flex flex-1 flex-col gap-[22px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-2">
            <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em]">Your week</h1>
            {/* Slice 9a: say that this is a selection, not a list. It is
                capped at eight and measured from Monday, and the first
                outside test read it as "everyone who needs you" and found
                it disagreed with Home. */}
            <p className="text-[12.5px] font-medium text-ink-quiet">
              {entries.length > 0
                ? `The ${countOf(entries.length, "person", "people")} most worth a message, chosen on Monday`
                : "Nobody is waiting on you this week"}
            </p>
          </div>
          <p className="pb-1 text-[13px] font-medium text-ink-faint">
            {dayMonth(week.start)} &ndash; {dayMonth(week.end)}
          </p>
        </div>

        {promiseCount > 0 && (
          // Slice 6d: promises found in the mail are decided on their own page,
          // not here — the brief is eight rows on purpose.
          <Link
            href="/promises"
            className={`${CARD} flex max-w-3xl flex-wrap items-center gap-x-2.5 gap-y-1 px-[22px] py-[13px] transition-colors hover:bg-paper-tint`}
          >
            <span aria-hidden="true" className="size-[7px] rounded-full bg-info" />
            <span className="text-[13.5px] font-semibold tracking-[-0.01em]">
              {countOf(promiseCount, "promise")} found in your mail
            </span>
            <span className="ml-auto text-[12px] font-semibold text-ink-faint">Decide them</span>
          </Link>
        )}

        {entries.length > 0 ? (
          <section className={`${CARD} max-w-3xl overflow-hidden`}>
            <ul className="divide-y divide-line-soft">
              {entries.map((entry) => (
                <BriefRow key={entry.contact.id} entry={entry} />
              ))}
            </ul>
          </section>
        ) : (
          <EmptyCard title="Nothing waiting this week">
            <p>
              Nobody has a reply owed, a next touch due, or a thread going quiet. The list fills
              again on its own as mail comes in, or when you give someone a next touch from their
              page.
            </p>
            <Link href="/" className={`${SOLID} mt-5 self-start`}>
              Back to today
            </Link>
          </EmptyCard>
        )}

        <p className="max-w-3xl px-1 text-[11.5px] leading-[1.55] font-medium text-ink-faint">
          This list is worked out from dates alone: who wrote last, when, and what you planned. No
          AI reads your mail to build it, and it stays the same list until Monday.
        </p>
      </main>
    </AppShell>
  );
}

function BriefRow({ entry }: { entry: BriefEntry<ContactRow> }) {
  const { contact, reason, because, threadId, waitingOnThem } = entry;
  const name = displayName(contact);
  const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
  const pill = REASON_PILL[reason];

  return (
    <li className="flex flex-wrap items-center gap-x-[13px] gap-y-3 px-[22px] py-[15px] transition-colors hover:bg-paper-tint">
      <span
        aria-hidden="true"
        style={avatarColors(contact.primary_email ?? contact.id)}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      >
        {initials(hasName ? name : null, contact.primary_email ?? name)}
      </span>

      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            href={`/contacts/${contact.id}`}
            className="truncate text-[14px] font-semibold tracking-[-0.01em] outline-none hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            {name}
          </Link>
          {contact.company && (
            <span title={contact.company} className="min-w-0 truncate text-[12.5px] text-ink-faint">
              {contact.company}
            </span>
          )}
          <span
            className={`flex items-center gap-[6px] rounded-full px-[9px] py-[3px] text-[11px] font-bold ${pill.box}`}
          >
            <span aria-hidden="true" className={`size-[5px] rounded-full ${pill.dot}`} />
            {REASON_LABEL[reason]}
          </span>
        </div>
        <span className="text-[12.5px] leading-[1.45] text-ink-soft">{because}</span>
      </div>

      <div className="flex shrink-0 gap-[7px]">
        {/* Slice 9a: nothing to draft when the next move is theirs. Offering
            it was the app telling you to do the one thing you had decided not
            to do. */}
        {!waitingOnThem && (
          <Link href={`/contacts/${contact.id}#draft`} className={SOLID}>
            Draft reply
          </Link>
        )}
        <Link href={`/contacts/${contact.id}`} className={GHOST}>
          Open
        </Link>
        {/* Nothing to settle when there is no thread — a row that is here
            because of a next touch on a contact with no mail. */}
        {threadId && <NotNeededButton contactId={contact.id} threadId={threadId} />}
      </div>
    </li>
  );
}
