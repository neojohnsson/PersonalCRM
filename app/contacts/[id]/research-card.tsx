"use client";

import { useState, useTransition } from "react";
import { priceInWords } from "@/lib/assistant/price";
import type { ResearchRow } from "@/lib/research/decide";
import { discardResearchAction, keepResearchAction, removeFactAction, researchAction } from "./research-actions";

/**
 * "From the web" (slice 12, commit 4; docs/slice-12-plan.md §4).
 *
 * No design has this card. It reuses the relationship summary's
 * (./summary-card.tsx), the nearest designed thing and the same kind of thing:
 * something the AI wrote about a person, dated, tinted while it waits for you,
 * every claim linked to where it came from.
 *
 *   waiting   whether it is the same person first -- orange when it might
 *             not be, the app's "do not send blind" -- then each fact with
 *             its link and a tick box. Ticked to start with when it is sure
 *             or likely; NOT ticked when unsure, so keeping a doubtful fact
 *             is a choice you make, not one you forget to undo.
 *   kept      a quiet list: the fact, where it came from, when it was found,
 *             and an x to take it out
 */

const CARD = "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";
const LABEL = "text-[10px] font-bold tracking-[0.07em] text-ink-meta uppercase";
const GHOST =
  "rounded-full bg-line-soft px-[13px] py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:bg-chip-track disabled:cursor-default disabled:opacity-60";
const SOLID =
  "rounded-full bg-ink-deep px-[15px] py-1.5 text-[12px] font-semibold text-white transition hover:bg-ink/85 disabled:cursor-default disabled:opacity-60";

const IDENTITY = {
  sure: { words: "The same person", className: "bg-done-tint text-affirm" },
  likely: { words: "Probably the same person", className: "bg-info-tint text-info-ink" },
  unsure: { words: "Might be someone else", className: "bg-accent-tint text-needs-ink" },
} as const;

function dateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Stockholm" }).format(new Date(iso));
}

/** "Page title · site", unless the title already names the site. */
function withHost(title: string, url: string): string {
  const host = hostOf(url);
  return title.toLowerCase().includes(host.toLowerCase()) ? title : `${title} · ${host}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchCard({
  contactId,
  pending,
  kept,
  typicalUsd,
}: {
  contactId: string;
  pending: ResearchRow | null;
  kept: ResearchRow[];
  typicalUsd: number | null;
}) {
  const [busy, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nothingFound, setNothingFound] = useState<string | null>(null);

  function research() {
    setError(null);
    setNothingFound(null);
    setSearching(true);
    start(async () => {
      const result = await researchAction(contactId);
      setSearching(false);
      if (result?.error) setError(result.error);
      else if (result?.nothingFound) setNothingFound(result.nothingFound);
    });
  }

  const keptFacts = kept.flatMap((set) => set.facts.map((fact, index) => ({ fact, index, set })));

  return (
    <section className={`${CARD} flex flex-col gap-3 px-[22px] py-[18px]`} aria-label="From the web">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">From the web</h2>
        {!pending && (
          <button type="button" onClick={research} disabled={busy} className={`${keptFacts.length > 0 ? GHOST : SOLID} ml-auto`}>
            {searching ? "Searching the web…" : keptFacts.length > 0 ? "Research again" : "Research this person"}
          </button>
        )}
      </div>

      {searching && (
        <p role="status" className="text-[12.5px] text-ink-soft">
          Reading public pages about them. It can take up to a minute.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-accent">
          {error}
        </p>
      )}
      {nothingFound && !pending && (
        <p className="rounded-[12px] bg-paper px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-ink-body">
          Nothing reliable was found, so nothing was saved. {nothingFound}
        </p>
      )}

      {pending && <Waiting set={pending} />}

      {keptFacts.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {keptFacts.map(({ fact, index, set }) => (
            <KeptFact key={`${set.id}-${index}`} researchId={set.id} index={index} fact={fact} foundAt={set.foundAt} />
          ))}
        </ul>
      )}

      {!pending && keptFacts.length === 0 && !searching && !nothingFound && (
        <p className="text-[12.5px] leading-[1.5] text-ink-soft">
          Looks for public, professional facts about them — their role, their organisation&rsquo;s pages, talks and
          news — each with the link it came from. Nothing is added until you tick it. It costs {priceInWords(typicalUsd)}
          , from your AI budget.
        </p>
      )}

      <p className="text-[11.5px] leading-[1.45] text-ink-soft">
        Public web only. LinkedIn, people-search sites and social media are never searched, and nothing about private
        life is kept.
      </p>
    </section>
  );
}

function Waiting({ set }: { set: ResearchRow }) {
  const [ticked, setTicked] = useState<Set<number>>(
    () => new Set(set.identity === "unsure" ? [] : set.facts.map((_, index) => index)),
  );
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const identity = IDENTITY[set.identity];

  function toggle(index: number) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function decide(keep: boolean) {
    setError(null);
    start(async () => {
      const result = keep
        ? await keepResearchAction(set.id, [...ticked])
        : await discardResearchAction(set.id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-paper-tint px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={LABEL}>Found {dateOf(set.foundAt)} · waiting for you</span>
        <span className={`rounded-full px-[9px] py-[3px] text-[11px] font-bold ${identity.className}`}>{identity.words}</span>
      </div>
      <p className={`text-[12.5px] leading-[1.5] ${set.identity === "unsure" ? "font-medium text-needs-ink" : "text-ink-body"}`}>
        {set.identityWhy}
        {set.identity === "unsure" && " Check each link before you keep anything."}
      </p>
      <ul className="flex flex-col gap-2">
        {set.facts.map((fact, index) => (
          <li key={index}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={ticked.has(index)}
                onChange={() => toggle(index)}
                className="mt-[3px] size-4 shrink-0 accent-[var(--color-ink-deep)]"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] leading-[1.5] text-ink">{fact.text}</span>
                <a
                  href={fact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[11.5px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  {withHost(fact.title, fact.url)}
                </a>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => decide(true)} disabled={busy} className={SOLID}>
          {ticked.size === 0 ? "Keep none" : ticked.size === set.facts.length ? "Keep all" : `Keep the ${ticked.size} ticked`}
        </button>
        <button type="button" onClick={() => decide(false)} disabled={busy} className={GHOST}>
          Discard all
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-medium text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

function KeptFact({
  researchId,
  index,
  fact,
  foundAt,
}: {
  researchId: string;
  index: number;
  fact: ResearchRow["facts"][number];
  foundAt: string;
}) {
  const [busy, start] = useTransition();
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] leading-[1.5] text-ink-body">{fact.text}</span>
        <a
          href={fact.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-[11.5px] font-medium text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          {hostOf(fact.url)} · found {dateOf(foundAt)}
        </a>
      </span>
      <button
        type="button"
        aria-label={`Remove: ${fact.text}`}
        disabled={busy}
        onClick={() => start(async () => void (await removeFactAction(researchId, index)))}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper hover:text-ink disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-3.5">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}
