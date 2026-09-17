import "server-only";
import { DEFAULT_MODEL, isKnownModel } from "@/lib/ai/models";

/**
 * The AI settings, read from the server's environment. "server-only": the
 * API key must never reach a browser bundle, so importing this from a client
 * component fails the build.
 */

/** Decision C: $2 a month unless LLM_MONTHLY_CAP_USD says otherwise. */
export const DEFAULT_MONTHLY_CAP_USD = 2;

export type AiConfig = { apiKey: string; model: string; monthlyCapUsd: number };

/** The settings read — process.env by default; tests pass their own. */
type Env = Record<string, string | undefined>;

/** The AI can't be used: no key, or a model the app has no price for. */
export class AiNotConfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfigured";
  }
}

export function aiConfig(env: Env = process.env): AiConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AiNotConfigured("OPENAI_API_KEY isn't set.");

  const model = env.LLM_MODEL_FAST?.trim() || DEFAULT_MODEL;
  if (!isKnownModel(model)) {
    throw new AiNotConfigured(`LLM_MODEL_FAST is "${model}", which has no price in lib/ai/models.ts.`);
  }

  return { apiKey, model, monthlyCapUsd: monthlyCapUsd(env) };
}

/** LLM_MONTHLY_CAP_USD as a number of dollars; the default if unset or not a number. */
export function monthlyCapUsd(env: Env = process.env): number {
  const raw = env.LLM_MONTHLY_CAP_USD?.trim();
  const cap = raw ? Number(raw) : NaN;
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_CAP_USD;
}
