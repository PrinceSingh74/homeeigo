import prisma from "../../src/lib/prisma";
import { ANALYTICS_CONFIG } from "../config";

export type WatermarkState = {
  lowWatermark: Date | null;
  highWatermark: Date | null;
  cursorId: string | null;
  rowsSynced: bigint;
  lastSyncAt: Date | null;
};

export async function getWatermark(jobId: string, dataset: string): Promise<WatermarkState> {
  const row = await prisma.etlWatermark.findUnique({ where: { jobId } });
  if (row) {
    return {
      lowWatermark: row.lowWatermark,
      highWatermark: row.highWatermark,
      cursorId: row.cursorId,
      rowsSynced: row.rowsSynced,
      lastSyncAt: row.lastSyncAt,
    };
  }
  const created = await prisma.etlWatermark.create({
    data: { jobId, dataset, pipelineVersion: ANALYTICS_CONFIG.pipelineVersion },
  });
  return {
    lowWatermark: created.lowWatermark,
    highWatermark: created.highWatermark,
    cursorId: created.cursorId,
    rowsSynced: created.rowsSynced,
    lastSyncAt: created.lastSyncAt,
  };
}

export async function updateWatermark(
  jobId: string,
  update: Partial<WatermarkState> & { rowsDelta?: number },
): Promise<void> {
  const existing = await prisma.etlWatermark.findUnique({ where: { jobId } });
  if (!existing) return;
  await prisma.etlWatermark.update({
    where: { jobId },
    data: {
      lowWatermark: update.lowWatermark ?? existing.lowWatermark,
      highWatermark: update.highWatermark ?? existing.highWatermark,
      cursorId: update.cursorId !== undefined ? update.cursorId : existing.cursorId,
      rowsSynced: update.rowsDelta
        ? existing.rowsSynced + BigInt(update.rowsDelta)
        : existing.rowsSynced,
      lastSyncAt: new Date(),
      pipelineVersion: ANALYTICS_CONFIG.pipelineVersion,
    },
  });
}

export async function resetWatermark(jobId: string): Promise<void> {
  await prisma.etlWatermark.update({
    where: { jobId },
    data: { lowWatermark: null, highWatermark: null, cursorId: null, rowsSynced: 0n },
  });
}
