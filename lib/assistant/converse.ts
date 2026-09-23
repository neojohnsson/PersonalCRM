import type { SupabaseClient } from "@supabase/supabase-js";
import { costOf, estimateTokens, maxCostOf } from "@/lib/ai/models";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { createToolStep, type InputItem, type ToolStep, type ToolStepRequest } from "@/lib/ai/openai-tools";
import { AiCapReached, withSpendCap } from "@/lib/ai/spend";
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
 *   8 steps      one badly phrased question cannot become twenty tool calls
 *   $0.50        per turn, checked BEFORE each step against the most that step
 *                could cost, so it stops short rather than overshooting. The
 *                page also stops the conversation at $0.50 in total; that is
 *                where the per-conversation ceiling you chose is applied, since
 *                the conversation itself is never stored here.
 *   the month    every step reserves against the Assistant's own budget line
 *                in the database first (withSpendCap, migration 0025) — the
 *                limit nothing on the page can get round
 *
 * Nothing about the conversation is written anywhere. The only rows a turn
 * can create are ai_usage (what it cost) and assistant_actions (what it did).
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
};

export async function* converse(input: ConverseInput): AsyncGenerator<ConverseEvent> {
  const now = input.now ?? new Date();
  const today = todayIn("Europe/Stockholm", now);
  const step = input.step ?? createToolStep;
  const instructions = assistantInstructions({ today, now });
  const tools = toolDefinitions();

  const ctx: ToolContext = { db: input.db, userId: input.userId, today, now, mailSeen: [] };
  const items: InputItem[] = input.history.map((said) => ({ role: said.role, content: said.text }));
  let turnUsd = 0;

  for (let stepNumber = 1; stepNumber <= MAX_STEPS; stepNumber += 1) {
    // The most this step could cost: everything sent at full price, and the
    // answer at its limit. Stop before, not after.
    const estimate = maxCostOf(
      input.model,
      estimateTokens(instructions + JSON.stringify(tools) + JSON.stringify(items)),
      MAX_OUTPUT_TOKENS,
    );
    if (turnUsd + estimate > TURN_CEILING_USD) {
      yield { type: "stopped", reason: "This reached its $0.50 limit, so it stopped here. Ask again to carry on." };
      return;
    }

    let result: ToolStep;
    try {
      result = await withSpendCap(
        input.db,
        input.userId,
        { contactId: null, purpose: "assistant", model: input.model, estimateUsd: estimate, capUsd: input.monthlyCapUsd },
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
        yield {
          type: "stopped",
          reason: `This month's Assistant budget is used up ($${failure.spentUsd.toFixed(2)} of $${failure.capUsd.toFixed(2)}). It starts again on the 1st.`,
        };
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
        yield { type: "refused", tool: call.name, reason: outcome.refused };
        forModel = { refused: outcome.refused };
      } else if (outcome.tier === "act") {
        const { action } = outcome;
        yield {
          type: "acted",
          action: { id: action.id, kind: action.kind, summary: action.summary, contactId: action.contactId },
        };
        forModel = { done: action.summary, undoable: true };
      } else if (outcome.tier === "propose") {
        yield { type: "proposal", proposal: outcome.proposal };
        forModel = { waiting_for_the_person: true, note: "Shown as a card. Nothing has happened until they press it." };
      } else {
        yield { type: "looked", tool: call.name };
        forModel = outcome.result;
      }

      items.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(forModel) });
    }
  }

  yield { type: "stopped", reason: `That took more than ${MAX_STEPS} steps, so it stopped. Ask again, a bit more narrowly.` };
}
