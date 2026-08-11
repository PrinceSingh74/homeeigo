import type { AiGatewayRole, AiProviderType, AiRequestStatus } from "@prisma/client";

export type AiMessage = { role: "user" | "assistant" | "system"; content: string };

export type AiGatewayContext = {
  userId?: string;
  partnerId?: string;
  bookingId?: string;
  customerId?: string;
  location?: { lat: number; lng: number; city?: string };
  metadata?: Record<string, unknown>;
};

export type AiGatewayInput = {
  message: string;
  templateId?: string;
  conversationId?: string;
  context?: AiGatewayContext;
  history?: AiMessage[];
  responseSchema?: Record<string, unknown>;
  stream?: boolean;
};

export type AiProviderResponse = {
  content: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  provider: AiProviderType;
  model: string;
  latencyMs: number;
  /** Provider's own stop reason, normalised to a string. Undefined when not reported. */
  finishReason?: string;
};

/** One attempt against one provider — the unit the router audits and returns. */
export type ProviderAttempt = {
  attemptId: string;
  provider: AiProviderType;
  outcome: "SUCCESS" | "FAILURE";
  errorCode?: string;
  httpStatus?: number;
  latencyMs: number;
  cooldownMs?: number;
};

export type AiGatewayResult = {
  fallbackDepth: number;
  finishReason?: string;
  costStatus: "COMPUTED" | "UNKNOWN";
  requestId: string;
  content: string;
  provider: AiProviderType;
  model: string;
  status: AiRequestStatus;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  fallbackUsed: boolean;
  templateId?: string;
  conversationId?: string;
};

export type AiActorContext = {
  actorId: string;
  actorRole: AiGatewayRole;
  ipAddress?: string;
  traceId?: string;
  organizationId?: string;
};

export type AiAuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export const AI_TIMEOUT_MS = {
  anthropic: 20_000,
  gemini: 20_000,
  groq: 20_000,
  openai: 20_000,
  gateway: 25_000,
} as const;

export const AI_LIMITS = {
  maxMessageLength: 8_000,
  maxHistoryTurns: 20,
  maxPromptTokens: 16_000,
  maxSystemPromptLength: 4_000,
} as const;

export type AiTemplateCategory =
  | "customer"
  | "partner"
  | "admin"
  | "fraud"
  | "finance"
  | "operations"
  | "analytics"
  | "eta"
  | "support";
