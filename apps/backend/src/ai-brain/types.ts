import type { AiGatewayRole, AiMemoryType, AiProviderType, AiRequestStatus } from "@prisma/client";
import type { AiGatewayContext, AiMessage } from "../ai/types";

export type ContextBuildRequest = {
  actorId: string;
  actorRole: AiGatewayRole;
  message: string;
  intent?: string;
  context?: AiGatewayContext;
  history?: AiMessage[];
  conversationId?: string;
  sessionId?: string;
  organizationId?: string;
  tenantId?: string;
  language?: string;
  timezone?: string;
  featureFlags?: Record<string, boolean>;
};

export type ContextSection = {
  name: string;
  content: string;
  priority: number;
  tokenEstimate: number;
};

export type EnterpriseBuiltContext = {
  systemContext: string;
  messages: AiMessage[];
  sections: ContextSection[];
  metadata: Record<string, unknown>;
  contextHash: string;
  contextSize: number;
  tokenBudget: number;
  trimmed: boolean;
};

export type MemoryStoreInput = {
  memoryKey: string;
  memoryType: AiMemoryType;
  ownerId?: string;
  tenantId?: string;
  content: Record<string, unknown>;
  summary?: string;
  priority?: number;
  importance?: number;
  confidence?: number;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
};

export type MemorySearchQuery = {
  ownerId?: string;
  tenantId?: string;
  memoryType?: AiMemoryType;
  query?: string;
  limit?: number;
  minImportance?: number;
  includeArchived?: boolean;
};

export type PromptRegistryEntry = {
  promptId: string;
  name: string;
  category: string;
  owner: string;
  description?: string;
  activeVersion?: PromptVersionEntry;
};

export type PromptVersionEntry = {
  version: number;
  systemPrompt: string;
  userTemplate?: string;
  variables?: Record<string, string>;
  temperature: number;
  maxTokens: number;
  safetyLevel: string;
  fallbackPromptId?: string;
};

export type ComposedPrompt = {
  systemPrompt: string;
  userPrompt: string;
  promptId: string;
  promptVersion: number;
  tokenEstimate: number;
  compressionRatio: number;
};

export type TimelineEntry = {
  requestId: string;
  traceId?: string;
  actorId?: string;
  actorRole: AiGatewayRole;
  promptId?: string;
  promptVersion?: number;
  model?: string;
  provider?: AiProviderType;
  contextHash?: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs?: number;
  costUsd: number;
  status: AiRequestStatus;
  fallbackUsed: boolean;
  blocked: boolean;
  blockReason?: string;
  resultHash?: string;
  metadata?: Record<string, unknown>;
};

export const CONTEXT_TOKEN_BUDGET = {
  default: 12_000,
  max: 16_000,
  systemReserve: 2_000,
  responseReserve: 2_048,
} as const;

export const MEMORY_DEFAULTS = {
  sessionTtlSeconds: 3_600,
  conversationTtlSeconds: 86_400 * 7,
  workingTtlSeconds: 1_800,
  semanticTtlSeconds: 86_400 * 30,
} as const;
