import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiError, OpenAiNoAnswer, createStructuredResponse } from "@/lib/ai/openai";

/** The OpenAI request against a fake fetch: what's sent, and how answers are read. */

const USAGE = { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300 };
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

const request = {
  apiKey: "sk-test-key",
  model: "gpt-5.6-luna",
  instructions: "Rules.",
  input: "Messages.",
  schemaName: "test",
  schema: SCHEMA,
  maxOutputTokens: 2000,
};

function fakeOpenAi(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const answer = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    { type: "message", role: "assistant", content },
  ],
  usage: USAGE,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createStructuredResponse", () => {
  it("sends a strict JSON schema request that OpenAI won't store", async () => {
    const fetchMock = fakeOpenAi(200, answer([{ type: "output_text", text: '{"ok":true}' }]));

    await createStructuredResponse(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5.6-luna",
      instructions: "Rules.",
      input: "Messages.",
      store: false,
      max_output_tokens: 2000,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "test", schema: SCHEMA, strict: true } },
    });
  });

  it("returns the parsed answer and the token counts", async () => {
    fakeOpenAi(200, answer([{ type: "output_text", text: '{"ok":true}' }]));
    expect(await createStructuredResponse<{ ok: boolean }>(request)).toEqual({
      data: { ok: true },
      usage: { inputTokens: 1200, cachedInputTokens: 200, outputTokens: 300 },
    });
  });

  it("turns a refusal into OpenAiNoAnswer, keeping the tokens it used", async () => {
    fakeOpenAi(200, answer([{ type: "refusal", refusal: "I can't help with that." }]));
    const failure = await createStructuredResponse(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenAiNoAnswer);
    expect((failure as OpenAiNoAnswer).usage.outputTokens).toBe(300);
  });

  it("treats an answer cut off at the token limit as no answer", async () => {
    fakeOpenAi(
      200,
      answer([{ type: "output_text", text: '{"ok":' }], {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    );
    await expect(createStructuredResponse(request)).rejects.toThrow(/cut off \(max_output_tokens\)/);
  });

  it("keeps OpenAI's reason for an HTTP error, and never the request", async () => {
    fakeOpenAi(401, { error: { message: "Incorrect API key provided." } });
    const failure = await createStructuredResponse(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenAiError);
    expect((failure as OpenAiError).status).toBe(401);
    expect((failure as Error).message).toBe("OpenAI failed with HTTP 401: Incorrect API key provided.");
    expect((failure as Error).message).not.toContain("Messages.");
  });
});
