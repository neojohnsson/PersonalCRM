import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { DisconnectGmailButton } from "@/app/disconnect-gmail-button";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/contacts/contact-form";
import { displayName } from "@/lib/contacts/display";
import { avatarColors, countOf, dayMonth, dayMonthYear, initials } from "@/lib/format";
import { todayIn } from "@/lib/relationship/dates";
import {
  lastContactCaption,
  lastContactText,
  replyRateCaption,
  replySpeedText,
  turnPill,
  type TurnPill,
} from "@/lib/relationship/describe";
import { loadRelationship, type Relationship } from "@/lib/relationship/load";
import { openNextTouch } from "@/lib/relationship/next-touch";
import type { Band } from "@/lib/relationship/warmth";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { NextTouchCard } from "./next-touch-card";

export const metadata = { title: `Contact · ${APP_NAME}` };

/**
 * One contact, built from design/ContactDetail.dc.html: the header with avatar,
 * name, role · company, the contact line and the whose-turn pill; the warmth
 * stat strip; "Your notes"; "Next touch"; "Open thread".
 *
 * Differences from the design, on purpose:
 *   - Website and city aren't contact fields (slice-2-plan.md, decision C).
 *   - The Every touch timeline and the Overview / Timeline / Threads / Notes
 *     switcher wait (docs/slice-3-plan.md, decision D).
 *   - The pill also has the other turns — their turn, going quiet, no open
 *     thread — in the contact list's colours; the design only shows "Your turn".
 *   - No mail at all: one line saying there's no warmth yet, instead of five
 *     empty stat cards.
 *   - "Draft reply" is slice 5. Its place holds Edit, the one action slice 2 has;
 *     the "···" menu has nothing to hold yet and is left out.
 *   - plan.md §3.2's "one line on what they do" and "how you know them" have no
 *     place in the design: the first sits under role · company, the second in
 *     the notes card.
 */

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const GHOST_PILL =
  "flex items-center gap-[7px] self-start rounded-full bg-line-soft px-[13px] py-[7px] text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track";

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();

  const [contactResult, emailsResult, gmailResult] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, company, role, one_liner, how_known, phone, notes, tags, created_at, updated_at",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("contact_emails")
      .select("email")
      .eq("contact_id", id)
      .eq("user_id", user.id)
      .order("is_primary", { ascending: false })
      .order("email"),
    supabase.from("google_accounts").select("email").eq("user_id", user.id).maybeSingle(),
  ]);
  if (contactResult.error) throw supabaseError(contactResult.error, "Couldn't load the contact");
  if (emailsResult.error) throw supabaseError(emailsResult.error, "Couldn't load the contact's addresses");
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");

  // Missing and someone else's look the same: a 404 either way.
  const contact = contactResult.data;
  if (!contact) notFound();

  const emails = emailsResult.data.map((row) => row.email as string);
  const [thread, relationship, nextTouch] = await Promise.all([
    latestThread(supabase, user.id, emails),
    loadRelationship(supabase, user.id, contact.id),
    openNextTouch(supabase, user.id, contact.id),
  ]);
  const pill = turnPill(relationship.turn);

  const name = displayName({ ...contact, primary_email: emails[0] ?? null });
  const hasName = Boolean(contact.first_name?.trim() || contact.last_name?.trim());
  const workLine = [contact.role, contact.company].filter(Boolean).join(" · ");
  const edited = new Date(contact.updated_at).getTime() - new Date(contact.created_at).getTime() > 2_000;

  const gmailLink = thread
    ? gmailResult.data
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailResult.data.email)}#all/${thread.id}`
      : `https://mail.google.com/mail/u/0/#all/${thread.id}`
    : null;

  return (
    <AppShell
      userEmail={user.email}
      headerRight={
        <>
          {gmailResult.data && <DisconnectGmailButton />}
          <SignOutButton />
        </>
      }
    >
      <main className="flex flex-1 flex-col gap-5 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <Link
          href="/contacts"
          aria-label="Back to contacts"
          className="flex size-[34px] items-center justify-center rounded-[11px] bg-white text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.05)] transition-colors hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[17px]">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </Link>

        <div className="flex flex-wrap items-start gap-5">
          <span
            aria-hidden="true"
            style={avatarColors(emails[0] ?? contact.id)}
            className="flex size-16 shrink-0 items-center justify-center rounded-full text-[21px] font-bold"
          >
            {initials(hasName ? name : null, emails[0] ?? name)}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-[9px] pt-0.5">
            <div className="flex flex-col gap-[3px]">
              <h1 className="text-[27px] leading-[1.1] font-bold tracking-[-0.035em] break-words">{name}</h1>
              {workLine && <p className="text-[14px] font-medium text-ink-muted">{workLine}</p>}
              {contact.one_liner && (
                <p className="mt-1 max-w-[640px] text-[13.5px] leading-[1.5] text-ink-soft">{contact.one_liner}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {emails.map((email) => (
                <a key={email} href={`mailto:${email}`} className="flex min-w-0 items-center gap-[7px] text-[12.5px] text-ink-muted hover:text-ink">
                  <MetaIcon>
                    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
                    <path d="m3.8 7.2 7.3 5.3a1.5 1.5 0 0 0 1.8 0l7.3-5.3" />
                  </MetaIcon>
                  <span className="truncate">{email}</span>
                </a>
              ))}
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-[7px] text-[12.5px] text-ink-muted hover:text-ink">
                  <MetaIcon>
                    <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
                  </MetaIcon>
                  {contact.phone}
                </a>
              )}
              {contact.tags.length > 0 && (
                <ul className="flex flex-wrap gap-[5px]" aria-label="Tags">
                  {(contact.tags as string[]).map((tag) => (
                    <li key={tag} className="rounded-full bg-chip px-2.5 py-[3px] text-[11px] font-semibold text-ink-soft">
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-[9px] pt-1">
            {pill && <TurnPillBadge pill={pill} />}
            <Link
              href={`/contacts/${id}/edit`}
              className="flex items-center gap-2 rounded-full bg-ink-deep px-[18px] py-2.5 text-[13px] font-semibold text-white transition hover:bg-ink/85"
            >
              <PencilIcon className="size-[15px]" />
              Edit
            </Link>
          </div>
        </div>

        <StatStrip relationship={relationship} hasEmails={emails.length > 0} />

        <div className="flex flex-col gap-[18px] lg:flex-row">
          <section className={`${CARD} flex min-w-0 flex-1 flex-col gap-[11px] px-[22px] py-[18px]`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Your notes</h2>
              <span className="text-[11.5px] font-semibold text-ink-faint">
                {edited ? "Edited" : "Added"} {dayMonth(contact.updated_at)}
              </span>
            </div>

            {contact.notes ? (
              <p className="text-[13.5px] leading-[1.6] whitespace-pre-line text-ink-body">{contact.notes}</p>
            ) : (
              <p className="text-[13.5px] leading-[1.6] text-ink-hush">No notes yet.</p>
            )}

            {contact.how_known && (
              <div className="flex flex-col gap-1 border-t border-line-soft pt-3">
                <h3 className="text-[10px] font-bold tracking-[0.07em] text-ink-ghost uppercase">How you know them</h3>
                <p className="text-[13.5px] leading-[1.6] whitespace-pre-line text-ink-body">{contact.how_known}</p>
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
              <Link href={`/contacts/${id}/edit#notes`} className={GHOST_PILL}>
                <PencilIcon className="size-[13px] text-ink-muted" />
                Edit note
              </Link>
              <Link href={`/contacts/${id}/edit#tags`} className={GHOST_PILL}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-[13px] text-ink-muted">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add tag
              </Link>
            </div>
          </section>

          <div className="flex flex-col gap-3.5 lg:w-[392px] lg:shrink-0">
            <NextTouchCard contactId={contact.id} touch={nextTouch} today={todayIn()} />

            <section className={`${CARD} flex flex-1 flex-col gap-[11px] px-5 py-[17px]`}>
              <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Open thread</h2>
              {thread && gmailLink ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[13px] font-semibold tracking-[-0.01em] break-words">
                      {thread.subject ?? "No subject"}
                    </span>
                    <span className="text-[12px] leading-[1.45] text-ink-muted">
                      {countOf(thread.messageCount, "message")} · {thread.lastFrom === "you" ? "you" : "they"} wrote
                      last on {dayMonth(thread.lastAt)}
                    </span>
                  </div>
                  <a href={gmailLink} target="_blank" rel="noopener noreferrer" className={`${GHOST_PILL} mt-auto`}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[13px] text-ink-muted">
                      <path d="M14 4h6v6" />
                      <path d="M20 4 11 13" />
                      <path d="M18 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
                    </svg>
                    Open in Gmail
                  </a>
                </>
              ) : (
                <p className="text-[13px] leading-[1.5] text-ink-soft">
                  {emails.length > 0
                    ? "No mail with this contact in the synced window yet."
                    : "Add an email address, and the latest thread with them shows up here."}
                </p>
              )}
            </section>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

type Thread = {
  id: string;
  subject: string | null;
  messageCount: number;
  lastFrom: "you" | "them";
  lastAt: string;
};

/** The most recent thread with any of the contact's addresses, and who wrote last in it. */
async function latestThread(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  emails: string[],
): Promise<Thread | null> {
  if (emails.length === 0) return null;

  const { data: latest, error } = await supabase
    .from("people")
    .select("last_thread_id, last_subject")
    .eq("user_id", userId)
    .in("email", emails)
    .order("last_contact_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw supabaseError(error, "Couldn't find the latest thread");
  if (!latest?.last_thread_id) return null;

  const { data: messages, error: messagesError } = await supabase
    .from("gmail_messages")
    .select("direction, internal_date")
    .eq("user_id", userId)
    .eq("thread_id", latest.last_thread_id)
    .order("internal_date", { ascending: false });
  if (messagesError) throw supabaseError(messagesError, "Couldn't load the latest thread");
  if (messages.length === 0) return null;

  return {
    id: latest.last_thread_id,
    subject: latest.last_subject,
    messageCount: messages.length,
    lastFrom: messages[0].direction === "outbound" ? "you" : "them",
    lastAt: messages[0].internal_date,
  };
}

const PILL: Record<TurnPill["tone"], { box: string; dot: string }> = {
  yours: { box: "bg-accent-tint text-accent", dot: "bg-accent" },
  quiet: { box: "bg-chip text-cooling", dot: "bg-cooling" },
  theirs: { box: "bg-chip text-ink-soft", dot: "bg-ink-faint" },
  closed: { box: "bg-chip text-ink-muted", dot: "bg-ink-ghost" },
};

function TurnPillBadge({ pill }: { pill: TurnPill }) {
  const colors = PILL[pill.tone];
  return (
    <span className={`flex items-center gap-2 rounded-full px-[15px] py-2 ${colors.box}`}>
      <span aria-hidden="true" className={`size-[7px] rounded-full ${colors.dot}`} />
      <span className="text-[12.5px] font-bold whitespace-nowrap">{pill.text}</span>
    </span>
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

const STAT =
  "flex min-w-0 flex-col gap-[7px] rounded-2xl bg-white px-[17px] pt-[15px] pb-3.5 shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";
const STAT_LABEL = "text-[10px] font-bold tracking-[0.07em] text-ink-ghost uppercase";
const STAT_VALUE = "text-[21px] leading-none font-bold tracking-[-0.03em]";

/**
 * Warmth and the four signals it's made of, with the line saying so — "a score
 * with its inputs shown is a summary" (plan.md §3.5). Each card shows the
 * signal itself; lib/relationship/warmth.ts turns them into points.
 */
function StatStrip({ relationship, hasEmails }: { relationship: Relationship; hasEmails: boolean }) {
  const { warmth, turn } = relationship;

  if (!warmth) {
    return (
      <p className="pl-0.5 text-[12.5px] font-medium text-ink-faint">
        {hasEmails
          ? "No warmth yet: it's counted from the mail between you, and there's none in the synced window."
          : "No warmth yet: it's counted from email, and this contact has no address."}
      </p>
    );
  }

  const { replyRate, replySpeed, lastContact, exchanges } = warmth.signals;

  return (
    <div className="flex flex-col gap-[9px]">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <div className={STAT}>
          <span className={STAT_LABEL}>Warmth</span>
          <span className={`${STAT_VALUE} ${WARMTH_TEXT[warmth.band]}`}>{warmth.score}</span>
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div className={`h-full ${WARMTH_BAR[warmth.band]}`} style={{ width: `${warmth.score}%` }} />
          </div>
        </div>
        <Stat
          label="Reply rate"
          value={replyRate.sent === 0 ? "—" : `${replyRate.answered} of ${replyRate.sent}`}
          caption={replyRateCaption(replyRate.answered, replyRate.sent)}
        />
        <Stat
          label="Usually replies"
          value={replySpeed.medianMs === null ? "—" : replySpeedText(replySpeed.medianMs)}
          caption={
            replySpeed.medianMs === null
              ? "no replies to you yet"
              : `median across ${countOf(replySpeed.replies, "reply", "replies")}`
          }
        />
        <Stat
          label="Last contact"
          value={lastContactText(lastContact.days)}
          caption={lastContactCaption(lastContact.from, turn)}
        />
        <Stat
          label="Exchanges"
          value={String(exchanges.count)}
          caption={`since ${dayMonthYear(exchanges.since)}`}
        />
      </div>
      <p className="pl-0.5 text-[11.5px] font-medium text-ink-faint">
        The {warmth.score} is these four numbers and nothing else — no AI opinion about how the
        relationship is going.
      </p>
    </div>
  );
}

function Stat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className={STAT}>
      <span className={STAT_LABEL}>{label}</span>
      <span className={STAT_VALUE}>{value}</span>
      <span className="text-[11.5px] font-medium text-ink-faint">{caption}</span>
    </div>
  );
}

function MetaIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-ink-ghost">
      {children}
    </svg>
  );
}

function PencilIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20h4L18.6 9.4a2.1 2.1 0 0 0-3-3L5 17v3z" />
    </svg>
  );
}
