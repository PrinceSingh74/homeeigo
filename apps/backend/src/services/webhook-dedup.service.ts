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
      // The unique eventId is the arbiter: of two concurrent first deliveries exactly one insert
      // wins. The loser used to throw P2002 outside the route's try block (a 500); it now skips.
      try {
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
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") return "SKIP";
        throw e;
      }
    }

    if (existing.status === WebhookEventStatus.PROCESSED) return "SKIP";

    const staleProcessing =
      existing.status === WebhookEventStatus.PROCESSING &&
      Date.now() - existing.updatedAt.getTime() > STALE_PROCESSING_MS;

    if (existing.status === WebhookEventStatus.PROCESSING && !staleProcessing) {
      return "SKIP";
    }

    if (existing.status === WebhookEventStatus.FAILED || staleProcessing) {
      // Compare-and-set takeover: only the caller whose update still sees the FAILED / stale row
      // wins. An unconditional update let two concurrent retries BOTH process the same money event.
      const taken = await prisma.webhookEventDedup.updateMany({
        where: {
          eventId,
          OR: [
            { status: WebhookEventStatus.FAILED },
            { status: WebhookEventStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
          ],
        },
        data: {
          status: WebhookEventStatus.PROCESSING,
          attempts: { increment: 1 },
          gatewayEventId: gatewayEventId ?? existing.gatewayEventId,
          lastError: null,
        },
      });
      return taken.count === 1 ? "RETRY" : "SKIP";
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
