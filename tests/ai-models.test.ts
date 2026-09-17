import { describe, expect, it } from "vitest";
import { AiNotConfigured, DEFAULT_MONTHLY_CAP_USD, aiConfig, monthlyCapUsd } from "@/lib/ai/config";
import { DEFAULT_MODEL, MODEL_PRICES, costOf, estimateTokens, maxCostOf } from "@/lib/ai/models";
import { startOfMonthInStockholm } from "@/lib/ai/spend";

/** Prices, cost arithmetic and settings. No network. */

describe("costOf", () => {
  it("prices input, cached input and output separately, per million tokens", () => {
    // gpt-5.6-luna: $0.20 input, $0.02 cached, $1.20 output.
    const cost = costOf("gpt-5.6-luna", { inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 1_000 });
    expect(cost).toBeCloseTo(8_000 * 0.2e-6 + 2_000 * 0.02e-6 + 1_000 * 1.2e-6, 12);
  });

  it("never counts more cached tokens than input tokens", () => {
    expect(costOf("gpt-5.6-luna", { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 })).toBeCloseTo(
      100 * 0.02e-6,
      12,
    );
  });

  it("refuses a model it has no price for — its cost couldn't be counted", () => {
    expect(() => costOf("gpt-unknown", { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 })).toThrow(/No price/);
  });

  it("has a price for the default model", () => {
    expect(MODEL_PRICES[DEFAULT_MODEL]).toBeDefined();
  });
});

describe("maxCostOf and estimateTokens", () => {
  it("assumes full-price input and output at its limit", () => {
    expect(maxCostOf("gpt-5.6-luna", 13_000, 2_000)).toBeCloseTo(13_000 * 0.2e-6 + 2_000 * 1.2e-6, 12);
  });

  it("guesses high: one token per three characters", () => {
    expect(estimateTokens("abcdefg")).toBe(3);
    expect(estimateTokens("")).toBe(0);
  });

  it("puts a full 20-message summary well under a cent", () => {
    const input = estimateTokens("x".repeat(20 * 2_000 + 4_000));
    expect(maxCostOf(DEFAULT_MODEL, input, 2_000)).toBeLessThan(0.01);
  });
});

describe("aiConfig", () => {
  it("needs an API key", () => {
    expect(() => aiConfig({})).toThrow(AiNotConfigured);
    expect(() => aiConfig({ OPENAI_API_KEY: "  " })).toThrow(AiNotConfigured);
  });

  it("uses the default model and cap when they aren't set", () => {
    expect(aiConfig({ OPENAI_API_KEY: "sk-test" })).toEqual({
      apiKey: "sk-test",
      model: DEFAULT_MODEL,
      monthlyCapUsd: DEFAULT_MONTHLY_CAP_USD,
    });
  });

  it("takes another known model and cap from the environment", () => {
    expect(aiConfig({ OPENAI_API_KEY: "sk-test", LLM_MODEL_FAST: "gpt-5-nano", LLM_MONTHLY_CAP_USD: "5" })).toEqual({
      apiKey: "sk-test",
      model: "gpt-5-nano",
      monthlyCapUsd: 5,
    });
  });

  it("refuses a model with no price", () => {
    expect(() => aiConfig({ OPENAI_API_KEY: "sk-test", LLM_MODEL_FAST: "gpt-unknown" })).toThrow(AiNotConfigured);
  });

  it("falls back to the default cap for nonsense", () => {
    expect(monthlyCapUsd({ LLM_MONTHLY_CAP_USD: "lots" })).toBe(DEFAULT_MONTHLY_CAP_USD);
    expect(monthlyCapUsd({ LLM_MONTHLY_CAP_USD: "-3" })).toBe(DEFAULT_MONTHLY_CAP_USD);
    expect(monthlyCapUsd({ LLM_MONTHLY_CAP_USD: "0" })).toBe(0);
  });
});

describe("startOfMonthInStockholm", () => {
  it("is midnight on the 1st in Swedish time, summer and winter", () => {
    // September: UTC+2, so 22:00 UTC on 31 August.
    expect(startOfMonthInStockholm(new Date("2026-09-17T12:00:00Z")).toISOString()).toBe("2026-08-31T22:00:00.000Z");
    // January: UTC+1, so 23:00 UTC on 31 December.
    expect(startOfMonthInStockholm(new Date("2027-01-15T12:00:00Z")).toISOString()).toBe("2026-12-31T23:00:00.000Z");
    // 23:30 UTC on 30 September is already October in Sweden.
    expect(startOfMonthInStockholm(new Date("2026-09-30T23:30:00Z")).toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
});
