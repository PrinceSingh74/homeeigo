import type { AiGatewayRole, AiProviderType, AiRequestStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { hashContent } from "../security/prompt-security";

export type AiAuditInput = {
  requestId: string;
  actorId?: string;
  actorRole: AiGatewayRole;
  action: string;
  reason?: string;
  promptHash: string;
  responseHash?: string;
  provider?: AiProviderType;
  latencyMs?: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  status: AiRequestStatus;
  ipAddress?: string;
  traceId?: string;
};

export async function recordAiAudit(input: AiAuditInput): Promise<void> {
  await prisma.aiGatewayAudit.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      reason: input.reason,
      promptHash: input.promptHash,
      responseHash: input.responseHash,
      provider: input.provider,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costUsd: input.costUsd,
      status: input.status,
      ipAddress: input.ipAddress,
      traceId: input.traceId,
    },
  });
}

export async function recordAiRequest(input: {
  requestId: string;
  actorId?: string;
  actorRole: AiGatewayRole;
  templateId?: string;
  /** Prompt-registry version that served the request, when one was resolved. */
  promptVersion?: number;
  promptHash: string;
  responseHash?: string;
  provider?: AiProviderType;
  status: AiRequestStatus;
  latencyMs?: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  fallbackUsed: boolean;
  errorCode?: string;
  ipAddress?: string;
  traceId?: string;
}): Promise<void> {
  await prisma.aiGatewayRequest.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      templateId: input.templateId,
      promptVersion: input.promptVersion,
      promptHash: input.promptHash,
      responseHash: input.responseHash,
      provider: input.provider,
      status: input.status,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      cachedTokens: input.cachedTokens,
      costUsd: input.costUsd,
      fallbackUsed: input.fallbackUsed,
      errorCode: input.errorCode,
      ipAddress: input.ipAddress,
      traceId: input.traceId,
    },
  });
}

export function hashResponse(content: string): string {
  return hashContent(content);
}
