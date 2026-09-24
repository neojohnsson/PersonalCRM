import "server-only";
import { DEFAULT_DRAFT_MODEL, DEFAULT_MODEL, isKnownModel } from "@/lib/ai/models";

/**
 * The AI settings, read from the server's environment. "server-only": the
 * API key must never reach a browser bundle, so importing this from a client
 * component fails the build.
 */

/**
 * The emergency brake on summaries, drafts, scans and research: no plan may
 * spend more than this in a month (slice 13). The default is the most any plan
 * includes (Premium, lib/plans/plans.ts); LLM_MONTHLY_CAP_USD can lower it for
 * everyone at once. Was decision C's $2 for everybody until plans existed.
 */
export const DEFAULT_MONTHLY_CAP_USD = 5;

export type AiConfig = {
  apiKey: string;
  /** Summaries and other extraction: LLM_MODEL_FAST. */
  model: string;
  /** Drafts, which a person sends to another person: LLM_MODEL_GOOD. */
  draftModel: string;
  monthlyCapUsd: number;
};

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

  const draftModel = env.LLM_MODEL_GOOD?.trim() || DEFAULT_DRAFT_MODEL;
  if (!isKnownModel(draftModel)) {
    throw new AiNotConfigured(`LLM_MODEL_GOOD is "${draftModel}", which has no price in lib/ai/models.ts.`);
  }

  return { apiKey, model, draftModel, monthlyCapUsd: monthlyCapUsd(env) };
}

/** LLM_MONTHLY_CAP_USD as a number of dollars; the default if unset or not a number. */
export function monthlyCapUsd(env: Env = process.env): number {
  const raw = env.LLM_MONTHLY_CAP_USD?.trim();
  const cap = raw ? Number(raw) : NaN;
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_CAP_USD;
}

/**
 * The emergency brake on the Assistant's own budget line (slice 11; migration
 * 0025), separate from the one summaries and drafts share, so one long
 * conversation cannot use up tomorrow's summary. Since slice 13 each plan has
 * its own Assistant budget under it; the default is the most any plan
 * includes, and ASSISTANT_MONTHLY_CAP_USD can lower it for everyone.
 */
export const DEFAULT_ASSISTANT_CAP_USD = 10;

export function assistantMonthlyCapUsd(env: Env = process.env): number {
  const raw = env.ASSISTANT_MONTHLY_CAP_USD?.trim();
  const cap = raw ? Number(raw) : NaN;
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_ASSISTANT_CAP_USD;
}

/**
 * The Assistant's model (slice 11): gpt-5.4-mini unless LLM_MODEL_ASSISTANT
 * says otherwise. Chosen for calling the right tool over price, because a
 * wrong tool call here writes to a contact. A model with no price in
 * lib/ai/models.ts is refused, as everywhere: its cost could not be counted.
 */
export const DEFAULT_ASSISTANT_MODEL = "gpt-5.4-mini";

export function assistantModel(env: Env = process.env): string {
  const model = env.LLM_MODEL_ASSISTANT?.trim() || DEFAULT_ASSISTANT_MODEL;
  if (!isKnownModel(model)) {
    throw new AiNotConfigured(`LLM_MODEL_ASSISTANT is "${model}", which has no price in lib/ai/models.ts.`);
  }
  return model;
}
