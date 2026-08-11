import type { AiGatewayRole, AiProviderType, AiRequestStatus } from "@prisma/client";

export type AiMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Set on tool messages so the provider can pair a result with its request. */
  toolCallId?: string;
  /** Set on assistant messages that carried tool calls, so the turn replays correctly. */
  toolCalls?: ProviderToolCall[];
};

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

/** A tool the model asked to run. Never trusted — validated server-side before execution. */
export type ProviderToolCall = {
  /** Provider-assigned id, echoed back so the model can match result to request. */
  id: string;
  /** Provider-safe function name; maps back to a registry tool id. */
  name: string;
  /** Raw JSON string from the model. Parsed and schema-checked, never eval'd. */
  argumentsJson: string;
};

export type AiProviderResponse = {
  content: string;
  /** Present when the model requested tools instead of (or alongside) answering. */
  toolCalls?: ProviderToolCall[];
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
