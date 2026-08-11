import crypto from "crypto";
import type { AiProviderType } from "@prisma/client";
import { aiConfig } from "../config";
import type { AiMessage, AiProviderResponse } from "../types";
import { AI_TIMEOUT_MS } from "../types";
import {
  ProviderError,
  classifyHttpStatus,
  parseRetryAfterMs,
  summariseUpstreamBody,
  toProviderError,
} from "./provider-errors";

export type ProviderCallInput = {
  systemPrompt: string;
  messages: AiMessage[];
  maxTokens?: number;
  /**
   * Function schemas the model may call this turn.
   *
   * Built server-side from the discovery filter, so the model can only ever see tools the
   * actor was already permitted to use. Absent means no tools for this turn.
   */
  tools?: Array<Record<string, unknown>>;
  /**
   * Upper bound for this specific call, in ms.
   *
   * The router passes what is left of the shared request deadline. Without it a single
   * adapter could block for its full configured timeout even when the whole request had
   * only a second of budget remaining, which is how a bounded chain still overruns.
   */
  timeoutMs?: number;
};

/** Per-call budget: never longer than the adapter's own ceiling, never below 1s. */
function callTimeoutMs(input: ProviderCallInput, configured: number): number {
  if (input.timeoutMs === undefined) return configured;
  return Math.max(1_000, Math.min(configured, input.timeoutMs));
}

/**
 * Anthropic Claude adapter — plain `fetch` against the Messages API, matching the
 * OpenAI adapter's style so the provider set stays dependency-free.
 *
 * Two shape differences from OpenAI are handled here: the system prompt is a top-level
 * `system` field rather than a message, and `max_tokens` is required.
 */
export async function callAnthropic(input: ProviderCallInput): Promise<AiProviderResponse> {
  const t0 = Date.now();
  const { anthropic } = aiConfig;

  if (aiConfig.dryRun || !anthropic.apiKey) {
    return mockResponse("ANTHROPIC", anthropic.model, input, t0);
  }

  // Claude accepts only user/assistant turns; a stray system turn is folded into the
  // user side rather than dropped, so no instruction is silently lost.
  const messages = input.messages.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.role === "system" ? `[SYSTEM] ${m.content}` : m.content,
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs(input, AI_TIMEOUT_MS.anthropic));

  try {
    const res = await fetch(`${anthropic.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropic.apiKey,
        "anthropic-version": anthropic.apiVersion,
      },
      body: JSON.stringify({
        model: anthropic.model,
        system: input.systemPrompt,
        messages,
        max_tokens: input.maxTokens ?? 2048,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw await httpFailure(res, "ANTHROPIC");

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    const content = (data.content ?? [])
      .filter((block) => block?.type === "text" || typeof block?.text === "string")
      .map((block) => block.text ?? "")
      .join("");
    assertNonEmptyCompletion(content, "ANTHROPIC", data.stop_reason);

    return {
      content,
      promptTokens: data.usage?.input_tokens ?? estimateTokens(input),
      completionTokens:
        data.usage?.output_tokens ?? estimateTokens({ messages: [{ role: "assistant", content }] }),
      cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
      finishReason: data.stop_reason,
      provider: "ANTHROPIC" as AiProviderType,
      model: anthropic.model,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    throw toProviderError(err, "ANTHROPIC");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns a non-OK provider response into a classified ProviderError.
 *
 * The upstream body is summarised rather than forwarded: it is not ours to redistribute
 * and can echo request content back. Retry-After (or a vendor reset hint) is captured so
 * the router can park the provider for exactly as long as it asked for.
 */
async function httpFailure(res: Response, provider: AiProviderType): Promise<ProviderError> {
  const body = await res.text().catch(() => "");
  const code = classifyHttpStatus(res.status, body);
  return new ProviderError({
    code,
    provider,
    httpStatus: res.status,
    retryAfterMs: parseRetryAfterMs(res.headers, body),
    message: `${provider} ${code} (HTTP ${res.status}): ${summariseUpstreamBody(body)}`,
  });
}

/** Vertex and the Developer API return the same candidate/usage shape. */
type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

/**
 * An empty completion is a failure, not an answer.
 *
 * Reasoning models spend part of the output budget on internal thinking and can return a
 * candidate with zero text parts (`finishReason: MAX_TOKENS`) while still reporting HTTP
 * 200. Delivering that blank string would look like a model response to the caller, so it
 * is raised instead — letting the router fall back to the next provider.
 */
function assertNonEmptyCompletion(content: string, provider: AiProviderType, reason?: string): void {
  if (content.trim().length === 0) {
    throw new ProviderError({
      code: "PROVIDER_INVALID_RESPONSE",
      provider,
      message: `${provider} returned an empty completion${reason ? ` (finishReason=${reason})` : ""}`,
    });
  }
}

function toGeminiContents(input: ProviderCallInput) {
  return input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : m.role === "system" ? "user" : m.role,
    parts: [{ text: m.role === "system" ? `[SYSTEM] ${m.content}` : m.content }],
  }));
}

function fromGeminiResponse(
  resp: GeminiGenerateResponse | undefined,
  input: ProviderCallInput,
  modelId: string,
  t0: number,
): AiProviderResponse {
  const candidate = resp?.candidates?.[0];
  const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  assertNonEmptyCompletion(content, "GEMINI", candidate?.finishReason);
  const usage = resp?.usageMetadata;
  return {
    content,
    promptTokens: usage?.promptTokenCount ?? estimateTokens(input),
    completionTokens:
      usage?.candidatesTokenCount ?? estimateTokens({ messages: [{ role: "assistant", content }] }),
    cachedTokens: usage?.cachedContentTokenCount ?? 0,
    finishReason: candidate?.finishReason,
    provider: "GEMINI" as AiProviderType,
    model: modelId,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Gemini Developer API — used when `GEMINI_API_KEY` is set.
 *
 * This is a different service from Vertex (`aiplatform.googleapis.com`): it authenticates
 * with an API key rather than application-default credentials, and needs no GCP project
 * wiring. A key configured against Vertex would otherwise be silently ignored, which is
 * how a working credential can still produce PERMISSION_DENIED.
 */
async function callGeminiDeveloperApi(input: ProviderCallInput): Promise<AiProviderResponse> {
  const t0 = Date.now();
  const { gemini } = aiConfig;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs(input, AI_TIMEOUT_MS.gemini));

  try {
    const res = await fetch(
      `${gemini.apiBaseUrl}/models/${gemini.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": gemini.apiKey as string,
        },
        body: JSON.stringify({
          contents: toGeminiContents(input),
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          generationConfig: { maxOutputTokens: input.maxTokens ?? 2048 },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) throw await httpFailure(res, "GEMINI");

    return fromGeminiResponse((await res.json()) as GeminiGenerateResponse, input, gemini.model, t0);
  } catch (err) {
    throw toProviderError(err, "GEMINI");
  } finally {
    clearTimeout(timer);
  }
}

export async function callGemini(input: ProviderCallInput): Promise<AiProviderResponse> {
  const t0 = Date.now();
  const { gemini } = aiConfig;

  if (aiConfig.dryRun) {
    return mockResponse("GEMINI", gemini.model, input, t0);
  }

  // Transport follows the credential that is actually available.
  if (gemini.apiKey) {
    return callGeminiDeveloperApi(input);
  }

  const vertexLoc = gemini.location;
  const modelId = gemini.model;
  const { v1beta1 } = await import("@google-cloud/aiplatform");
  const client = new v1beta1.PredictionServiceClient({
    apiEndpoint: `${vertexLoc}-aiplatform.googleapis.com`,
  });
  const model = `projects/${gemini.projectId}/locations/${vertexLoc}/publishers/google/models/${modelId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs(input, AI_TIMEOUT_MS.gemini));

  try {
    const [resp] = await (client as unknown as {
      generateContent: (req: unknown) => Promise<[GeminiGenerateResponse]>;
    }).generateContent({
      model,
      contents: toGeminiContents(input),
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      generationConfig: { maxOutputTokens: input.maxTokens ?? 2048 },
    });

    return fromGeminiResponse(resp, input, modelId, t0);
  } catch (err) {
    throw toProviderError(err, "GEMINI");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat-completions adapter shared by every OpenAI-compatible provider.
 *
 * Groq exposes the same `/chat/completions` contract as OpenAI, so both providers run
 * through one implementation instead of two copies that could drift. The provider identity,
 * endpoint and credential come from the caller; nothing else differs.
 */
async function callOpenAiCompatible(
  input: ProviderCallInput,
  provider: AiProviderType,
  cfg: { apiKey?: string; model: string; baseUrl: string },
  timeoutMs: number,
): Promise<AiProviderResponse> {
  const t0 = Date.now();

  if (aiConfig.dryRun || !cfg.apiKey) {
    return mockResponse(provider, cfg.model, input, t0);
  }

  // Tool and assistant turns must round-trip in the provider's own shape, or the model
  // cannot pair a result with the call that produced it and will re-request the same tool.
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: input.systemPrompt },
    ...input.messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.argumentsJson },
          })),
        };
      }
      return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
    }),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs(input, timeoutMs));

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: input.maxTokens ?? 2048,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw await httpFailure(res, provider);

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const toolCalls = (choice?.message?.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id ?? crypto.randomUUID(),
        name: tc.function!.name!,
        argumentsJson: tc.function?.arguments ?? "{}",
      }));

    // A turn that requests tools legitimately has no prose, so the empty-completion guard
    // must not fire on it — the answer arrives after the tools have run.
    if (toolCalls.length === 0) {
      assertNonEmptyCompletion(content, provider, choice?.finish_reason);
    }

    return {
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(input),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens({ messages: [{ role: "assistant", content }] }),
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      finishReason: data.choices?.[0]?.finish_reason,
      provider,
      model: cfg.model,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    throw toProviderError(err, provider);
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenAi(input: ProviderCallInput): Promise<AiProviderResponse> {
  return callOpenAiCompatible(input, "OPENAI", aiConfig.openai, AI_TIMEOUT_MS.openai);
}

/** Groq — OpenAI-compatible endpoint, typically an order of magnitude faster. */
export async function callGroq(input: ProviderCallInput): Promise<AiProviderResponse> {
  return callOpenAiCompatible(input, "GROQ", aiConfig.groq, AI_TIMEOUT_MS.groq);
}

function estimateTokens(input: { messages: AiMessage[]; systemPrompt?: string }): number {
  const text = [
    input.systemPrompt ?? "",
    ...input.messages.map((m) => m.content),
  ].join(" ");
  return Math.ceil(text.length / 4);
}

function mockResponse(
  provider: AiProviderType,
  model: string,
  input: ProviderCallInput,
  t0: number,
): AiProviderResponse {
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  return {
    content: `[${provider} dry-run] Acknowledged: ${(lastUser?.content ?? "").slice(0, 120)}`,
    promptTokens: estimateTokens(input),
    completionTokens: 32,
    cachedTokens: 0,
    provider,
    model,
    latencyMs: Date.now() - t0,
  };
}

export async function checkGroqHealth(): Promise<boolean> {
  try {
    await callGroq({
      systemPrompt: "Reply with OK",
      messages: [{ role: "user", content: "health" }],
      maxTokens: 256,
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkAnthropicHealth(): Promise<boolean> {
  try {
    await callAnthropic({
      systemPrompt: "Reply with OK",
      messages: [{ role: "user", content: "health" }],
      // Reasoning models spend output budget on thinking before emitting text; too small
      // a budget makes the probe report an unhealthy provider that is in fact fine.
      maxTokens: 256,
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkGeminiHealth(): Promise<boolean> {
  try {
    await callGemini({
      systemPrompt: "Reply with OK",
      messages: [{ role: "user", content: "health" }],
      // Reasoning models spend output budget on thinking before emitting text; too small
      // a budget makes the probe report an unhealthy provider that is in fact fine.
      maxTokens: 256,
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkOpenAiHealth(): Promise<boolean> {
  try {
    await callOpenAi({
      systemPrompt: "Reply with OK",
      messages: [{ role: "user", content: "health" }],
      // Reasoning models spend output budget on thinking before emitting text; too small
      // a budget makes the probe report an unhealthy provider that is in fact fine.
      maxTokens: 256,
    });
    return true;
  } catch {
    return false;
  }
}
