"use client";

import { useState, useTransition } from "react";
import { undoAssistantAction } from "@/app/assistant/actions";

/**
 * Undo for one thing the Assistant did, in the strip on /assistant and on
 * /assistant/activity. The action refreshes the page, so after a press the
 * row redraws itself as "Undone"; this only has to say why when it can't —
 * most often because you changed the same thing yourself since.
 */
export function UndoButton({ actionId, label }: { actionId: string; label: string }) {
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <span className="flex shrink-0 items-center gap-2">
      {problem && <span className="text-[11.5px] font-medium text-accent">{problem}</span>}
      <button
        type="button"
        aria-label={`Undo: ${label}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const failed = await undoAssistantAction(actionId);
            setProblem(failed?.error ?? null);
          })
        }
        className="shrink-0 rounded-full border border-line-strong bg-transparent px-3 py-[5px] text-[12px] font-semibold transition-colors hover:bg-paper disabled:opacity-60"
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
    </span>
  );
}
