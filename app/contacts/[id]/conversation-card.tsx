"use client";

import { useEffect, useState } from "react";
import { dayMonth } from "@/lib/format";
import type { ConversationEntry } from "@/lib/relationship/conversation";
import { readConversationLines } from "./actions";

/**
 * "Every touch" on a contact's page: the messages themselves
 * (docs/slice-9b-plan.md, Part 4). Until now this page showed warmth, an AI
 * summary of what somebody said, and a link to Gmail — and not one message.
 *
 * design/ContactDetail.dc.html has this card, and its heading and caption are
 * the design's, word for word: "Every touch", "14 messages on record". Two
 * differences, both because of what the rows have to carry:
 *
 *   - The design lays its events along a horizontal axis — Jul, Aug, Sep with
 *     chips pinned at their dates. A chip there holds two short lines ("They
 *     replied · within a day"). A row here holds a subject AND the first line
 *     of the message, which is the whole point, and eight of those do not fit
 *     on an axis at any width, least of all 390px. So the chips are stacked,
 *     newest first, and keep the design's own anatomy: a 30px tinted icon
 *     tile, a title line, a grey line under it.
 *   - The design's Timeline / Month / List switcher is left out: one view
 *     exists, and a switcher with one working option is a lie (the same
 *     reason the fake controls go in Part 6).
 *
 * Who wrote and when is stored, so every row is on screen with the rest of the
 * page. The first lines are asked for once this card is on screen, and are
 * never written down — waiting for them while the page rendered cost about
 * 700ms (measured), which is too much for a line of text.
 */
export function ConversationCard({
  entries,
  threadId,
  total,
  gmailLink,
}: {
  entries: ConversationEntry[];
  /** The thread the lines are read from. Checked server-side before any read. */
  threadId: string;
  /** Messages on record with this contact, which can be more than is shown. */
  total: number;
  /** The thread in Gmail, for the rest of it. */
  gmailLink: string | null;
}) {
  // What came back, and which thread it came back for. Kept together rather
  // than reset when `threadId` changes: clearing state inside the effect sets
  // it synchronously and costs a second render of every row.
  const [read, setRead] = useState<{
    threadId: string;
    lines: Record<string, string>;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;

    readConversationLines(threadId)
      .then((answer) => {
        if (current) setRead({ threadId, lines: answer.lines, error: answer.error });
      })
      .catch(() => {
        if (current) {
          setRead({ threadId, lines: {}, error: "The lines couldn't be read just now." });
        }
      });

    // Another contact opened before this answers must not get these lines.
    return () => {
      current = false;
    };
  }, [retry, threadId]);

  // A thread that isn't this one is last page's answer, so it counts for nothing.
  const answer = read?.threadId === threadId ? read : null;
  const lines = answer?.lines ?? null;
  const problem = answer?.error ?? null;
  const waiting = answer === null;

  return (
    <section className="rounded-xl bg-white px-[22px] py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold tracking-[-0.015em]">Every touch</h2>
          <span className="text-xs font-normal text-ink-soft">
            {total === 1 ? "1 message on record" : `${total} messages on record`}
            {entries.length < total && ` · the last ${entries.length} below`}
          </span>
        </div>
        {gmailLink && (
          <a
            href={gmailLink}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-accent hover:text-accent-dark"
          >
            Open the thread in Gmail
          </a>
        )}
      </div>

      <ul className="mt-3.5 flex flex-col">
        {entries.map((entry) => {
          const line = lines?.[entry.id] ?? entry.line;

          return (
            <li
              key={entry.id}
              className="flex gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-lg ${
                  entry.fromThem ? "bg-chip text-ink-soft" : "bg-info-tint text-info-ink"
                }`}
              >
                {entry.fromThem ? (
                  // The envelope of this page's own contact line, from the design.
                  <Icon>
                    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
                    <path d="m3.8 7.2 7.3 5.3a1.5 1.5 0 0 0 1.8 0l7.3-5.3" />
                  </Icon>
                ) : (
                  // The design's own "you wrote" chip: a pencil on #e8eef7.
                  <Icon>
                    <path d="M4 20h4L18.6 9.4a2.1 2.1 0 0 0-3-3L5 17v3z" />
                  </Icon>
                )}
              </span>

              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold tracking-[-0.01em]">{entry.who}</span>
                  <span className="text-xs font-normal text-ink-soft">{dayMonth(entry.at)}</span>
                </div>
                {entry.subject && (
                  <span className="truncate text-sm font-normal text-ink-body">{entry.subject}</span>
                )}
                {line ? (
                  <span className="text-sm text-ink-soft">{line}</span>
                ) : (
                  waiting && <span className="h-3 w-40 animate-pulse rounded-lg bg-line-soft" aria-hidden="true" />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Slice 8b's lesson: a read that failed and said nothing cost a day of
          debugging. If Gmail can't be read, the card says so in one line. */}
      {problem && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs font-normal text-accent">
            {problem}
          </p>
          <button
            type="button"
            onClick={() => {
              setRead(null);
              setRetry((value) => value + 1);
            }}
            className="rounded-full border border-line-strong bg-white px-2.5 py-1 text-xs font-semibold text-ink-body transition-colors hover:bg-paper"
          >
            Try again
          </button>
        </div>
      )}

      {/* Said once, at the bottom, because it is the same promise the privacy
          page makes: the lines above are not in this app's database. */}
      <p className="mt-3 text-xs font-normal text-ink-soft">
        Who wrote and when is stored. The lines are read from Gmail as you look at this page and
        are not kept.
      </p>
    </section>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[15px]"
    >
      {children}
    </svg>
  );
}
