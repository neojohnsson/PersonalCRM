import type { TokenUsage } from "@/lib/ai/models";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";

/**
 * One step of a tool-using conversation with OpenAI's Responses API (slice 11).
 *
 * lib/ai/openai.ts asks for one structured answer and stops. The Assistant
 * needs a loop: the model asks for a tool, the app runs it, the model reads
 * the result and either asks for another or answers. This file is one turn of
 * that loop; lib/assistant/converse.ts is the loop.
 *
 * Checked against https://developers.openai.com/api/docs, 2026-09-23:
 *   - a function tool is { type: "function", name, description, parameters,
 *     strict } — strict: every argument required, nothing extra
 *   - a call comes back in `output` as { type: "function_call", call_id,
 *     name, arguments }, arguments being a JSON string
 *   - its result goes back as { type: "function_call_output", call_id,
 *     output } with the same call_id
 *   - `store: false` — nothing kept by OpenAI. Then "any reasoning items
 *     returned with tool calls must also be passed back", and they carry
 *     their own encrypted_content so that works without storage: so every
 *     output item is replayed, as it came, for the rest of the turn.
 */

const RESPONSES_URL = "https://api.openai.com/v1/responses";

/** An item of the conversation, exactly as OpenAI sent it or expects it. */
export type InputItem = Record<string, unknown>;

export type ToolCall = { callId: string; name: string; arguments: string };

export type ToolStep = {
  /** Every output item, to replay on the next step of this turn. */
  output: InputItem[];
  /** What the model said to the person, if anything. */
  text: string | null;
  /** The tools it asked for, in order. Empty means it has answered. */
  calls: ToolCall[];
  usage: TokenUsage;
};

export type ToolStepRequest = {
  apiKey: string;
  model: string;
  instructions: string;
  input: InputItem[];
  tools: unknown[];
  maxOutputTokens: number;
};

type OutputItem = {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string; refusal?: string }[];
};

type ResponseBody = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OutputItem[];
  usage?: { input_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens?: number };
  error?: { message?: string } | null;
};

export async function createToolStep(request: ToolStepRequest): Promise<ToolStep> {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools,
      // One tool at a time: each is shown to you as it happens, and a second
      // call can depend on what the first found.
      parallel_tool_calls: false,
      store: false,
      // Accepted for compatibility and harmless: asks for the encrypted
      // reasoning that a stateless tool loop has to hand back.
      include: ["reasoning.encrypted_content"],
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: "low" },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as ResponseBody;

  if (!response.ok) {
    // OpenAI's explanation, never the request: the request holds your mail.
    const reason = body.error?.message;
    throw new OpenAiError(response.status, `OpenAI failed with HTTP ${response.status}${reason ? `: ${reason}` : ""}`);
  }

  const usage: TokenUsage = {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };

  const output = body.output ?? [];
  const content = output.flatMap((item) => (item.type === "message" ? (item.content ?? []) : []));

  const refusal = content.find((item) => item.type === "refusal");
  if (refusal) throw new OpenAiNoAnswer(`The model declined: ${refusal.refusal ?? "no reason given"}`, usage);
  if (body.status === "incomplete") {
    throw new OpenAiNoAnswer(`The answer was cut off (${body.incomplete_details?.reason ?? "incomplete"}).`, usage);
  }

  const calls = output
    .filter((item) => item.type === "function_call" && item.call_id && item.name)
    .map((item) => ({ callId: item.call_id!, name: item.name!, arguments: item.arguments ?? "{}" }));

  const text = content
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text!)
    .join("\n")
    .trim();

  return { output: output as InputItem[], text: text || null, calls, usage };
}
