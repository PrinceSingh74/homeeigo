import type { AiProviderType } from "@prisma/client";
import { aiConfig, isGeminiConfigured, isOpenAiConfigured } from "../config";
import { callGemini, callOpenAi, type ProviderCallInput } from "../providers/model-providers";
import type { AiProviderResponse } from "../types";
import { recordAiFallback, recordAiProviderUsage, recordAiTimeout } from "../../lib/ai-metrics";
import { computeRetryDelayMs } from "../../events/core/retry";

type CircuitState = "closed" | "open" | "half_open";

const circuit: Record<AiProviderType, { state: CircuitState; failures: number; openedAt: number }> = {
  GEMINI: { state: "closed", failures: 0, openedAt: 0 },
  OPENAI: { state: "closed", failures: 0, openedAt: 0 },
};

function recordFailure(provider: AiProviderType): void {
  const c = circuit[provider];
  c.failures += 1;
  if (c.failures >= aiConfig.circuitBreaker.failureThreshold) {
    c.state = "open";
    c.openedAt = Date.now();
  }
}

function recordSuccess(provider: AiProviderType): void {
  circuit[provider] = { state: "closed", failures: 0, openedAt: 0 };
}

function isCircuitOpen(provider: AiProviderType): boolean {
  const c = circuit[provider];
  if (c.state === "closed") return false;
  if (c.state === "open" && Date.now() - c.openedAt > aiConfig.circuitBreaker.resetMs) {
    c.state = "half_open";
    return false;
  }
  return c.state === "open";
}

async function invokeProvider(
  provider: AiProviderType,
  input: ProviderCallInput,
): Promise<AiProviderResponse> {
  if (isCircuitOpen(provider)) {
    throw new Error(`circuit_open:${provider}`);
  }
  try {
    const resp = provider === "GEMINI" ? await callGemini(input) : await callOpenAi(input);
    recordSuccess(provider);
    recordAiProviderUsage(provider, "success");
    return resp;
  } catch (err) {
    recordFailure(provider);
    recordAiProviderUsage(provider, "failure");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("AbortError")) {
      recordAiTimeout(provider);
    }
    throw err;
  }
}

export type RouterResult = AiProviderResponse & { fallbackUsed: boolean };

/**
 * Primary: Gemini. On failure/timeout → retry once → OpenAI fallback.
 * No load balancing. No random routing.
 */
export async function routeModelRequest(input: ProviderCallInput): Promise<RouterResult> {
  const geminiAvailable = isGeminiConfigured() && !isCircuitOpen("GEMINI");

  if (geminiAvailable) {
    try {
      const resp = await invokeProvider("GEMINI", input);
      return { ...resp, fallbackUsed: false };
    } catch (firstErr) {
      // Retry once (Phase 0 retry utility for delay metadata; immediate retry here)
      await new Promise((r) => setTimeout(r, computeRetryDelayMs(1, 500, 2000).getTime() - Date.now()));
      try {
        const resp = await invokeProvider("GEMINI", input);
        return { ...resp, fallbackUsed: false };
      } catch {
        // fall through to OpenAI
        void firstErr;
      }
    }
  }

  if (!isOpenAiConfigured() && !aiConfig.dryRun) {
    throw new Error("no_provider_available");
  }

  recordAiFallback("GEMINI", "OPENAI");
  const resp = await invokeProvider("OPENAI", input);
  return { ...resp, fallbackUsed: true };
}

export function getCircuitStates(): Record<AiProviderType, CircuitState> {
  return {
    GEMINI: circuit.GEMINI.state,
    OPENAI: circuit.OPENAI.state,
  };
}

export function resetCircuits(): void {
  circuit.GEMINI = { state: "closed", failures: 0, openedAt: 0 };
  circuit.OPENAI = { state: "closed", failures: 0, openedAt: 0 };
}
