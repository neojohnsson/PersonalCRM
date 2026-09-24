import type { SupabaseClient } from "@supabase/supabase-js";
import { costOf, estimateTokens, maxCostOf } from "@/lib/ai/models";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { createToolStep, type InputItem, type ToolStep, type ToolStepRequest } from "@/lib/ai/openai-tools";
import { AiCapReached, limitMessage, withSpendCap } from "@/lib/ai/spend";
import { todayIn } from "@/lib/relationship/dates";
import { assistantInstructions } from "./instructions";
import { runTool, toolDefinitions, type Proposal, type ToolContext } from "./tools";

/**
 * One turn of the Assistant: your message in, the model thinking and using
 * tools, until it answers or a limit says stop (docs/slice-11-plan.md §5–6).
 *
 * It is a generator: every step yields what happened as it happens — text, an
 * action done, a card waiting for you, the money spent — and the route streams
 * each one to the page. So a turn that uses four tools shows four things
 * arriving, not "Writing…" for twenty seconds.
 *
 * The limits, each one for a reason:
 *
 *   8 steps      one badly phrased question cannot quietly become fifty tool
 *                calls. A big task is allowed, but not without you knowing:
 *                at 8 steps the turn PAUSES (2026-09-24, at the user's
 *                request -- it used to stop), says what it has looked at, done
 *                and offered, and carries on only if you press Carry on.
 *   $0.50        per turn, checked BEFORE each step against the most that step
 *                could cost, so it pauses short rather than overshooting. The
 *                page holds the conversation to $0.50 in total, and each
 *                Carry on you press raises that by another $0.50, said on the
 *                card before you press.
 *   the month    every step reserves against the Assistant's own budget line
 *                in the database first (withSpendCap, migration 0025) — the
 *                limit nothing on the page can get round
 *
 * Nothing about the conversation is written anywhere. The only rows a turn
 * can create are ai_usage (what it cost) and assistant_actions (what it did).
 * A paused turn hands its working memory -- the items so far, reasoning and
 * tool results included -- to the page, which holds it in memory and sends it
 * back with Carry on, so the turn resumes instead of starting over.
 * lib/assistant/history.ts checks it on the way back in.
 */

export const MAX_STEPS = 8;
export const TURN_CEILING_USD = 0.5;
/** Per step. A short answer plus a tool call fits in far less. */
export const MAX_OUTPUT_TOKENS = 1_500;

/** What the browser keeps and sends back: words only, never tool traffic. */
export type Said = { role: "user" | "assistant"; text: string };

export type ConverseEvent =
  | { type: "text"; text: string }
  | { type: "acted"; action: { id: string; kind: string; summary: string; contactId: string } }
  | { type: "proposal"; proposal: Proposal }
  | { type: "looked"; tool: string }
  | { type: "refused"; tool: string; reason: string }
  | { type: "spend"; turnUsd: number }
  | { type: "stopped"; reason: string }
  | {
      type: "paused";
      /** Why: it used its steps, or it reached the turn's $0.50. */
      reason: "steps" | "cost";
      turnUsd: number;
      /** What this turn has done so far, for the card. */
      tally: { looked: number; acted: number; proposed: number };
      /** The turn's working memory, to send back with Carry on. */
      resume: InputItem[];
    }
  | { type: "done" };

export type ConverseInput = {
  db: SupabaseClient;
  userId: string;
  apiKey: string;
  model: string;
  history: Said[];
  monthlyCapUsd: number;
  now?: Date;
  /** Swapped for a fake in tests; OpenAI otherwise. */
  step?: (request: ToolStepRequest) => Promise<ToolStep>;
  /** A paused turn's working memory, checked by parseResume: carry on from it. */
  resume?: InputItem[] | null;
};

/** What a resumed turn is told the person said. */
export const CARRY_ON = "Carry on with the same task, from where you paused.";

export async function* converse(input: ConverseInput): AsyncGenerator<ConverseEvent> {
  const now = input.now ?? new Date();
  const today = todayIn("Europe/Stockholm", now);
  const step = input.step ?? createToolStep;
  const instructions = assistantInstructions({ today, now });
  const tools = toolDefinitions();

  const ctx: ToolContext = { db: input.db, userId: input.userId, today, now, mailSeen: [] };
  const items: InputItem[] = input.resume
    ? [...input.resume, { role: "user", content: CARRY_ON }]
    : input.history.map((said) => ({ role: said.role, content: said.text }));
  // A resumed turn has read mail already; a note still may not copy it.
  if (input.resume) ctx.mailSeen.push(...mailLinesIn(input.resume));
  let turnUsd = 0;
  const tally = { looked: 0, acted: 0, proposed: 0 };
  const pause = (reason: "steps" | "cost"): ConverseEvent => ({
    type: "paused",
    reason,
    turnUsd,
    tally: { ...tally },
    resume: [...items],
  });

  for (let stepNumber = 1; stepNumber <= MAX_STEPS; stepNumber += 1) {
    // The most this step could cost: everything sent at full price, and the
    // answer at its limit. Stop before, not after.
    const estimate = maxCostOf(
      input.model,
      estimateTokens(instructions + JSON.stringify(tools) + JSON.stringify(items)),
      MAX_OUTPUT_TOKENS,
    );
    if (turnUsd + estimate > TURN_CEILING_USD) {
      yield pause("cost");
      return;
    }

    let result: ToolStep;
    try {
      result = await withSpendCap(
        input.db,
        input.userId,
        {
          contactId: null,
          purpose: "assistant",
          model: input.model,
          estimateUsd: estimate,
          ceilingUsd: input.monthlyCapUsd,
          // One question is one use of Free's allowance: its first step. The
          // steps after it, and a Carry on, belong to the same question.
          countsAsUse: stepNumber === 1 && !input.resume,
        },
        async () => {
          const answer = await step({
            apiKey: input.apiKey,
            model: input.model,
            instructions,
            input: items,
            tools,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          });
          return { result: answer, usage: answer.usage };
        },
      );
    } catch (failure) {
      if (failure instanceof AiCapReached) {
        yield { type: "stopped", reason: limitMessage(failure, now).replace("AI budget", "Assistant budget") };
        return;
      }
      if (failure instanceof OpenAiError || failure instanceof OpenAiNoAnswer) {
        yield { type: "stopped", reason: failure.message };
        return;
      }
      throw failure;
    }

    turnUsd += costOf(input.model, result.usage);
    yield { type: "spend", turnUsd };
    if (result.text) yield { type: "text", text: result.text };

    if (result.calls.length === 0) {
      yield { type: "done" };
      return;
    }

    // Replay everything this step produced, reasoning included: with
    // store:false, that is how the next step knows what it was doing.
    items.push(...result.output);

    for (const call of result.calls) {
      const outcome = await runTool(ctx, call.name, call.arguments);
      let forModel: unknown;

      if ("refused" in outcome) {
        // Counted nowhere: it did nothing.
        yield { type: "refused", tool: call.name, reason: outcome.refused };
        forModel = { refused: outcome.refused };
      } else if (outcome.tier === "act") {
        const { action } = outcome;
        tally.acted += 1;
        yield {
          type: "acted",
          action: { id: action.id, kind: action.kind, summary: action.summary, contactId: action.contactId },
        };
        forModel = { done: action.summary, undoable: true };
      } else if (outcome.tier === "propose") {
        tally.proposed += 1;
        yield { type: "proposal", proposal: outcome.proposal };
        forModel = { waiting_for_the_person: true, note: "Shown as a card. Nothing has happened until they press it." };
      } else {
        tally.looked += 1;
        yield { type: "looked", tool: call.name };
        forModel = outcome.result;
      }

      items.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(forModel) });
    }
  }

  yield pause("steps");
}

/**
 * The first lines of mail a paused turn had read, found again in its tool
 * results, so the rule that a note never copies a sentence from an email
 * still holds after Carry on (lib/assistant/act.ts).
 */
function mailLinesIn(items: InputItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type !== "function_call_output" || typeof item.output !== "string") continue;
    try {
      const result = JSON.parse(item.output) as { untrusted_mail?: boolean; messages?: { first_line?: unknown }[] };
      if (!result.untrusted_mail) continue;
      for (const message of result.messages ?? []) {
        if (typeof message.first_line === "string") lines.push(message.first_line);
      }
    } catch {
      // Not JSON: nothing to remember.
    }
  }
  return lines;
}
