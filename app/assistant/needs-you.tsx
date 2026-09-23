"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { runProposedScan, writeProposedDraft, writeProposedSummary } from "@/app/assistant/actions";
import { createCalendarEvent } from "@/app/connect/calendar-actions";
import { discardDraftAction, saveDraftAction } from "@/app/contacts/[id]/draft-actions";
import { priceInWords } from "@/lib/assistant/price";
import type { Proposal } from "@/lib/assistant/tools";
import { DURATIONS } from "@/lib/calendar/new-event";

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
 *   - the summary and promise-scan cards have no design; they reuse this one.
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
          <Link href="/promises" className="self-start text-[12.5px] font-semibold text-info-ink">
            Decide on them
          </Link>
          <Cost usd={stage.costUsd} what="Reading" />
        </>
      )}
      {stage.at === "gone" && <p className="text-[12.5px] text-ink-soft">Not read.</p>}
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
