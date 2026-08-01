import { logger } from "../../lib/logger";
import type { HomigoEvent } from "../core/homigo-event";

/** AI context indexer stub — Phase 4 Context Engine will replace this boundary. */
export async function aiContextIndexerConsumer(event: HomigoEvent): Promise<void> {
  logger.info("ai_context_indexer_stub", {
    eventId: event.id,
    eventType: event.type,
    aggregateType: event.homigo.aggregateType,
    aggregateId: event.homigo.aggregateId,
    correlationId: event.homigo.correlationId,
  });
}

export const AI_CONTEXT_INDEXER_CONSUMER_NAME = "ai-context-indexer.v1";
