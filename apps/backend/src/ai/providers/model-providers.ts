import type { AiProviderType } from "@prisma/client";
import { aiConfig } from "../config";
import type { AiMessage, AiProviderResponse } from "../types";
import { AI_TIMEOUT_MS } from "../types";

export type ProviderCallInput = {
  systemPrompt: string;
  messages: AiMessage[];
  maxTokens?: number;
};

export async function callGemini(input: ProviderCallInput): Promise<AiProviderResponse> {
  const t0 = Date.now();
  const { gemini } = aiConfig;

  if (aiConfig.dryRun) {
    return mockResponse("GEMINI", gemini.model, input, t0);
  }

  const vertexLoc = gemini.location;
  const modelId = gemini.model;
  const { v1beta1 } = await import("@google-cloud/aiplatform");
  const client = new v1beta1.PredictionServiceClient({
    apiEndpoint: `${vertexLoc}-aiplatform.googleapis.com`,
  });
  const model = `projects/${gemini.projectId}/locations/${vertexLoc}/publishers/google/models/${modelId}`;

  const contents = input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : m.role === "system" ? "user" : m.role,
    parts: [{ text: m.role === "system" ? `[SYSTEM] ${m.content}` : m.content }],
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS.gemini);

  try {
    const [resp] = await (client as unknown as {
      generateContent: (req: unknown) => Promise<[{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
      }]>;
    }).generateContent({
      model,
      contents,
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      generationConfig: { maxOutputTokens: input.maxTokens ?? 2048 },
    });

    const content = resp?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = resp?.usageMetadata;
    return {
      content,
      promptTokens: usage?.promptTokenCount ?? estimateTokens(input),
      completionTokens: usage?.candidatesTokenCount ?? estimateTokens({ messages: [{ role: "assistant", content }] }),
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
      provider: "GEMINI" as AiProviderType,
      model: modelId,
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenAi(input: ProviderCallInput): Promise<AiProviderResponse> {
  const t0 = Date.now();
  const { openai } = aiConfig;

  if (aiConfig.dryRun || !openai.apiKey) {
    return mockResponse("OPENAI", openai.model, input, t0);
  }

  const messages = [
    { role: "system" as const, content: input.systemPrompt },
    ...input.messages.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS.openai);

  try {
    const res = await fetch(`${openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openai.apiKey}`,
      },
      body: JSON.stringify({
        model: openai.model,
        messages,
        max_tokens: input.maxTokens ?? 2048,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return {
      content,
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(input),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens({ messages: [{ role: "assistant", content }] }),
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      provider: "OPENAI" as AiProviderType,
      model: openai.model,
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
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

export async function checkGeminiHealth(): Promise<boolean> {
  try {
    await callGemini({
      systemPrompt: "Reply with OK",
      messages: [{ role: "user", content: "health" }],
      maxTokens: 8,
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
      maxTokens: 8,
    });
    return true;
  } catch {
    return false;
  }
}
