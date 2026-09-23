/**
 * The OpenAI models the app may use, and what they cost
 * (docs/slice-4-plan.md, Part 2 and decision A).
 *
 * Prices in US dollars per million tokens, from
 * https://developers.openai.com/api/docs/pricing — checked 2026-09-17, and
 * again 2026-09-23 before the Assistant spent anything.
 * When OpenAI changes a price, change it here: the cap is only as right as
 * these numbers. A model not in this list is refused, because its cost
 * couldn't be counted.
 */

export type ModelPrice = { input: number; cachedInput: number; output: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // 2026-09-23: output fell from $1.20 to $0.75, and a "cache writes" price
  // of $0.25 appeared. OpenAI's usage report does not say which input tokens
  // were cache writes, so every uncached input token is counted at the higher
  // $0.25 -- too strict, never too loose, as the cap is meant to be.
  "gpt-5.6-luna": { input: 0.25, cachedInput: 0.02, output: 0.75 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
};

/**
 * The default: OpenAI's current budget model, "designed for cost-sensitive,
 * high-volume workloads", with structured outputs. Set LLM_MODEL_FAST to use
 * another one from the list.
 */
export const DEFAULT_MODEL = "gpt-5.6-luna";

/**
 * Drafts get a bigger model: they are written to a real person, and small
 * models write stiff, translated-sounding Swedish (plan.md §5.3). The user's
 * choice, 2026-09-17. Set LLM_MODEL_GOOD to use another one from the list.
 */
export const DEFAULT_DRAFT_MODEL = "gpt-5-mini";

export type TokenUsage = {
  inputTokens: number;
  /** The part of inputTokens OpenAI had cached, billed at the cached price. */
  cachedInputTokens: number;
  /** Includes the model's reasoning tokens, which are billed as output. */
  outputTokens: number;
};

const PER_TOKEN = 1 / 1_000_000;

/** What a finished request cost, in dollars. */
export function costOf(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  return (
    (usage.inputTokens - cached) * price.input * PER_TOKEN +
    cached * price.cachedInput * PER_TOKEN +
    usage.outputTokens * price.output * PER_TOKEN
  );
}

/**
 * The most a request could cost, before it's sent: every input token at the
 * full price, and the output at its limit. What reserve_ai_spend holds back.
 */
export function maxCostOf(model: string, inputTokens: number, maxOutputTokens: number): number {
  return costOf(model, { inputTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens });
}

/**
 * A deliberately high guess at how many tokens a text is. English runs about
 * four characters a token; Swedish, names and addresses fewer. Three errs on
 * the side of reserving too much — the safe mistake for a cap.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function isKnownModel(model: string): boolean {
  return Object.hasOwn(MODEL_PRICES, model);
}

function priceOf(model: string): ModelPrice {
  if (!isKnownModel(model)) throw new Error(`No price is known for the model "${model}"`);
  return MODEL_PRICES[model];
}
