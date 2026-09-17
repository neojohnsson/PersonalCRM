import type { TokenUsage } from "@/lib/ai/models";

/**
 * One request to OpenAI's Responses API, as plain `fetch` — like the Gmail
 * requests, so every field sent is visible here (docs/slice-4-plan.md,
 * decision A). The only file that knows OpenAI's request and response shape;
 * switching provider means replacing this one.
 *
 * Checked against https://developers.openai.com/api/docs, 2026-09-17:
 *   - POST /v1/responses; `instructions` + `input`
 *   - structured outputs: text.format = { type: "json_schema", name, schema,
 *     strict: true } — the answer is guaranteed to match the schema
 *   - the answer is in output[].content[] as type "output_text"; a safety
 *     refusal comes as type "refusal"
 *   - `store: false`: OpenAI doesn't keep the response for later retrieval
 *     (the default keeps it 30 days). API data isn't used for training.
 */

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export type JsonSchema = Record<string, unknown>;

export type ResponseRequest = {
  apiKey: string;
  model: string;
  /** The rules: what to do and what never to do. */
  instructions: string;
  /** The material: here, the messages. */
  input: string;
  schemaName: string;
  schema: JsonSchema;
  /** Includes reasoning tokens. Also the ceiling the cost reservation assumes. */
  maxOutputTokens: number;
  reasoningEffort?: "none" | "low" | "medium";
};

export type StructuredResponse<T> = { data: T; usage: TokenUsage };

/** OpenAI answered with an error status. Carries whatever usage is known: none. */
export class OpenAiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAiError";
    this.status = status;
  }
}

/**
 * The request went through but gave no usable answer — a refusal, or output
 * cut off at the token limit. Tokens were still used and are still paid for.
 */
export class OpenAiNoAnswer extends Error {
  usage: TokenUsage;
  constructor(message: string, usage: TokenUsage) {
    super(message);
    this.name = "OpenAiNoAnswer";
    this.usage = usage;
  }
}

type ContentItem = { type: string; text?: string; refusal?: string };

type ResponseBody = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: ContentItem[] }[];
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  };
  error?: { message?: string } | null;
};

export async function createStructuredResponse<T>(request: ResponseRequest): Promise<StructuredResponse<T>> {
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
      store: false,
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: request.reasoningEffort ?? "low" },
      text: {
        format: { type: "json_schema", name: request.schemaName, schema: request.schema, strict: true },
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as ResponseBody;

  if (!response.ok) {
    // OpenAI's own explanation, never the request: it holds email text.
    const reason = body.error?.message;
    throw new OpenAiError(response.status, `OpenAI failed with HTTP ${response.status}${reason ? `: ${reason}` : ""}`);
  }

  const usage: TokenUsage = {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };

  const content = (body.output ?? []).flatMap((item) => (item.type === "message" ? (item.content ?? []) : []));

  const refusal = content.find((item) => item.type === "refusal");
  if (refusal) throw new OpenAiNoAnswer(`The model declined: ${refusal.refusal ?? "no reason given"}`, usage);

  if (body.status === "incomplete") {
    throw new OpenAiNoAnswer(
      `The answer was cut off (${body.incomplete_details?.reason ?? "incomplete"}).`,
      usage,
    );
  }

  const text = content.find((item) => item.type === "output_text")?.text;
  if (!text) throw new OpenAiNoAnswer("The model gave no answer.", usage);

  try {
    return { data: JSON.parse(text) as T, usage };
  } catch {
    throw new OpenAiNoAnswer("The model's answer wasn't valid JSON.", usage);
  }
}
