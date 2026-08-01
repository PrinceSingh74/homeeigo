import type { EventOutbox } from "@prisma/client";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { incCounter, observeHist } from "../../lib/metrics";
import { runWithLeaderLock } from "../../lib/distributed-scheduler";
import { eventPlatformConfig } from "./config";
import { dispatchEvent } from "./event-bus";
import { computeRetryDelayMs } from "./retry";
import { validateEventEnvelope } from "./validation";
import { refreshEventPlatformGauges } from "./retention";

let processorTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

type ClaimedRow = {
  id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

/** Recover stale PROCESSING claims — crash-safe lease expiry. */
async function recoverStaleClaims(): Promise<number> {
  const cutoff = new Date(Date.now() - eventPlatformConfig.lockTimeoutMs);
  const result = await prisma.eventOutbox.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: cutoff },
    },
    data: {
      status: "PENDING",
      lockedAt: null,
      lockedBy: null,
    },
  });
  if (result.count > 0) {
    logger.warn("outbox_stale_claims_recovered", { count: result.count });
  }
  return result.count;
}

async function claimBatch(): Promise<ClaimedRow[]> {
  const instanceId = eventPlatformConfig.instanceId();
  const batchSize = eventPlatformConfig.batchSize;
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE event_outbox AS o
    SET
      status = 'PROCESSING'::"EventOutboxStatus",
      locked_at = NOW(),
      locked_by = ${instanceId},
      attempts = o.attempts + 1,
      updated_at = NOW()
    WHERE o.id IN (
      SELECT id
      FROM event_outbox
      WHERE status IN ('PENDING'::"EventOutboxStatus", 'FAILED'::"EventOutboxStatus")
        AND available_at <= NOW()
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o.event_id, o.event_type, o.payload, o.attempts
  `;
  return rows;
}

async function markPublished(id: string): Promise<void> {
  await prisma.eventOutbox.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
  incCounter("homigo_outbox_publish_total", { result: "success" });
}

async function markFailed(id: string, attempts: number, error: string): Promise<void> {
  const maxAttempts = eventPlatformConfig.maxAttempts;
  if (attempts >= maxAttempts) {
    await prisma.eventOutbox.update({
      where: { id },
      data: {
        status: "FAILED",
        lastError: error.slice(0, 4000),
        lockedAt: null,
        lockedBy: null,
      },
    });
    incCounter("homigo_outbox_publish_total", { result: "failed_terminal" });
    return;
  }
  await prisma.eventOutbox.update({
    where: { id },
    data: {
      status: "PENDING",
      lastError: error.slice(0, 4000),
      lockedAt: null,
      lockedBy: null,
      availableAt: computeRetryDelayMs(attempts),
    },
  });
  incCounter("homigo_outbox_publish_total", { result: "retry" });
}

async function publishRow(row: ClaimedRow): Promise<void> {
  const start = Date.now();
  try {
    const event = validateEventEnvelope(row.payload);
    await dispatchEvent(event);
    await markPublished(row.id);
    observeHist("homigo_outbox_processing_duration_seconds", (Date.now() - start) / 1000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(row.id, row.attempts, message);
    logger.error("outbox_publish_failed", {
      eventId: row.event_id,
      eventType: row.event_type,
      attempts: row.attempts,
      error: message,
    });
  }
}

async function refreshOutboxGauges(): Promise<void> {
  await refreshEventPlatformGauges();
}

export async function processOutboxBatch(): Promise<{ claimed: number; recovered: number }> {
  if (!eventPlatformConfig.outboxEnabled || shuttingDown) return { claimed: 0, recovered: 0 };

  const recovered = await recoverStaleClaims();
  const rows = await claimBatch();
  for (const row of rows) {
    if (shuttingDown) break;
    await publishRow(row);
  }
  await refreshOutboxGauges();
  return { claimed: rows.length, recovered };
}

export async function runOutboxProcessorTick(): Promise<void> {
  await runWithLeaderLock("maintenance:event_outbox", Math.ceil(eventPlatformConfig.intervalMs / 1000) + 5, async () => {
    await processOutboxBatch();
  });
}

/** Delete published outbox rows older than retention policy (leader-locked caller). */
export async function cleanupPublishedOutbox(): Promise<number> {
  const cutoff = new Date(Date.now() - eventPlatformConfig.publishedRetentionDays * 86_400_000);
  const result = await prisma.eventOutbox.deleteMany({
    where: { status: "PUBLISHED", publishedAt: { lt: cutoff } },
  });
  return result.count;
}

export function startOutboxProcessor(): void {
  if (processorTimer || !eventPlatformConfig.outboxEnabled) return;
  void runOutboxProcessorTick();
  processorTimer = setInterval(() => void runOutboxProcessorTick(), eventPlatformConfig.intervalMs);
  (processorTimer as { unref?: () => void }).unref?.();
}

export function stopOutboxProcessor(): void {
  shuttingDown = true;
  if (processorTimer) clearInterval(processorTimer);
  processorTimer = null;
}

export type { EventOutbox };
