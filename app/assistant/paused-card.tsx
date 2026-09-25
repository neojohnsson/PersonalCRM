"use client";

/**
 * "This is a big task" (2026-09-24): what the page shows when a turn has used
 * its 8 steps or its $0.50, instead of stopping it (lib/assistant/converse.ts).
 *
 * The user asked for big tasks, with a warning rather than a wall: say what
 * has happened so far, say what carrying on may cost, and let them decide.
 * What it does on its own is still only the five undoable things, and each is
 * in Everything it did -- which is what makes "your call" a fair one.
 *
 * Built from the "Needs you" cards' pattern (./needs-you.tsx), the nearest
 * designed thing: a bordered card, a pill, the buttons, a line of small print.
 */

export type Tally = { looked: number; acted: number; proposed: number };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PausedCard({
  reason,
  tally,
  turnUsd,
  extraUsd,
  state,
  onCarryOn,
  onStop,
}: {
  reason: "steps" | "cost";
  tally: Tally;
  turnUsd: number;
  /** How much more this conversation may cost if they carry on. */
  extraUsd: number;
  state: "asking" | "carried-on" | "stopped";
  onCarryOn: () => void;
  onStop: () => void;
}) {
  const sofar = [
    tally.looked > 0 ? `looked things up ${count(tally.looked, "time", "times")}` : null,
    tally.acted > 0 ? `made ${count(tally.acted, "change", "changes")} on its own` : null,
    tally.proposed > 0 ? `put up ${count(tally.proposed, "card", "cards")} for you` : null,
  ].filter(Boolean);

  return (
    <div className="flex max-w-[560px] flex-col gap-2.5 rounded-xl border border-line px-4 py-3.5">
      <div className="flex items-center gap-[9px]">
        <h3 className="text-sm font-bold tracking-[-0.01em]">This is a big task</h3>
        <span
          className={`rounded-full px-[9px] py-[3px] text-2xs font-bold ${
            state === "asking" ? "bg-accent-tint text-needs-ink" : "bg-chip text-ink-soft"
          }`}
        >
          {state === "asking" ? "Needs you" : state === "carried-on" ? "Carrying on" : "Stopped"}
        </span>
      </div>
      <p className="text-sm text-ink-body">
        {reason === "steps" ? "It has used its steps for one go" : "It has reached this go's $0.50"}
        {sofar.length > 0 ? ` — so far it has ${sofar.join(", ")}` : ""}, for ${turnUsd.toFixed(2)}.
        {state === "asking" &&
          ` Carry on and it picks up where it is, for up to 8 more steps; this conversation may then cost up to $${extraUsd.toFixed(2)} more.`}
      </p>
      {state === "asking" && (
        <div className="flex flex-wrap items-center gap-[7px]">
          <button
            type="button"
            onClick={onCarryOn}
            className="rounded-full bg-ink-deep px-[15px] py-[9px] text-sm font-semibold text-white transition hover:bg-ink/85"
          >
            Carry on
          </button>
          <button
            type="button"
            onClick={onStop}
            className="rounded-full border border-line bg-transparent px-[15px] py-[9px] text-sm font-semibold text-ink-body transition hover:bg-paper"
          >
            Stop here
          </button>
        </div>
      )}
      <p className="text-xs text-ink-soft">
        {tally.acted > 0
          ? "Everything it changes on its own is in Everything it did, each with Undo."
          : "It has changed nothing on its own. Anything it changes will be in Everything it did, with Undo."}
      </p>
    </div>
  );
}
