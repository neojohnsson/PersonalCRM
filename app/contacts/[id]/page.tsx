import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { AiNotConfigured, aiConfig, monthlyCapUsd } from "@/lib/ai/config";
import { spentThisMonth } from "@/lib/ai/spend";
import { gmailDraftsUrl, lastSavedDraft, pendingDraft } from "@/lib/ai/draft-save";
import { summariesFor } from "@/lib/ai/summary-record";
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
  standingPill,
  type TurnPill,
} from "@/lib/relationship/describe";
import { suggestName } from "@/lib/contacts/name-suggestion";
import { conversation, type StoredMessage } from "@/lib/relationship/conversation";
import { loadRelationship, type Relationship } from "@/lib/relationship/load";
import { wholeDaysBetween } from "@/lib/relationship/whose-turn";
import { standingOf } from "@/lib/relationship/standing";
import { openNextTouch, openNextTouches } from "@/lib/relationship/next-touch";
import { canDraft, canWriteCalendar } from "@/lib/google/scopes";
import { calendarConnection } from "@/lib/google/calendar-tokens";
import { loadProfile } from "@/lib/profile/store";
import { checkReferral } from "@/lib/relationship/referral";
import type { ReferredStatus } from "./summary-card";
import type { Band } from "@/lib/relationship/warmth";
import { supabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { ContactMenu } from "./contact-menu";
import { ConversationCard } from "./conversation-card";
import { NameSuggestionRow } from "./name-suggestion-row";
import { HeaderDraftButton } from "./header-draft-button";
import { DraftCard } from "./draft-card";
import { CreateEvent } from "@/app/calendar/create-event";
import { NextTouchCard } from "./next-touch-card";
import { SummaryCard, type AiBudget } from "./summary-card";
import { currentPlan } from "@/lib/plans/current";
import { limitsOf } from "@/lib/plans/plans";
import { allowanceOf, roomFor } from "@/lib/plans/allowance";
import { usesThisMonth } from "@/lib/plans/usage";
import { ResearchCard } from "./research-card";
import { loadResearch } from "@/lib/research/decide";
import { hasResearch } from "@/lib/research/entitlement";
import { typicalCostUsd } from "@/lib/assistant/price";

export const metadata = { title: `Contact · ${APP_NAME}` };

/**
 * One contact, built from design/ContactDetail.dc.html: the header with avatar,
 * name, role · company, the contact line and the whose-turn pill; the warmth
 * stat strip; the AI relationship summary; "Your notes"; "Next touch"; "Open
 * thread".
 *
 * Differences from the design, on purpose:
 *   - Website and city aren't contact fields (slice-2-plan.md, decision C).
 *   - The Every touch timeline and the Overview / Timeline / Threads / Notes
 *     switcher wait (docs/slice-3-plan.md, decision D).
 *   - The pill also has the other turns — their turn, going quiet, no open
 *     thread — in the contact list's colours; the design only shows "Your turn".
 *   - No mail at all: one line saying there's no warmth yet, instead of five
 *     empty stat cards.
 *   - The relationship summary card (slice 4) has no design; it's built from
 *     this page's own cards, and says so in app/contacts/[id]/summary-card.tsx.
 *   - The header is the design's three controls as of slice 9b: the standing
 *     pill, the "···" menu (./contact-menu.tsx) and Draft reply
 *     (./header-draft-button.tsx). Everything else it had grown -- Edit,
 *     Nothing owed here, Just a contact, Export, Dismiss -- is in the menu,
 *     in plain words. Draft reply writes a draft rather than jumping to the
 *     panel, and is absent when no draft is possible instead of sitting there
 *     black and dead. The panel it fills has no design of its own
 *     (./draft-card.tsx).
 *   - plan.md §3.2's "one line on what they do" and "how you know them" have no
 *     place in the design: the first sits under role · company, the second in
 *     the notes card.
 */

/** How long a new contact keeps asking whether to generate a summary. */
const ASK_FOR_SUMMARY_DAYS = 7;

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const GHOST_PILL =
  "flex items-center gap-[7px] self-start rounded-full bg-line-soft px-[13px] py-[7px] text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track";

export default async function ContactPage({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const { touch: suggestionFrom } = await searchParams;
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
    supabase.from("google_accounts").select("email, scopes").eq("user_id", user.id).maybeSingle(),
  ]);
  if (contactResult.error) throw supabaseError(contactResult.error, "Couldn't load the contact");
  if (emailsResult.error) throw supabaseError(emailsResult.error, "Couldn't load the contact's addresses");
  if (gmailResult.error) throw supabaseError(gmailResult.error, "Couldn't check the Gmail connection");

  // Missing and someone else's look the same: a 404 either way.
  const contact = contactResult.data;
  if (!contact) notFound();

  const emails = emailsResult.data.map((row) => row.email as string);
  const [thread, relationship, nextTouch, summaries, spentUsd, researchOn] = await Promise.all([
    latestThread(supabase, user.id, emails),
    loadRelationship(supabase, user.id, contact.id),
    openNextTouch(supabase, user.id, contact.id),
    summariesFor(supabase, user.id, contact.id),
    spentThisMonth(supabase, user.id),
    hasResearch(supabase, user.id),
  ]);
  // Web research (slice 12): only for an account that has it switched on.
  const [research, researchUsd] = researchOn
    ? await Promise.all([loadResearch(supabase, user.id, contact.id), typicalCostUsd(supabase, user.id, "research")])
    : [null, null];

  const [draft, savedDraft, profile, calendar] = await Promise.all([
    pendingDraft(supabase, user.id, contact.id),
    lastSavedDraft(supabase, user.id, contact.id),
    loadProfile(supabase, user.id),
    // Slice 10: whether "Book time with them" is offered at all. A calendar
    // connected before slice 10 has only the read permission.
    calendarConnection(supabase, user.id),
  ]);
  const gmailScopes = (gmailResult.data?.scopes as string[] | undefined) ?? [];
  // Slice 13: the plan's own limit, and on Free what is left of the month's count.
  const [plan, uses] = await Promise.all([currentPlan(supabase, user.id), usesThisMonth(supabase, user.id)]);
  const budget: AiBudget = {
    spentUsd,
    capUsd: limitsOf(plan, "summary", monthlyCapUsd()).capUsd,
    ready: aiIsReady(),
    summaries: allowanceOf(plan, uses, "summary"),
    drafts: allowanceOf(plan, uses, "draft"),
  };

  // A summary that names a referral: have you written to that person since?
  // Worked out now, from your mail — not stored, so it's never out of date.
  const referrals: Record<string, ReferredStatus[]> = {};
  await Promise.all(
    [summaries.approved, summaries.pending].map(async (summary) => {
      if (!summary || !summary.suggested_referral_since) return;
      // Summaries saved before migration 0015 hold one name in its own column.
      const people =
        summary.suggested_referrals.length > 0
          ? summary.suggested_referrals
          : summary.suggested_referral_name
            ? [{ name: summary.suggested_referral_name, email: summary.suggested_referral_email }]
            : [];
      if (people.length === 0) return;

      referrals[summary.id] = await Promise.all(
        people.map(async (person) => ({
          name: person.name,
          status: await checkReferral(supabase, user.id, {
            name: person.name,
            email: person.email,
            since: summary.suggested_referral_since!,
          }),
          plannedOn: null,
        })),
      );
    }),
  );

  // A referred person who is a contact may already have a next touch of their
  // own — then there's nothing to suggest about them.
  const referredContactIds = Object.values(referrals)
    .flat()
    .map((person) => ("contactId" in person.status ? person.status.contactId : null))
    .filter((id): id is string => id !== null);
  const referredTouches = await openNextTouches(supabase, user.id, referredContactIds);
  for (const person of Object.values(referrals).flat()) {
    const contactId = "contactId" in person.status ? person.status.contactId : null;
    person.plannedOn = contactId ? (referredTouches.get(contactId)?.due_on ?? null) : null;
  }

  // "Fill in next touch" on the summary links here with ?touch=<summary id>.
  // Only an id travels in the address; the suggestion is read from the database.
  // A contact added in the last week, with mail and no summary, asks whether to
  // generate one (docs/slice-4-plan.md, Part 8). Adding one by hand lands here.
  const askForSummary =
    relationship.messageCount > 0 &&
    !summaries.approved &&
    !summaries.pending &&
    addedWithinDays(contact.created_at, ASK_FOR_SUMMARY_DAYS);

  const suggestion = [summaries.approved, summaries.pending].find((s) => s && s.id === suggestionFrom);
  const touchPrefill = suggestion?.suggested_touch_reason
    ? {
        due_on: suggestion.suggested_touch_on ?? "",
        reason: suggestion.suggested_touch_reason,
        rough: suggestion.suggested_touch_rough,
        kind: suggestion.suggested_touch_kind,
      }
    : null;
  // What you said about this contact beats what the app worked out, and the
  // pill says which it is (slice 6c).
  const standing = standingOf(
    {
      turn: relationship.turn,
      settledAt: relationship.settledAt,
      plannedOn: nextTouch?.due_on ?? null,
      neverChase: relationship.neverChase,
    },
    todayIn(),
  );
  const pill = standingPill(standing);
  const openThreadId = relationship.turn.kind === "none" ? null : relationship.turn.threadId;

  // Whether a draft can be written at all. The panel below works this out
  // for its own disabled state and its "why not" line; the header button is
  // absent instead, so the same four facts decide both.
  const canDraftNow =
    budget.ready &&
    canDraft(gmailScopes) &&
    relationship.messageCount > 0 &&
    roomFor(budget, budget.drafts);

  const name = displayName({ ...contact, primary_email: emails[0] ?? null });
  // Slice 9b, Part 5: "Jönsson Linda", or no name at all and an address that
  // has one in it. Suggested, never applied (plan.md §5.2).
  const nameSuggestion = suggestName({ ...contact, primary_email: emails[0] ?? null });
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
<SignOutButton />
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

            {nameSuggestion && (
              <NameSuggestionRow contactId={contact.id} suggestion={nameSuggestion} shownAs={name} />
            )}

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
                // Slice 9b, Part 6: the same chips filter the list when you
                // press them there, and did nothing here. Now they do the same
                // thing in both places.
                <ul className="flex flex-wrap gap-[5px]" aria-label="Tags">
                  {(contact.tags as string[]).map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/contacts?tag=${encodeURIComponent(tag)}`}
                        className="block rounded-full bg-chip px-2.5 py-[3px] text-[11px] font-semibold text-ink-soft transition-colors hover:bg-chip-track hover:text-ink"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Slice 9b, Part 2: the design's own header, which is three
              things -- the standing pill, the "..." menu and Draft reply. It
              had grown to seven controls, and `shrink-0` on this row meant
              the flex-wrap never wrapped: 872px of page at a 390px width. */}
          <div className="flex flex-wrap items-center gap-[9px] pt-1">
            {pill && <TurnPillBadge pill={pill} />}
            <ContactMenu
              contactId={contact.id}
              name={name}
              threadId={openThreadId}
              settled={standing.kind === "settled"}
              neverChase={relationship.neverChase}
              canDelete={emails.length > 0}
            />
            {canDraftNow && <HeaderDraftButton contactId={contact.id} hasDraft={draft !== null} />}
          </div>
        </div>

        <StatStrip relationship={relationship} hasEmails={emails.length > 0} />

        {/* Slice 9b, Part 4: the messages themselves. The rows are stored
            metadata, so they are on screen with the rest of the page; the card
            asks Gmail for the first lines itself, once it is on screen. */}
        {thread && thread.messages.length > 0 && (
          <ConversationCard
            entries={conversation(thread.messages)}
            threadId={thread.id}
            total={relationship.messageCount}
            gmailLink={gmailLink}
          />
        )}

        <DraftCard
          // A new key when the draft changes, so the panel's text box starts
          // from the new draft instead of keeping the state it had before
          // (a draft generated on this page left the box empty otherwise).
          key={draft?.id ?? "no-draft"}
          contactId={contact.id}
          draft={draft}
          lastSaved={savedDraft}
          neverWrite={profile.never_write}
          gmailDraftsUrl={gmailDraftsUrl(gmailResult.data?.email ?? null)}
          canDraft={canDraft(gmailScopes)}
          hasMail={relationship.messageCount > 0}
          budgetLeft={roomFor(budget, budget.drafts)}
          drafts={budget.drafts}
          aiReady={budget.ready}
        />

        <SummaryCard
          contactId={contact.id}
          approved={summaries.approved}
          pending={summaries.pending}
          hasMail={relationship.messageCount > 0}
          budget={budget}
          gmailEmail={gmailResult.data?.email ?? null}
          contact={{
            id: contact.id,
            company: contact.company,
            role: contact.role,
            hasNextTouch: nextTouch !== null,
            plannedTouch: nextTouch ? { due_on: nextTouch.due_on, reason: nextTouch.reason } : null,
          }}
          askNow={askForSummary}
          referrals={referrals}
        />

        {research && (
          <ResearchCard contactId={contact.id} pending={research.pending} kept={research.kept} typicalUsd={researchUsd} />
        )}

        <div className="flex flex-col gap-[18px] lg:flex-row">
          <section className={`${CARD} flex min-w-0 flex-1 flex-col gap-[11px] px-[22px] py-[18px]`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">Your notes</h2>
              {/* Slice 9b, Part 6: this is the CONTACT's updated_at, not the
                  note's, and it sat above "No notes yet." saying "Edited 17
                  September" -- edited what? There is no timestamp on the note
                  itself, so it is only shown when there is a note to have
                  edited, and it says which record it is about. */}
              {contact.notes && (
                <span className="text-[11.5px] font-semibold text-ink-faint">
                  Contact {edited ? "edited" : "added"} {dayMonth(contact.updated_at)}
                </span>
              )}
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
            <NextTouchCard
              // A new key when a suggestion arrives, so the form opens fresh with it.
              key={touchPrefill ? `prefill:${suggestion!.id}` : "touch"}
              contactId={contact.id}
              touch={nextTouch}
              today={todayIn()}
              prefill={touchPrefill}
            />

            {/* Slice 10: "book time with Karin", where the rest of this
                person's future already is. Not in the header, which Part 2 of
                slice 9b just cut down to three controls -- and a next touch
                and a meeting are the same question asked two ways. A next
                touch is a day inside this app; this one is in your calendar,
                with no guests. */}
            <CreateEvent
              today={todayIn()}
              canCreate={canWriteCalendar(calendar?.scopes ?? [])}
              suggestedTitle={hasName ? `Time with ${name}` : "Time with a contact"}
              label={hasName ? `Book time with ${contact.first_name?.trim() || name}` : "Book time"}
            />

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

/** Whether a contact was added within the last `days` days. */
function addedWithinDays(createdAt: string, days: number, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() < days * 24 * 60 * 60 * 1000;
}

/** Whether the server has what the AI needs. The key itself never leaves the server. */
function aiIsReady(): boolean {
  try {
    aiConfig();
    return true;
  } catch (error) {
    if (error instanceof AiNotConfigured) return false;
    throw error;
  }
}

type Thread = {
  id: string;
  subject: string | null;
  messageCount: number;
  lastFrom: "you" | "them";
  lastAt: string;
  /** Its messages, metadata only -- what "Every touch" is built from (Part 4). */
  messages: StoredMessage[];
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
    .select("gmail_message_id, direction, internal_date, subject, from_name, from_email")
    .eq("user_id", userId)
    .eq("thread_id", latest.last_thread_id)
    .order("internal_date", { ascending: false })
    .returns<StoredMessage[]>();
  if (messagesError) throw supabaseError(messagesError, "Couldn't load the latest thread");
  if (messages.length === 0) return null;

  return {
    id: latest.last_thread_id,
    subject: latest.last_subject,
    messageCount: messages.length,
    lastFrom: messages[0].direction === "outbound" ? "you" : "them",
    lastAt: messages[0].internal_date,
    messages,
  };
}

const PILL: Record<TurnPill["tone"], { box: string; dot: string }> = {
  yours: { box: "bg-accent-tint text-accent", dot: "bg-accent" },
  quiet: { box: "bg-chip text-cooling", dot: "bg-cooling" },
  theirs: { box: "bg-chip text-ink-soft", dot: "bg-ink-faint" },
  closed: { box: "bg-chip text-ink-muted", dot: "bg-ink-ghost" },
  // Slice 6c: a day you chose, and the two things you can say about a contact.
  planned: { box: "bg-info-tint text-info-ink", dot: "bg-info" },
  said: { box: "bg-chip text-ink-muted", dot: "bg-ink-faint" },
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

  const { replyRate, replySpeed, lastContact, exchanges, meetings } = warmth.signals;

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
        {/* Slice 8a. Only shown once there is a meeting to report: with no
            calendar connected an empty tile would say "nothing here" in the
            least useful way possible. */}
        {meetings.count > 0 && meetings.lastAt && (
          <Stat
            label="Met"
            value={lastContactText(wholeDaysBetween(meetings.lastAt, new Date()))}
            caption={
              meetings.count === 1
                ? "once, from your calendar"
                : `${meetings.count} times, from your calendar`
            }
          />
        )}
      </div>
      <p className="pl-0.5 text-[11.5px] font-medium text-ink-faint">
        The {warmth.score} is these numbers and nothing else &mdash; no AI opinion about how the
        relationship is going.
        {meetings.count > 0 && " A meeting counts as contact, and as two exchanges."}
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
