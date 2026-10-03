/**
 * A dry-run must never be reported as money spent.
 *
 * Every adapter returns `mockResponse` when `AI_GATEWAY_DRY_RUN=true` or the provider has no API
 * key. That response carried plausible token counts and was otherwise shaped exactly like a real
 * completion, so the gateway priced it and `homigo_ai_daily_cost_usd` aggregated the result as
 * provider spend. On 2026-09-21 that gauge read $0.0143 on a deployment with **no AI credential
 * configured at all** — every cent of it imaginary, and nothing on the dashboard said so.
 *
 * The estimate is still worth having: it answers "what would this traffic cost once a key exists".
 * It is simply not the same number as "what left the account", and the two must never share a
 * series.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveInferenceConfigured } from "../ai/config";

const src = (...p: string[]) => readFileSync(join(import.meta.dir, "..", ...p), "utf8");
const PROVIDERS = src("ai", "providers", "model-providers.ts");
const GATEWAY = src("ai", "gateway", "ai-gateway.ts");
const METRICS = src("lib", "ai-metrics.ts");
const TYPES = src("ai", "types.ts");

describe("AI cost truth", () => {
  it("marks a dry-run response as mocked", () => {
    expect(TYPES).toMatch(/mocked\?:\s*boolean/);
    const mockFn = PROVIDERS.slice(PROVIDERS.indexOf("function mockResponse"));
    expect(mockFn.slice(0, 900)).toMatch(/mocked:\s*true/);
  });

  it("records zero actual cost for a mocked response", () => {
    expect(GATEWAY).toMatch(/const costUsd = routed\.mocked \? 0 : estimated\.costUsd/);
  });

  it("reports the would-have-cost estimate on a separate series, so nothing is lost", () => {
    expect(GATEWAY).toContain("recordMockedResponse(");
    expect(METRICS).toContain("homigo_ai_mocked_responses_total");
    expect(METRICS).toContain("homigo_ai_mocked_estimated_cost_usd_total");
  });

  it("never folds the estimate into the spend gauge", () => {
    const fn = METRICS.slice(METRICS.indexOf("export function recordMockedResponse"));
    expect(fn.slice(0, 700)).not.toContain("homigo_ai_daily_cost_usd");
  });

  it("treats a tool-assisted answer the same as a plain one", () => {
    // A tool loop builds its own result shape from several turns; without this it would be the one
    // path that still billed a dry-run as real spend.
    expect(GATEWAY).toMatch(/mocked:\s*!liveInferenceConfigured\(/);
  });

  it("derives live-inference capability from the same condition the adapters use", () => {
    const original = { ...process.env };
    try {
      for (const k of ["AI_GATEWAY_DRY_RUN", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) {
        delete process.env[k];
      }
      // With no credential, nothing can reach a provider — so nothing may be billed.
      expect(liveInferenceConfigured("GROQ")).toBe(false);
      expect(liveInferenceConfigured("OPENAI")).toBe(false);
      expect(liveInferenceConfigured("ANTHROPIC")).toBe(false);
      expect(liveInferenceConfigured("GEMINI")).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(original)) if (v !== undefined) process.env[k] = v;
    }
  });
});
