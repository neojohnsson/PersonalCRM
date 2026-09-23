"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoAssistantAction } from "@/app/assistant/actions";
import { Composer } from "@/app/assistant/composer";
import { NeedsYouCard } from "@/app/assistant/needs-you";
import type { ConverseEvent, Said } from "@/lib/assistant/converse";
import type { Proposal } from "@/lib/assistant/tools";

/**
 * The conversation on /assistant (slice 11), from the approved design's
 * "Assistant — asking permission" artboard:
 *
 *   your message         right-aligned, on the chip grey
 *   its answer           left, beside the Assistant's spark
 *   Done, and undoable   a green box: each thing it did on its own, with Undo
 *   Needs you            a bordered card for each thing it wants to do but
 *                        may not — a draft, an event, a summary, a scan
 *
 * **Nothing here is stored.** The conversation lives in this component's
 * state and is gone when you leave the page; each turn sends it back to the
 * server, which keeps none of it. What actually happened is in the activity
 * list (assistant_actions), which is the part worth keeping.
 *
 * The $0.50 per conversation you chose is applied here, because this is the
 * only place the whole conversation exists: when it is reached, the box stops
 * taking questions and says so. The server separately refuses to let any one
 * turn pass $0.50, and the database refuses to pass the month's budget —
 * neither of those can be talked round from a browser.
 *
 * The "Needs you" cards are in needs-you.tsx: each press there goes through
 * the same Server Action the rest of the app uses, and what you decided is
 * added to the conversation so the Assistant knows it next turn.
 */

const CONVERSATION_CEILING_USD = 0.5;

type Entry =
  | { kind: "you"; text: string }
  | { kind: "said"; text: string }
  | { kind: "done"; actions: { id: string; summary: string; undone: boolean; problem: string | null }[] }
  | { kind: "needs"; proposals: { key: string; proposal: Proposal }[] }
  | { kind: "stopped"; reason: string };

export function AssistantChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<Said[]>([]);
  const [spentUsd, setSpentUsd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
  const router = useRouter();

  const full = spentUsd >= CONVERSATION_CEILING_USD;

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || full) return;

    const sent: Said[] = [...history, { role: "user", text }];
    setEntries((list) => [...list, { kind: "you", text }]);
    setHistory(sent);
    setBusy(true);

    // What the Assistant said this turn, for the history sent next time —
    // including what it did, so it remembers that without any tool traffic.
    const answer: string[] = [];
    const startedAt = spentUsd;

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: sent }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        add({ kind: "stopped", reason: body.error ?? "The Assistant couldn't be reached." });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handle(JSON.parse(line) as ConverseEvent, answer, startedAt);
        }
      }
    } catch {
      add({ kind: "stopped", reason: "The connection dropped. Anything already done above stays done." });
    } finally {
      setLooking(null);
      setBusy(false);
      if (answer.length > 0) setHistory((list) => [...list, { role: "assistant", text: answer.join("\n") }]);
      // It did something on its own: redraw the page around the chat, so the
      // strip shows it with Undo. A refresh keeps this component's state.
      if (answer.some((said) => said.startsWith("(Done:"))) router.refresh();
    }
  }

  function handle(event: ConverseEvent, answer: string[], startedAt: number) {
    switch (event.type) {
      case "text":
        answer.push(event.text);
        add({ kind: "said", text: event.text });
        return;
      case "acted":
        answer.push(`(Done: ${event.action.summary}.)`);
        setEntries((list) => {
          const last = list[list.length - 1];
          const action = { id: event.action.id, summary: event.action.summary, undone: false, problem: null };
          // Several things done in a row share one green box, as in the design.
          if (last?.kind === "done") return [...list.slice(0, -1), { ...last, actions: [...last.actions, action] }];
          return [...list, { kind: "done", actions: [action] }];
        });
        return;
      case "proposal":
        answer.push("(Offered a card, waiting for the person.)");
        setEntries((list) => {
          const last = list[list.length - 1];
          const card = { key: crypto.randomUUID(), proposal: event.proposal };
          // Cards in a row sit side by side, as in the design.
          if (last?.kind === "needs") return [...list.slice(0, -1), { ...last, proposals: [...last.proposals, card] }];
          return [...list, { kind: "needs", proposals: [card] }];
        });
        return;
      case "looked":
        setLooking(LOOKING[event.tool] ?? "Looking…");
        return;
      case "refused":
        // The model hears why and usually tries again; a line here would be
        // noise. It only shows if the whole turn ends on it.
        return;
      case "spend":
        setSpentUsd(startedAt + event.turnUsd);
        return;
      case "stopped":
        add({ kind: "stopped", reason: event.reason });
        return;
      case "done":
        return;
    }
  }

  function add(entry: Entry) {
    setEntries((list) => [...list, entry]);
  }

  /**
   * What you decided on a card, as a line of the conversation. The Assistant
   * only hears words, so this is how it knows next turn that the draft is in
   * Gmail or the event was declined, instead of offering it again.
   */
  function settle(note: string) {
    setHistory((list) => [...list, { role: "assistant", text: `(${note})` }]);
  }

  function markUndone(id: string, problem: string | null) {
    setEntries((list) =>
      list.map((entry) =>
        entry.kind === "done"
          ? {
              ...entry,
              actions: entry.actions.map((action) =>
                action.id === id ? { ...action, undone: problem === null, problem } : action,
              ),
            }
          : entry,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.length > 0 && (
        <section
          aria-label="Conversation"
          className="flex flex-col gap-[13px] rounded-[18px] bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]"
        >
          {entries.map((entry, index) => (
            <EntryView key={index} entry={entry} onUndone={markUndone} onSettled={settle} />
          ))}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-[12.5px] font-medium text-ink-soft">
              <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-info-ink" />
              {looking ?? "Thinking…"}
            </p>
          )}
        </section>
      )}

      {/* The bar (./composer.tsx), shaped like ChatGPT's at the user's
          request. What the design said around the box stays, in one quiet
          line under it: that nothing is kept, what it has cost, and what it
          may do without asking. */}
      <div className="flex flex-col gap-2">
        <Composer
          onAsk={(text) => void ask(text)}
          busy={busy}
          full={full}
          placeholder={
            full
              ? "This conversation has reached $0.50."
              : entries.length === 0
                ? // Short, as ChatGPT's is: the design's longer line was cut
                  // off in a phone-width bar.
                  "Ask anything"
                : "Say something back"
          }
        />
        {full ? (
          <p className="px-4 text-[11.5px] leading-[1.5] font-medium text-accent">
            This conversation has used its $0.50. Reload the page to start a new one — everything
            it did stays done, and stays undoable from the contact pages.
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-[11.5px] font-medium text-ink-soft">
            <span>This conversation isn&rsquo;t saved.</span>
            <span>Notes and dates it changes on its own. Mail and calendar always ask.</span>
            {spentUsd > 0 && (
              <span className="sm:ml-auto">
                This conversation: ${spentUsd.toFixed(2)} of ${CONVERSATION_CEILING_USD.toFixed(2)}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

const LOOKING: Record<string, string> = {
  search_contacts: "Looking through your contacts…",
  get_contact: "Reading a contact…",
  who_needs_you: "Checking who needs you…",
  this_week: "Checking your week…",
  read_latest_thread: "Reading the latest mail…",
};

function EntryView({
  entry,
  onUndone,
  onSettled,
}: {
  entry: Entry;
  onUndone: (id: string, problem: string | null) => void;
  onSettled: (note: string) => void;
}) {
  switch (entry.kind) {
    case "you":
      return (
        <div className="max-w-[640px] self-end rounded-[16px_16px_4px_16px] bg-chip px-[15px] py-[11px]">
          <p className="text-[13.5px] leading-[1.5] whitespace-pre-wrap">{entry.text}</p>
        </div>
      );
    case "said":
      return (
        <div className="flex max-w-[900px] items-start gap-[11px]">
          <Spark />
          <p className="text-[13.5px] leading-[1.55] whitespace-pre-wrap">{entry.text}</p>
        </div>
      );
    case "done":
      return (
        <div className="flex flex-col gap-[7px] rounded-[14px] bg-done-tint px-[15px] py-3">
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-affirm uppercase">Done, and undoable</span>
          {entry.actions.map((action) => (
            <DoneRow key={action.id} action={action} onUndone={onUndone} />
          ))}
        </div>
      );
    case "needs":
      return (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {entry.proposals.map(({ key, proposal }) => (
            <NeedsYouCard key={key} proposal={proposal} onSettled={onSettled} />
          ))}
        </div>
      );
    case "stopped":
      return (
        <p role="status" className="rounded-[12px] bg-accent-tint px-3.5 py-2.5 text-[12.5px] leading-[1.5] font-medium text-[#7c3a12]">
          {entry.reason}
        </p>
      );
  }
}

function DoneRow({
  action,
  onUndone,
}: {
  action: { id: string; summary: string; undone: boolean; problem: string | null };
  onUndone: (id: string, problem: string | null) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0 text-affirm">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span className={`min-w-0 flex-1 text-[13px] ${action.undone ? "text-ink-faint line-through" : ""}`}>
        {action.summary}
      </span>
      {action.undone ? (
        <span className="text-[12px] font-semibold text-ink-soft">Undone</span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const failed = await undoAssistantAction(action.id);
              onUndone(action.id, failed?.error ?? null);
            })
          }
          className="shrink-0 rounded-full border border-line-strong bg-white px-3 py-[5px] text-[12px] font-semibold transition-colors hover:bg-paper disabled:opacity-60"
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      )}
      {action.problem && <span className="w-full text-[11.5px] font-medium text-accent">{action.problem}</span>}
    </div>
  );
}

function Spark() {
  return (
    <span aria-hidden="true" className="mt-px flex size-[26px] shrink-0 items-center justify-center rounded-[9px] bg-ink-deep">
      <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z" />
      </svg>
    </span>
  );
}
