"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import {
  addProposedContact,
  runProposedScan,
  saveProposedEdit,
  writeProposedDraft,
  writeProposedSummary,
} from "@/app/assistant/actions";
import { createCalendarEvent } from "@/app/connect/calendar-actions";
import { acceptSuggestedName, setContactName } from "@/app/contacts/[id]/actions";
import { discardDraftAction, saveDraftAction } from "@/app/contacts/[id]/draft-actions";
import { approveSummaryAction, discardSummaryAction } from "@/app/contacts/[id]/summary-actions";
import { Parts } from "@/app/contacts/[id]/summary-card";
import { PromiseCard } from "@/app/assistant/promises/promise-card";
import { addAsContacts, dismissPeople } from "@/app/seen-once/actions";
import { SyncButton } from "@/app/sync-button";
import { researchAction } from "@/app/contacts/[id]/research-actions";
import type { PendingPromise } from "@/lib/ai/promise-list";
import { dayMonth, timeAgo } from "@/lib/format";
import { priceInWords } from "@/lib/assistant/price";
import type { NameGuess, Proposal, SeenOncePerson } from "@/lib/assistant/tools";
import { DURATIONS } from "@/lib/calendar/new-event";
import { FIELD_LABELS, type FieldChange, type NewContact } from "@/lib/contacts/edit-fields";

/**
 * The "Needs you" cards (slice 11, commit 6), from the approved design's
 * "Assistant — asking permission" artboard: a bordered card, a title, the
 * orange "Needs you" pill, what would happen, and the buttons that make it
 * happen. The Assistant proposed it; nothing has happened until you press.
 *
 * Each press goes through the same Server Action the rest of the app uses —
 * a draft through generateDraft and then "Save to Gmail" exactly as on a
 * contact's page, an event through createCalendarEvent exactly as on the
 * Calendar page. So everything those promise holds here too: a draft only
 * ever becomes a Gmail DRAFT, and an event never has guests.
 *
 * `onSettled` tells the conversation what you decided, in a sentence, so the
 * Assistant knows next turn without being told again.
 *
 * Differences from the design, each for an honest reason:
 *   - the draft card has a "Write it" step first. In the design the reply is
 *     already written; here writing it costs money, so it waits for a press.
 *   - no "To karin@…" line: the address is taken from the thread again when
 *     you press "Save to Gmail" (lib/ai/draft-save.ts), so one shown now
 *     could be out of date by then.
 *   - the summary, promise-scan, better-names and contact cards have no
 *     design; they reuse this one.
 */

type Settle = (note: string) => void;

export function NeedsYouCard({ proposal, onSettled }: { proposal: Proposal; onSettled: Settle }) {
  switch (proposal.kind) {
    case "draft":
      return <DraftCard proposal={proposal} onSettled={onSettled} />;
    case "event":
      return <EventCard proposal={proposal} onSettled={onSettled} />;
    case "summary":
      return <SummaryCard proposal={proposal} onSettled={onSettled} />;
    case "promise_scan":
      return <ScanCard proposal={proposal} onSettled={onSettled} />;
    case "names":
      return <NamesCard names={proposal.names} onSettled={onSettled} />;
    case "contact_edit":
      return <EditCard proposal={proposal} onSettled={onSettled} />;
    case "new_contact":
      return <NewContactCard values={proposal.values} onSettled={onSettled} />;
    case "summary_review":
      return <SummaryReviewCard proposal={proposal} onSettled={onSettled} />;
    case "promises":
      return <PromisesCard promises={proposal.promises} onSettled={onSettled} />;
    case "seen_once":
      return <SeenOnceCard people={proposal.people} onSettled={onSettled} />;
    case "sync":
      return <SyncCard lastSyncedAt={proposal.lastSyncedAt} onSettled={onSettled} />;
    case "research":
      return <ResearchOfferCard proposal={proposal} onSettled={onSettled} />;
  }
}

// ── A draft ────────────────────────────────────────────────────────────────

type DraftStage =
  | { at: "offer" }
  | { at: "written"; id: string; subject: string | null; body: string; costUsd: number | null }
  | { at: "saved"; costUsd: number | null }
  | { at: "gone"; words: string };

function DraftCard({ proposal, onSettled }: { proposal: Extract<Proposal, { kind: "draft" }>; onSettled: Settle }) {
  const [stage, setStage] = useState<DraftStage>({ at: "offer" });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = proposal.name.split(" ")[0];

  function write() {
    setError(null);
    start(async () => {
      const result = await writeProposedDraft(proposal.contactId, proposal.tone);
      if (!result.ok) return setError(result.error);
      setStage({ at: "written", ...result.draft, costUsd: result.costUsd });
    });
  }

  function save(body: string, costUsd: number | null, id: string) {
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("body", body);
      const result = await saveDraftAction(id, null, form);
      if (result?.error) return setError(result.error);
      setStage({ at: "saved", costUsd });
      onSettled(`The person saved the reply to ${proposal.name} to their Gmail drafts. It is not sent.`);
    });
  }

  function discard(id: string) {
    setError(null);
    start(async () => {
      await discardDraftAction(id);
      setStage({ at: "gone", words: "Discarded. Nothing reached Gmail." });
      onSettled(`The person discarded the reply to ${proposal.name}.`);
    });
  }

  function decline() {
    setStage({ at: "gone", words: "Not written." });
    onSettled(`The person said no to a reply to ${proposal.name}.`);
  }

  return (
    <Card
      title={`A reply to ${first}`}
      state={stage.at === "saved" ? "done" : stage.at === "gone" ? "no" : "needs"}
      small="It lands as a draft in Gmail. You press send there — this app has no send button."
      error={error}
    >
      {stage.at === "offer" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">
            Written from your latest thread with {proposal.name} when you press it
            {proposal.tone ? `, in a ${proposal.tone} tone` : ""}. {costLine(proposal.typicalUsd)}
          </p>
          <Buttons>
            <Primary onClick={write} disabled={pending}>{pending ? "Writing…" : "Write it"}</Primary>
            <Quiet onClick={decline} disabled={pending}>No</Quiet>
          </Buttons>
        </>
      )}

      {stage.at === "written" && (
        <>
          <Inset>
            {stage.subject && <span className="text-[13px] font-semibold">{stage.subject}</span>}
            {editing ? (
              <textarea
                aria-label={`Your reply to ${proposal.name}`}
                value={stage.body}
                onChange={(event) => setStage({ ...stage, body: event.target.value })}
                rows={8}
                className="w-full resize-y rounded-[10px] border border-line-strong bg-white px-3 py-2 text-[12.5px] leading-[1.55] text-ink"
              />
            ) : (
              <p className="line-clamp-6 text-[12.5px] leading-[1.55] whitespace-pre-wrap text-ink-body">{stage.body}</p>
            )}
          </Inset>
          <Buttons>
            <Primary onClick={() => save(stage.body, stage.costUsd, stage.id)} disabled={pending || !stage.body.trim()}>
              {pending ? "Saving…" : "Save to Gmail"}
            </Primary>
            {!editing && (
              <Secondary onClick={() => setEditing(true)} disabled={pending}>Edit it first</Secondary>
            )}
            <Quiet onClick={() => discard(stage.id)} disabled={pending}>Discard</Quiet>
          </Buttons>
          <Cost usd={stage.costUsd} what="Writing it" />
        </>
      )}

      {stage.at === "saved" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">
            In your Gmail drafts. Read it there once more, and send it when you&rsquo;re ready.
          </p>
          <Cost usd={stage.costUsd} what="Writing it" />
        </>
      )}

      {stage.at === "gone" && <p className="text-[12.5px] leading-[1.5] text-ink-soft">{stage.words}</p>}
    </Card>
  );
}

// ── An event ───────────────────────────────────────────────────────────────

type EventStage = { at: "offer" } | { at: "created"; link: string | null } | { at: "gone" };

function EventCard({ proposal, onSettled }: { proposal: Extract<Proposal, { kind: "event" }>; onSettled: Settle }) {
  const [stage, setStage] = useState<EventStage>({ at: "offer" });
  const [changing, setChanging] = useState(false);
  const [date, setDate] = useState(proposal.date);
  const [time, setTime] = useState(proposal.time);
  const [minutes, setMinutes] = useState(proposal.minutes);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // What is shown is what is created: the name goes into the title, as on the card.
  const title = proposal.name ? `${proposal.title} — ${proposal.name}` : proposal.title;

  function create() {
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("title", title);
      form.set("date", date);
      form.set("time", time);
      form.set("minutes", String(minutes));
      const result = await createCalendarEvent(null, form);
      if (!result) return;
      if (!result.ok) return setError(result.message ?? Object.values(result.errors).join(" "));
      setStage({ at: "created", link: result.htmlLink });
      onSettled(`The person created "${title}" in their calendar, ${date} at ${time}, without guests.`);
    });
  }

  function decline() {
    setStage({ at: "gone" });
    onSettled(`The person said no to the event "${title}".`);
  }

  return (
    <Card
      title="Put it in your calendar"
      state={stage.at === "created" ? "done" : stage.at === "gone" ? "no" : "needs"}
      small={`Never with guests: Google would email an invitation.${proposal.name ? ` Add ${proposal.name.split(" ")[0]} in Google Calendar yourself.` : ""}`}
      error={error}
    >
      <Inset row>
        <DateTile date={date} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="text-[12.5px] text-ink-body">{when(date, time, minutes)} · your own calendar</span>
          <span className="text-[12px] text-ink-soft">No guests</span>
        </div>
      </Inset>

      {stage.at === "offer" && changing && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Day">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={INPUT} />
          </Field>
          <Field label="Starts">
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={INPUT} />
          </Field>
          <Field label="Length">
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className={INPUT}>
              {DURATIONS.map((length) => (
                <option key={length} value={length}>
                  {length < 60 ? `${length} min` : `${length / 60} h`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {stage.at === "offer" && (
        <Buttons>
          <Primary onClick={create} disabled={pending}>{pending ? "Creating…" : "Create event"}</Primary>
          {!changing && (
            <Secondary onClick={() => setChanging(true)} disabled={pending}>Change the time</Secondary>
          )}
          <Quiet onClick={decline} disabled={pending}>No</Quiet>
        </Buttons>
      )}

      {stage.at === "created" &&
        (stage.link ? (
          <a href={stage.link} target="_blank" rel="noreferrer" className="self-start text-[12.5px] font-semibold text-info-ink">
            Open it in Google Calendar
          </a>
        ) : (
          <p className="text-[12.5px] text-ink-body">In your Google Calendar.</p>
        ))}
      {stage.at === "gone" && <p className="text-[12.5px] text-ink-soft">Not created.</p>}
    </Card>
  );
}

// ── A summary ──────────────────────────────────────────────────────────────

function SummaryCard({ proposal, onSettled }: { proposal: Extract<Proposal, { kind: "summary" }>; onSettled: Settle }) {
  const [stage, setStage] = useState<{ at: "offer" } | { at: "written"; costUsd: number | null } | { at: "gone" }>({
    at: "offer",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function write() {
    setError(null);
    start(async () => {
      const result = await writeProposedSummary(proposal.contactId);
      if (result.error) return setError(result.error);
      setStage({ at: "written", costUsd: result.costUsd });
      onSettled(`The person had a summary of ${proposal.name} written. It waits on their page to be approved.`);
    });
  }

  return (
    <Card
      title={`A summary of ${proposal.name.split(" ")[0]}`}
      state={stage.at === "written" ? "done" : stage.at === "gone" ? "no" : "needs"}
      small="Nothing about them changes until you approve it on their page."
      error={error}
    >
      {stage.at === "offer" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">
            Written from your mail with {proposal.name}, each line linked to the message it came from.{" "}
            {costLine(proposal.typicalUsd)}
          </p>
          <Buttons>
            <Primary onClick={write} disabled={pending}>{pending ? "Writing…" : "Write it"}</Primary>
            <Quiet
              onClick={() => {
                setStage({ at: "gone" });
                onSettled(`The person said no to a summary of ${proposal.name}.`);
              }}
              disabled={pending}
            >
              No
            </Quiet>
          </Buttons>
        </>
      )}
      {stage.at === "written" && (
        <>
          <Link href={`/contacts/${proposal.contactId}`} className="self-start text-[12.5px] font-semibold text-info-ink">
            Check it on {proposal.name.split(" ")[0]}&rsquo;s page
          </Link>
          <Cost usd={stage.costUsd} what="Writing it" />
        </>
      )}
      {stage.at === "gone" && <p className="text-[12.5px] text-ink-soft">Not written.</p>}
    </Card>
  );
}

// ── A promise scan ─────────────────────────────────────────────────────────

function ScanCard({ proposal, onSettled }: { proposal: Extract<Proposal, { kind: "promise_scan" }>; onSettled: Settle }) {
  const [stage, setStage] = useState<
    { at: "offer" } | { at: "read"; message: string; costUsd: number | null } | { at: "gone" }
  >({ at: "offer" });
  const [pending, start] = useTransition();

  function scan() {
    start(async () => {
      const { scan: result, costUsd } = await runProposedScan();
      const message = result?.message ?? "Done.";
      setStage({ at: "read", message, costUsd });
      onSettled(`The person ran a promise scan: ${message}`);
    });
  }

  return (
    <Card
      title="Look for promises in your mail"
      state={stage.at === "read" ? "done" : stage.at === "gone" ? "no" : "needs"}
      small="What it finds waits for you to accept or dismiss. Nothing goes on a contact by itself."
      error={null}
    >
      {stage.at === "offer" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">
            Reads recent mail for things you or they said would happen.{" "}
            {`It costs ${priceInWords(proposal.typicalUsd)} for each contact it reads, from your AI budget.`}
          </p>
          <Buttons>
            <Primary onClick={scan} disabled={pending}>{pending ? "Reading…" : "Read my mail"}</Primary>
            <Quiet
              onClick={() => {
                setStage({ at: "gone" });
                onSettled("The person said no to a promise scan.");
              }}
              disabled={pending}
            >
              No
            </Quiet>
          </Buttons>
        </>
      )}
      {stage.at === "read" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">{stage.message}</p>
          <Link href="/assistant/promises" className="self-start text-[12.5px] font-semibold text-info-ink">
            Decide on them
          </Link>
          <Cost usd={stage.costUsd} what="Reading" />
        </>
      )}
      {stage.at === "gone" && <p className="text-[12.5px] text-ink-soft">Not read.</p>}
    </Card>
  );
}

// ── Better names ───────────────────────────────────────────────────────────

type NameRow = NameGuess & {
  state: "offered" | "renamed";
  /** What they were called, for Undo — given back by acceptSuggestedName. */
  from: { first: string; last: string } | null;
  problem: string | null;
};

/**
 * The name rules' guesses, each with Accept, and Accept all. Every press goes
 * through acceptSuggestedName, the contact page's own action, which works the
 * suggestion out again from the contact as it is now and writes only that —
 * so nothing on this card, and nothing the model said, decides a name.
 */
function NamesCard({ names, onSettled }: { names: NameGuess[]; onSettled: Settle }) {
  const [rows, setRows] = useState<NameRow[]>(() =>
    names.map((guess) => ({ ...guess, state: "offered", from: null, problem: null })),
  );
  const [declined, setDeclined] = useState(false);
  const [pending, start] = useTransition();
  const offered = rows.filter((row) => row.state === "offered");

  const update = (id: string, change: Partial<NameRow>) =>
    setRows((list) => list.map((row) => (row.contactId === id ? { ...row, ...change } : row)));

  async function acceptOne(row: NameRow): Promise<boolean> {
    const answer = await acceptSuggestedName(row.contactId);
    if ("error" in answer) {
      update(row.contactId, { problem: answer.error });
      return false;
    }
    update(row.contactId, { state: "renamed", from: answer.from, problem: null });
    return true;
  }

  function accept(row: NameRow) {
    start(async () => {
      if (await acceptOne(row)) onSettled(`The person renamed ${row.now} to ${row.suggested}.`);
    });
  }

  function acceptAll() {
    start(async () => {
      let renamed = 0;
      // One at a time: each is the contact page's action, checked on its own.
      for (const row of offered) if (await acceptOne(row)) renamed += 1;
      onSettled(`The person accepted ${renamed} of the suggested names.`);
    });
  }

  function undo(row: NameRow) {
    if (!row.from) return;
    const from = row.from;
    start(async () => {
      const back = await setContactName(row.contactId, from.first, from.last);
      if (back?.error) return update(row.contactId, { problem: back.error });
      update(row.contactId, { state: "offered", from: null, problem: null });
      onSettled(`The person put ${row.suggested}'s old name back.`);
    });
  }

  const done = declined || offered.length === 0;

  return (
    <Card
      title={names.length === 1 ? "A better name" : "Better names"}
      state={declined ? "no" : done ? "done" : "needs"}
      small="Worked out from each address by the app's own rules, not by the AI. Nothing is renamed until you press."
      error={null}
    >
      <ul className="flex max-h-[360px] flex-col overflow-y-auto rounded-[12px] bg-paper">
        {rows.map((row) => (
          <li
            key={row.contactId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white px-[13px] py-2.5 first:border-t-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px]">
                <span className={row.state === "renamed" ? "text-ink-faint line-through" : "text-ink-body"}>
                  {row.now}
                </span>
                <span aria-hidden="true" className="px-1.5 text-ink-faint">→</span>
                <span className="sr-only"> to </span>
                <strong className="font-semibold">{row.suggested}</strong>
              </span>
              <span className="text-[11.5px] text-ink-soft">{row.why}</span>
              {row.problem && <span className="text-[11.5px] font-medium text-accent">{row.problem}</span>}
            </div>
            {row.state === "renamed" ? (
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[12px] font-semibold text-affirm">Renamed</span>
                <Quiet onClick={() => undo(row)} disabled={pending}>Undo</Quiet>
              </span>
            ) : (
              !declined && (
                <Secondary onClick={() => accept(row)} disabled={pending}>Accept</Secondary>
              )
            )}
          </li>
        ))}
      </ul>
      {!done && (
        <Buttons>
          <Primary onClick={acceptAll} disabled={pending}>
            {pending ? "Renaming…" : offered.length === 1 ? "Accept it" : `Accept all ${offered.length}`}
          </Primary>
          <Quiet
            onClick={() => {
              setDeclined(true);
              onSettled("The person said no to the suggested names for now.");
            }}
            disabled={pending}
          >
            No
          </Quiet>
        </Buttons>
      )}
      {declined && <p className="text-[12.5px] text-ink-soft">Not renamed. The guesses stay on each contact&rsquo;s page.</p>}
    </Card>
  );
}

// ── A contact's details ────────────────────────────────────────────────────

/**
 * Each field before and after, and Save. The press sends only these fields,
 * and the server refuses any whose value has changed since this was drawn.
 * Undo is the same press the other way round.
 */
function EditCard({
  proposal,
  onSettled,
}: {
  proposal: Extract<Proposal, { kind: "contact_edit" }>;
  onSettled: Settle;
}) {
  const [stage, setStage] = useState<"offer" | "saved" | "undone" | "no">("offer");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const swapped: FieldChange[] = proposal.changes.map((change) => ({
    ...change,
    before: change.after,
    after: change.before,
  }));
  const what = proposal.changes.map((change) => FIELD_LABELS[change.field].toLowerCase()).join(", ");

  function press(changes: FieldChange[], next: "saved" | "undone", note: string) {
    setError(null);
    start(async () => {
      const result = await saveProposedEdit(proposal.contactId, changes);
      if (!result.ok) return setError(result.error);
      setStage(next);
      onSettled(note);
    });
  }

  return (
    <Card
      title={`${proposal.name}’s details`}
      state={stage === "saved" ? "done" : stage === "offer" ? "needs" : "no"}
      small="Only what you see here changes. Addresses, notes and tags are changed on their page."
      error={error}
    >
      <Inset>
        {proposal.changes.map((change) => (
          <div key={change.field} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="w-full shrink-0 text-[12px] font-semibold text-ink-soft sm:w-[130px]">
              {FIELD_LABELS[change.field]}
            </span>
            <span className={stage === "saved" ? "text-ink-faint line-through" : "text-ink-body"}>
              {change.before ?? <em className="text-ink-faint">empty</em>}
            </span>
            <span aria-hidden="true" className="text-ink-faint">→</span>
            <span className="sr-only"> to </span>
            <strong className="font-semibold">
              {change.after ?? <em className="font-normal text-ink-faint">empty</em>}
            </strong>
          </div>
        ))}
      </Inset>
      {stage === "offer" && (
        <Buttons>
          <Primary
            onClick={() => press(proposal.changes, "saved", `The person saved ${proposal.name}'s new ${what}.`)}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save"}
          </Primary>
          <Quiet
            onClick={() => {
              setStage("no");
              onSettled(`The person said no to changing ${proposal.name}'s ${what}.`);
            }}
            disabled={pending}
          >
            No
          </Quiet>
        </Buttons>
      )}
      {stage === "saved" && (
        <Buttons>
          <Link href={`/contacts/${proposal.contactId}`} className="text-[12.5px] font-semibold text-info-ink">
            Open {proposal.name}
          </Link>
          <Quiet
            onClick={() => press(swapped, "undone", `The person put ${proposal.name}'s old ${what} back.`)}
            disabled={pending}
          >
            {pending ? "Undoing…" : "Undo"}
          </Quiet>
        </Buttons>
      )}
      {stage === "undone" && <p className="text-[12.5px] text-ink-soft">Put back as it was.</p>}
      {stage === "no" && <p className="text-[12.5px] text-ink-soft">Not changed.</p>}
    </Card>
  );
}

/** A new contact, as the Add contact form would make it, without leaving the chat. */
function NewContactCard({ values, onSettled }: { values: NewContact; onSettled: Settle }) {
  const [stage, setStage] = useState<{ at: "offer" } | { at: "added"; id: string } | { at: "no" }>({ at: "offer" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fullName = [values.first_name, values.last_name].filter(Boolean).join(" ");
  const name = fullName || values.email || "them";
  const rows: [string, string | null][] = [
    ["Name", fullName || null],
    ["Email", values.email],
    ["Company", values.company],
    ["Role", values.role],
  ];

  function add() {
    setError(null);
    start(async () => {
      const result = await addProposedContact(values);
      if (!result.ok) return setError(result.error);
      setStage({ at: "added", id: result.id });
      onSettled(`The person added ${name} as a contact.`);
    });
  }

  return (
    <Card
      title="Add a contact"
      state={stage.at === "added" ? "done" : stage.at === "no" ? "no" : "needs"}
      small="The same as the Add contact form. Their mail is matched to them from the next sync."
      error={error}
    >
      <Inset>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="w-full shrink-0 text-[12px] font-semibold text-ink-soft sm:w-[130px]">{label}</span>
              <span className="min-w-0 font-medium break-words">{value}</span>
            </div>
          ))}
      </Inset>
      {stage.at === "offer" && (
        <Buttons>
          <Primary onClick={add} disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Primary>
          <Quiet
            onClick={() => {
              setStage({ at: "no" });
              onSettled(`The person said no to adding ${name}.`);
            }}
            disabled={pending}
          >
            No
          </Quiet>
        </Buttons>
      )}
      {stage.at === "added" && (
        <Link href={`/contacts/${stage.id}`} className="self-start text-[12.5px] font-semibold text-info-ink">
          Open {name}
        </Link>
      )}
      {stage.at === "no" && <p className="text-[12.5px] text-ink-soft">Not added.</p>}
    </Card>
  );
}

// ── A waiting summary ──────────────────────────────────────────────────────

/**
 * The summary as the contact page shows it — its own Parts component, so the
 * same four parts, the same "email 1, email 2" links to the messages — dated,
 * with Approve and Discard pressing the contact page's own actions. Editing
 * and the summary's suggestions for the contact stay on that page, where the
 * contact is.
 */
function SummaryReviewCard({
  proposal,
  onSettled,
}: {
  proposal: Extract<Proposal, { kind: "summary_review" }>;
  onSettled: Settle;
}) {
  const [stage, setStage] = useState<"offer" | "approved" | "discarded">("offer");
  const [pending, start] = useTransition();
  const { summary, name } = proposal;
  const asOf = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Stockholm" }).format(
    new Date(summary.as_of),
  );

  function decide(next: "approved" | "discarded") {
    start(async () => {
      await (next === "approved" ? approveSummaryAction(summary.id) : discardSummaryAction(summary.id));
      setStage(next);
      onSettled(`The person ${next} the summary of ${name}.`);
    });
  }

  return (
    <Card
      title={`A summary of ${name}`}
      state={stage === "approved" ? "done" : stage === "discarded" ? "no" : "needs"}
      small="Check it against the emails before you approve it — the AI can be wrong about people. Its suggestions for the contact are on their page."
      error={null}
    >
      <span className="text-[11.5px] font-medium text-ink-faint">
        As of {asOf} · written by the AI, {stage === "approved" ? "approved by you" : "not approved yet"}
      </span>
      {stage !== "discarded" && (
        <div className="rounded-[12px] bg-paper px-[13px] py-[11px]">
          <Parts summary={summary} gmailEmail={proposal.gmailEmail} />
        </div>
      )}
      {stage === "offer" && (
        <Buttons>
          <Primary onClick={() => decide("approved")} disabled={pending}>
            {pending ? "Saving…" : "Approve"}
          </Primary>
          <Quiet onClick={() => decide("discarded")} disabled={pending}>
            Discard
          </Quiet>
          <Link href={`/contacts/${summary.contact_id}`} className="text-[12.5px] font-semibold text-info-ink">
            Edit it on their page
          </Link>
        </Buttons>
      )}
      {stage === "approved" && (
        <Link href={`/contacts/${summary.contact_id}`} className="self-start text-[12.5px] font-semibold text-info-ink">
          Open {name}
        </Link>
      )}
      {stage === "discarded" && <p className="text-[12.5px] text-ink-soft">Discarded. Nothing was saved to them.</p>}
    </Card>
  );
}

// ── Promises ───────────────────────────────────────────────────────────────

/**
 * The Promises queue's own rows (app/assistant/promises/promise-card.tsx):
 * each with the words of the message it came from, the date you can change,
 * and the queue's own Accept and "Not a promise". A decided row is replaced
 * by what happened, since nothing reloads this card.
 */
function PromisesCard({ promises, onSettled }: { promises: PendingPromise[]; onSettled: Settle }) {
  const [decided, setDecided] = useState<Record<string, string>>({});
  const left = promises.filter((promise) => !decided[promise.id]).length;

  function decide(promise: PendingPromise, decision: "accepted" | "dismissed", dueOn: string) {
    const words =
      decision === "accepted" ? `Next touch with ${promise.name} on ${dayMonth(dueOn)}.` : "Not a promise. Dismissed.";
    setDecided((all) => ({ ...all, [promise.id]: words }));
    onSettled(
      decision === "accepted"
        ? `The person accepted the promise with ${promise.name}; a next touch is set for ${dueOn}.`
        : `The person dismissed the promise with ${promise.name}.`,
    );
  }

  return (
    <Card
      title={promises.length === 1 ? "A promise to decide" : `${promises.length} promises to decide`}
      state={left === 0 ? "done" : "needs"}
      small="Read the message before you accept — the line above it is the AI's, and a “not” turns a promise into its opposite."
      error={null}
    >
      <ul className="-mx-4 flex flex-col border-y border-line-soft">
        {promises.map((promise) =>
          decided[promise.id] ? (
            <li
              key={promise.id}
              className="flex items-center gap-2 border-t border-line-soft px-[22px] py-3 text-[12.5px] first:border-t-0"
            >
              <strong className="font-semibold">{promise.name}</strong>
              <span className="text-ink-soft">{decided[promise.id]}</span>
            </li>
          ) : (
            <PromiseCard
              key={promise.id}
              promise={promise}
              onDecided={(decision, dueOn) => decide(promise, decision, dueOn)}
            />
          ),
        )}
      </ul>
    </Card>
  );
}

// ── Seen once ──────────────────────────────────────────────────────────────

/**
 * People from the Seen once queue, each with the queue's own two buttons —
 * addAsContacts and dismissPeople, the same Server Actions, which only act on
 * addresses really in your queue (migration 0007) — and both for everyone
 * still on the card. Names and subjects are shown as data: they are from mail
 * headers, written by whoever sent the mail.
 */
function SeenOnceCard({ people, onSettled }: { people: SeenOncePerson[]; onSettled: Settle }) {
  const [decided, setDecided] = useState<Record<string, "added" | "dismissed">>({});
  const [pending, start] = useTransition();
  const left = people.filter((person) => !decided[person.email]);

  function act(which: SeenOncePerson[], decision: "added" | "dismissed") {
    start(async () => {
      const form = new FormData();
      for (const person of which) form.append("email", person.email);
      await (decision === "added" ? addAsContacts(null, form) : dismissPeople(null, form));
      setDecided((all) => ({ ...all, ...Object.fromEntries(which.map((person) => [person.email, decision])) }));
      const who = which.length === 1 ? which[0].email : `${which.length} people from Seen once`;
      onSettled(decision === "added" ? `The person added ${who} as contacts.` : `The person dismissed ${who}.`);
    });
  }

  return (
    <Card
      title={people.length === 1 ? "Someone from Seen once" : `${people.length} people from Seen once`}
      state={left.length === 0 ? "done" : "needs"}
      small="Dismiss forgets the mail they sent and skips them from now on. Changed your mind? Undo it on the Dismissed page."
      error={null}
    >
      <ul className="flex max-h-[380px] flex-col overflow-y-auto rounded-[12px] bg-paper">
        {people.map((person) => {
          const done = decided[person.email];
          return (
            <li
              key={person.email}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white px-[13px] py-2.5 first:border-t-0"
            >
              <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold">{person.name ?? person.email}</span>
                <span className="truncate text-[11.5px] text-ink-soft">
                  {person.name ? `${person.email} · ` : ""}
                  {person.fromThem} from them, {person.fromYou} from you
                  {person.subject ? ` · “${person.subject}”` : ""}
                </span>
              </div>
              {done ? (
                <span className={`text-[12px] font-semibold ${done === "added" ? "text-affirm" : "text-ink-soft"}`}>
                  {done === "added" ? "Added as a contact" : "Dismissed"}
                </span>
              ) : (
                <span className="flex shrink-0 gap-1.5">
                  <Secondary onClick={() => act([person], "added")} disabled={pending}>
                    Add
                  </Secondary>
                  <Quiet onClick={() => act([person], "dismissed")} disabled={pending}>
                    Dismiss
                  </Quiet>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {left.length > 1 && (
        <Buttons>
          <Primary onClick={() => act(left, "added")} disabled={pending}>
            {pending ? "Working…" : `Add all ${left.length}`}
          </Primary>
          <Quiet onClick={() => act(left, "dismissed")} disabled={pending}>
            Dismiss all {left.length}
          </Quiet>
        </Buttons>
      )}
      {Object.values(decided).includes("dismissed") && (
        <Link href="/seen-once/dismissed" className="self-start text-[12.5px] font-semibold text-info-ink">
          The Dismissed page
        </Link>
      )}
    </Card>
  );
}

// ── A sync ─────────────────────────────────────────────────────────────────

/**
 * The header's own Sync now button (app/sync-button.tsx), so the sync runs
 * the same way — one step after another, paced to Gmail's quota — with the
 * card told when it has finished.
 */
function SyncCard({ lastSyncedAt, onSettled }: { lastSyncedAt: string | null; onSettled: Settle }) {
  const [done, setDone] = useState(false);

  return (
    <Card
      title="Sync Gmail now"
      state={done ? "done" : "needs"}
      small="It reads who wrote to whom and when, and the subject line — never the words of a message. Keep this tab open until it finishes."
      error={null}
    >
      <p className="text-[12.5px] leading-[1.5] text-ink-body">
        {done
          ? "Synced. The cards above are up to date."
          : lastSyncedAt
            ? `Last synced ${timeAgo(lastSyncedAt)}.`
            : "Gmail has not been synced yet."}
      </p>
      {!done && (
        <div className="self-start">
          <SyncButton
            onCard
            onDone={() => {
              setDone(true);
              onSettled("The person synced Gmail; the page is up to date.");
            }}
          />
        </div>
      )}
    </Card>
  );
}

// ── Web research ───────────────────────────────────────────────────────────

/**
 * "Look Karin up on the web" (slice 12). The press is the contact page's own
 * researchAction -- the same switch, the same checks, the same waiting set --
 * and what it finds waits on her page to be ticked, not here: that is where
 * the facts would go, and where the person already reads about her.
 */
function ResearchOfferCard({
  proposal,
  onSettled,
}: {
  proposal: Extract<Proposal, { kind: "research" }>;
  onSettled: Settle;
}) {
  const [stage, setStage] = useState<
    { at: "offer" } | { at: "found"; count: number } | { at: "nothing"; why: string } | { at: "no" }
  >({ at: "offer" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = proposal.name.split(" ")[0];

  function research() {
    setError(null);
    start(async () => {
      const result = await researchAction(proposal.contactId);
      if (result?.error) return setError(result.error);
      if (result?.nothingFound) {
        setStage({ at: "nothing", why: result.nothingFound });
        onSettled(`The web search about ${proposal.name} found nothing reliable.`);
        return;
      }
      const count = result?.found ?? 0;
      setStage({ at: "found", count });
      onSettled(`The web search about ${proposal.name} found ${count} facts; they wait on the contact's page to be ticked.`);
    });
  }

  return (
    <Card
      title={`Look ${first} up on the web`}
      state={stage.at === "found" || stage.at === "nothing" ? "done" : stage.at === "no" ? "no" : "needs"}
      small="Public web only. LinkedIn, people-search sites and social media are never searched, and nothing is added until you tick it."
      error={error}
    >
      {stage.at === "offer" && (
        <>
          <p className="text-[12.5px] leading-[1.5] text-ink-body">
            Public, professional facts about {proposal.name}, each with the link it came from.{" "}
            {costLine(proposal.typicalUsd)}
          </p>
          <Buttons>
            <Primary onClick={research} disabled={pending}>
              {pending ? "Searching…" : "Research"}
            </Primary>
            <Quiet
              onClick={() => {
                setStage({ at: "no" });
                onSettled(`The person said no to a web search about ${proposal.name}.`);
              }}
              disabled={pending}
            >
              No
            </Quiet>
          </Buttons>
        </>
      )}
      {stage.at === "found" && (
        <Link href={`/contacts/${proposal.contactId}`} className="self-start text-[12.5px] font-semibold text-info-ink">
          {stage.count === 1 ? "1 fact waits" : `${stage.count} facts wait`} on {first}&rsquo;s page — tick what to keep
        </Link>
      )}
      {stage.at === "nothing" && (
        <p className="text-[12.5px] leading-[1.5] text-ink-body">Nothing reliable was found, so nothing was saved. {stage.why}</p>
      )}
      {stage.at === "no" && <p className="text-[12.5px] text-ink-soft">Not searched.</p>}
    </Card>
  );
}

// ── The pieces every card is made of ───────────────────────────────────────

const PILL = {
  needs: { words: "Needs you", className: "bg-accent-tint text-needs-ink" },
  done: { words: "Done", className: "bg-done-tint text-affirm" },
  no: { words: "Not done", className: "bg-chip text-ink-soft" },
} as const;

function Card({
  title,
  state,
  small,
  error,
  children,
}: {
  title: string;
  state: keyof typeof PILL;
  small: string;
  error: string | null;
  children: ReactNode;
}) {
  const pill = PILL[state];
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-line px-4 py-3.5">
      <div className="flex items-center gap-[9px]">
        <h3 className="text-[13.5px] font-bold tracking-[-0.01em]">{title}</h3>
        <span className={`rounded-full px-[9px] py-[3px] text-[11px] font-bold ${pill.className}`}>{pill.words}</span>
      </div>
      {children}
      {error && (
        <p role="alert" className="text-[12px] leading-[1.45] font-medium text-accent">
          {error}
        </p>
      )}
      <p className="text-[11.5px] leading-[1.45] text-ink-soft">{small}</p>
    </div>
  );
}

function Inset({ row = false, children }: { row?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex min-w-0 rounded-[12px] bg-paper px-[13px] py-[11px] ${row ? "items-start gap-3" : "flex-col gap-1.5"}`}
    >
      {children}
    </div>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-[7px]">{children}</div>;
}

type ButtonProps = { onClick: () => void; disabled?: boolean; children: ReactNode };

const BUTTON = "rounded-full px-[15px] py-[9px] text-[12.5px] font-semibold transition disabled:opacity-60";

function Primary({ onClick, disabled, children }: ButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BUTTON} bg-ink-deep text-white hover:bg-ink/85`}>
      {children}
    </button>
  );
}

function Secondary({ onClick, disabled, children }: ButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BUTTON} bg-chip text-ink hover:bg-chip-track`}>
      {children}
    </button>
  );
}

function Quiet({ onClick, disabled, children }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON} border border-line bg-transparent text-ink-body hover:bg-paper`}
    >
      {children}
    </button>
  );
}

const INPUT = "rounded-[10px] border border-line-strong bg-white px-2.5 py-[7px] text-[12.5px]";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-body">
      {label}
      {children}
    </label>
  );
}

/** The blue day tile of the design: "29" over "SEP". */
function DateTile({ date }: { date: string }) {
  const day = new Date(`${date}T12:00:00Z`);
  const valid = !Number.isNaN(day.getTime());
  return (
    <div className="flex w-11 shrink-0 flex-col items-center rounded-[10px] bg-info-tint py-1.5">
      <span className="text-[15px] leading-[1.1] font-bold text-info-ink">{valid ? day.getUTCDate() : "?"}</span>
      <span className="text-[9.5px] font-semibold tracking-[0.05em] text-info-ink uppercase">
        {valid ? day.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) : ""}
      </span>
    </div>
  );
}

/** "Tuesday 14:00–14:30". */
function when(date: string, time: string, minutes: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  const [hours, mins] = time.split(":").map(Number);
  if (Number.isNaN(day.getTime()) || Number.isNaN(hours) || Number.isNaN(mins)) return `${date} ${time}`;
  const end = hours * 60 + mins + minutes;
  const pad = (value: number) => String(value).padStart(2, "0");
  const weekday = day.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${time}–${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

/** Before the press: what it usually costs you, and whose budget pays. */
function costLine(typicalUsd: number | null): string {
  return `It costs ${priceInWords(typicalUsd)}, from your AI budget.`;
}

/** After the press: what it really cost. */
function Cost({ usd, what }: { usd: number | null; what: string }) {
  if (usd === null) return null;
  return (
    <p className="text-[11.5px] text-ink-soft">
      {what} cost ${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}.
    </p>
  );
}
