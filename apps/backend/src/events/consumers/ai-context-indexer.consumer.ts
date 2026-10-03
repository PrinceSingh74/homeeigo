import { logger } from "../../lib/logger";
import type { HomigoEvent } from "../core/homigo-event";

/**
 * AI context indexer — still a stub, and its stated replacement has already arrived.
 *
 * The note here said "Phase 4 Context Engine will replace this boundary". That engine shipped:
 * `src/ai-brain/context/` has collectors, a cache and a snapshot builder, and
 * `knowledge-{ingestion,embedding,retrieval}.service.ts` do the indexing. None of them use this
 * consumer. It was not replaced; it was left subscribed to everything.
 *
 * Measured cost on 2026-09-21 — it is registered with `eventTypes: "*"`, so it claims a receipt for
 * every event the platform emits:
 *
 *   event_consumer_receipts, by consumer:
 *     ai-context-indexer.v1   8,371     ← this, which only logs
 *     metrics.v1              8,371
 *     audit.v1                2,788
 *     ...                     21,765 total, 11 MB
 *
 * 38% of the receipts table exists to record that a log line was written. It is not a correctness
 * defect and nothing reads those rows except this consumer's own idempotency claim, but it grows
 * linearly with event volume forever.
 *
 * Deliberately NOT removed here. Because it is the only wildcard consumer, its receipts happen to
 * form a delivery ledger covering every event — an accidental property, but a real one, and
 * deleting a consumer registration on that basis is an owner's call rather than an audit's. The
 * options are: wire it to `knowledge-ingestion.service`, narrow `eventTypes` to what an indexer
 * would actually want, or drop it and keep delivery visibility in the outbox.
 */
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
