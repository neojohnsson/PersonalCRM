"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { undoAssistantAction } from "@/app/assistant/actions";
import { Composer } from "@/app/assistant/composer";
import { NeedsYouCard } from "@/app/assistant/needs-you";
import { PausedCard, type Tally } from "@/app/assistant/paused-card";
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
  | { kind: "stopped"; reason: string }
  | {
      kind: "paused";
      reason: "steps" | "cost";
      tally: Tally;
      turnUsd: number;
      /** The turn's working memory, sent back with Carry on. */
      resume: unknown[];
      state: "asking" | "carried-on" | "stopped";
    };

export function AssistantChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<Said[]>([]);
  const [spentUsd, setSpentUsd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
  const conversation = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const router = useRouter();

  // What this conversation may cost: $0.50, plus $0.50 for each Carry on you
  // press on a big task -- said on the card before you press it.
  const [ceilingUsd, setCeilingUsd] = useState(CONVERSATION_CEILING_USD);
  const full = spentUsd >= ceilingUsd;
  const { following, awayFromBottom, jumpToLatest, follow } = useFollowLatest(conversation);

  // Every change to the conversation follows it down, if you are following.
  // The ResizeObserver in useFollowLatest catches growth too, but only when
  // the browser draws, and a tab in the background does not draw.
  useEffect(() => {
    follow();
  }, [entries, busy, looking, follow]);

  async function ask(question: string, resume: unknown[] | null = null) {
    const text = question.trim();
    if (!text || busy || full) return;

    const sent: Said[] = [...history, { role: "user", text }];
    // Sending always brings you down to what you just said, and follows
    // the answer from there, as ChatGPT does.
    following.current = true;
    setEntries((list) => [...list, { kind: "you", text }]);
    setHistory(sent);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;

    // What the Assistant said this turn, for the history sent next time —
    // including what it did, so it remembers that without any tool traffic.
    const answer: string[] = [];
    const startedAt = spentUsd;

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: sent, resume }),
        signal: controller.signal,
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
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        add({ kind: "stopped", reason: "The connection dropped. Anything already done above stays done." });
      }
    } finally {
      if (request.current === controller) request.current = null;
      setLooking(null);
      setBusy(false);
      if (answer.length > 0) setHistory((list) => [...list, { role: "assistant", text: answer.join("\n") }]);
      // It did something on its own: redraw the page around the chat, so the
      // strip shows it with Undo. A refresh keeps this component's state.
      if (answer.some((said) => said.startsWith("(Done:"))) router.refresh();
    }
  }

  function stop() {
    request.current?.abort();
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
      case "paused":
        answer.push("(Paused a big task to ask whether to carry on.)");
        add({
          kind: "paused",
          reason: event.reason,
          tally: event.tally,
          turnUsd: event.turnUsd,
          resume: event.resume,
          state: "asking",
        });
        return;
      case "done":
        return;
    }
  }

  /** Carry on or stop a paused big task (./paused-card.tsx). */
  function decidePause(index: number, choice: "carry-on" | "stop") {
    const entry = entries[index];
    if (entry?.kind !== "paused" || entry.state !== "asking") return;
    setEntries((list) =>
      list.map((item, at) =>
        at === index && item.kind === "paused" ? { ...item, state: choice === "carry-on" ? "carried-on" : "stopped" } : item,
      ),
    );
    if (choice === "stop") {
      settle("The person stopped the task there.");
      return;
    }
    setCeilingUsd((ceiling) => ceiling + CONVERSATION_CEILING_USD);
    void ask("Carry on", entry.resume);
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
          ref={conversation}
          aria-label="Conversation"
          // No height of its own and no scrollbar (2026-09-24, as ChatGPT
          // does it): the conversation is part of the page, the page scrolls,
          // and the bar below stays pinned to the bottom of the window.
          className="flex flex-col gap-[13px] rounded-[18px] bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]"
        >
          {entries.map((entry, index) => (
            <EntryView
              key={index}
              entry={entry}
              onUndone={markUndone}
              onSettled={settle}
              onPaused={(choice) => decidePause(index, choice)}
              busy={busy}
            />
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
      <div className="sticky bottom-[74px] z-10 -mx-1 flex flex-col gap-2 bg-paper/95 px-1 pt-1 pb-1 backdrop-blur-sm sm:bottom-0">
        {awayFromBottom && (
          // You scrolled up to read: nothing moves under you. This brings you
          // back to the latest and follows again.
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="Scroll to the latest"
            className="absolute -top-12 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-white text-ink-body shadow-[0_2px_8px_rgba(20,20,25,.12)] transition hover:bg-paper"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
        )}
        <Composer
          onAsk={(text) => void ask(text)}
          onStop={stop}
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
                This conversation: ${spentUsd.toFixed(2)} of ${ceilingUsd.toFixed(2)}
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
  onPaused,
  busy,
}: {
  entry: Entry;
  onUndone: (id: string, problem: string | null) => void;
  onSettled: (note: string) => void;
  onPaused: (choice: "carry-on" | "stop") => void;
  busy: boolean;
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
    case "paused":
      return (
        <PausedCard
          reason={entry.reason}
          tally={entry.tally}
          turnUsd={entry.turnUsd}
          extraUsd={CONVERSATION_CEILING_USD}
          state={busy && entry.state === "asking" ? "carried-on" : entry.state}
          onCarryOn={() => onPaused("carry-on")}
          onStop={() => onPaused("stop")}
        />
      );
    case "stopped":
      return (
        <p role="status" className="rounded-[12px] bg-accent-tint px-3.5 py-2.5 text-[12.5px] leading-[1.5] font-medium text-alert-ink">
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

/**
 * The page follows the conversation as ChatGPT does (2026-09-24):
 *
 *   - at the bottom, it stays at the bottom while the answer comes in -- a
 *     ResizeObserver sees the conversation grow, whatever grew it: a line of
 *     text, a card, "Thinking…"
 *   - scroll up to read, and it stops following; nothing moves under you
 *   - the round arrow above the bar takes you back and follows again
 *   - asking always follows (set by ask())
 *
 * The page itself scrolls, not a box inside it, so there is one scrollbar,
 * the window's.
 */
function useFollowLatest(conversation: React.RefObject<HTMLElement | null>) {
  const following = useRef(true);
  // True while the arrow's smooth scroll is on its way down: the positions it
  // passes through are not you scrolling up.
  const jumping = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const toBottom = useCallback(
    (behavior: ScrollBehavior) => window.scrollTo({ top: document.documentElement.scrollHeight, behavior }),
    [],
  );
  const follow = useCallback(() => {
    if (following.current) toBottom("auto");
  }, [toBottom]);

  useEffect(() => {
    // Near enough counts as at the bottom: a line's height, not a pixel.
    const onScroll = () => {
      const below = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (jumping.current) {
        if (below >= 80) return;
        jumping.current = false;
      }
      following.current = below < 80;
      setAwayFromBottom(!following.current && conversation.current !== null);
    };
    // Your own wheel or finger always wins over the arrow's glide.
    const yours = () => {
      jumping.current = false;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", yours, { passive: true });
    window.addEventListener("touchstart", yours, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", yours);
      window.removeEventListener("touchstart", yours);
    };
  }, [conversation]);

  useEffect(() => {
    const element = conversation.current;
    if (!element) return;
    const grew = new ResizeObserver(follow);
    grew.observe(element);
    return () => grew.disconnect();
    // Re-attached when the conversation first appears.
  });

  function jumpToLatest() {
    following.current = true;
    jumping.current = true;
    setAwayFromBottom(false);
    toBottom("smooth");
  }

  return { following, awayFromBottom, jumpToLatest, follow };
}
