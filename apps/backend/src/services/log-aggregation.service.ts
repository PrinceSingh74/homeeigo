import type { AppLogCategory } from "@prisma/client";
import prisma from "../lib/prisma";
import { getRingBufferLogs, registerLogPersister, type RingEntry } from "../lib/logger";
import { buildCursorResult, decodeCursor, parseCursorLimit } from "../lib/cursor-pagination";

export type LogSearchQuery = {
  requestId?: string;
  traceId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  category?: AppLogCategory;
  level?: string;
  search?: string;
  cursor?: string;
  limit?: string | number;
  startDate?: string;
  endDate?: string;
};

let persisterRegistered = false;

function ensurePersister(): void {
  if (persisterRegistered) return;
  persisterRegistered = true;
  registerLogPersister((entry: RingEntry) => {
    void prisma.appLogEntry
      .create({
        data: {
          level: entry.level,
          category: entry.category,
          message: entry.message,
          requestId: entry.requestId,
          traceId: entry.traceId,
          userId: entry.userId,
          bookingId: entry.bookingId,
          paymentId: entry.paymentId,
          metadata: entry.meta ? JSON.stringify(entry.meta) : undefined,
        },
      })
      .catch(() => undefined);
  });
}

export class LogAggregationService {
  constructor() {
    ensurePersister();
  }

  async search(query: LogSearchQuery) {
    const limit = parseCursorLimit(query.limit, 100);
    const cursor = decodeCursor(query.cursor);
    const where: Record<string, unknown> = {};

    if (query.requestId) where.requestId = query.requestId;
    if (query.traceId) where.traceId = query.traceId;
    if (query.userId) where.userId = query.userId;
    if (query.bookingId) where.bookingId = query.bookingId;
    if (query.paymentId) where.paymentId = query.paymentId;
    if (query.category) where.category = query.category;
    if (query.level) where.level = query.level;
    if (query.search) where.message = { contains: query.search, mode: "insensitive" };
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await prisma.appLogEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = buildCursorResult(rows, limit);
    return {
      logs: page.items.map((r) => ({
        id: r.id,
        level: r.level,
        category: r.category,
        message: r.message,
        requestId: r.requestId,
        traceId: r.traceId,
        userId: r.userId,
        bookingId: r.bookingId,
        paymentId: r.paymentId,
        metadata: r.metadata ? safeJson(r.metadata) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async exportJson(query: LogSearchQuery, maxRows = 5000) {
    const result = await this.search({ ...query, limit: maxRows });
    return result.logs;
  }

  async exportCsv(query: LogSearchQuery, maxRows = 5000) {
    const logs = await this.exportJson(query, maxRows);
    const header = "id,level,category,message,requestId,traceId,userId,bookingId,paymentId,createdAt";
    const lines = logs.map((l) =>
      [
        l.id,
        l.level,
        l.category,
        csvEscape(l.message),
        l.requestId ?? "",
        l.traceId ?? "",
        l.userId ?? "",
        l.bookingId ?? "",
        l.paymentId ?? "",
        l.createdAt,
      ].join(","),
    );
    return [header, ...lines].join("\n");
  }

  getRecentFromBuffer(limit = 200) {
    return getRingBufferLogs(limit);
  }

  async stats() {
    const [total, last24h, byCategory] = await Promise.all([
      prisma.appLogEntry.count(),
      prisma.appLogEntry.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      prisma.appLogEntry.groupBy({
        by: ["category"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
    ]);
    return {
      total,
      last24h,
      ringBufferSize: getRingBufferLogs(1).length >= 0 ? getRingBufferLogs(10000).length : 0,
      byCategory: byCategory.map((r) => ({ category: r.category, count: r._count.id })),
    };
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const logAggregationService = new LogAggregationService();
