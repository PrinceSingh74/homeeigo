import { WebhookEventStatus } from "@prisma/client";
import prisma from "../lib/prisma";

const STALE_PROCESSING_MS = 5 * 60 * 1000;

export type WebhookBeginResult = "PROCESS" | "SKIP" | "RETRY";

export class WebhookDedupService {
  /**
   * Claim an event for processing. Returns SKIP for already-processed events,
   * RETRY for failed/stale events, PROCESS for new claims.
   */
  async beginProcessing(
    eventId: string,
    eventType: string,
    gatewayEventId?: string,
  ): Promise<WebhookBeginResult> {
    const existing = await prisma.webhookEventDedup.findUnique({ where: { eventId } });
    if (!existing) {
      await prisma.webhookEventDedup.create({
        data: {
          eventId,
          eventType,
          gatewayEventId,
          status: WebhookEventStatus.PROCESSING,
          attempts: 1,
        },
      });
      return "PROCESS";
    }

    if (existing.status === WebhookEventStatus.PROCESSED) return "SKIP";

    const staleProcessing =
      existing.status === WebhookEventStatus.PROCESSING &&
      Date.now() - existing.updatedAt.getTime() > STALE_PROCESSING_MS;

    if (existing.status === WebhookEventStatus.PROCESSING && !staleProcessing) {
      return "SKIP";
    }

    if (existing.status === WebhookEventStatus.FAILED || staleProcessing) {
      await prisma.webhookEventDedup.update({
        where: { eventId },
        data: {
          status: WebhookEventStatus.PROCESSING,
          attempts: { increment: 1 },
          gatewayEventId: gatewayEventId ?? existing.gatewayEventId,
          lastError: null,
        },
      });
      return "RETRY";
    }

    await prisma.webhookEventDedup.update({
      where: { eventId },
      data: {
        status: WebhookEventStatus.PROCESSING,
        attempts: { increment: 1 },
        gatewayEventId: gatewayEventId ?? existing.gatewayEventId,
      },
    });
    return "PROCESS";
  }

  async markProcessed(eventId: string): Promise<void> {
    await prisma.webhookEventDedup.update({
      where: { eventId },
      data: { status: WebhookEventStatus.PROCESSED, lastError: null },
    });
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    await prisma.webhookEventDedup.update({
      where: { eventId },
      data: { status: WebhookEventStatus.FAILED, lastError: error.slice(0, 2000) },
    });
  }

  /** @deprecated Use beginProcessing — kept for backward-compatible tests. */
  async claimEvent(eventId: string, eventType: string): Promise<boolean> {
    const result = await this.beginProcessing(eventId, eventType);
    return result === "PROCESS" || result === "RETRY";
  }
}

export const webhookDedupService = new WebhookDedupService();
