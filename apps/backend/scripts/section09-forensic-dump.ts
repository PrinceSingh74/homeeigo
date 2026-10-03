/**
 * Read-only Section 09 forensic dump. Does not delete or mutate rows.
 */
import prisma from "../src/lib/prisma";

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/email|phone|token|secret|password|account|ifsc|pan|aadhaar|name/i.test(k)) {
      out[k] = typeof v === "string" ? `[redacted:${v.length}]` : "[redacted]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

async function main() {
  const [dlq, failedOutbox, pendingOutbox, receipts, prefs, deliveries] = await Promise.all([
    prisma.eventDeadLetter.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.eventOutbox.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "asc" } }),
    prisma.eventOutbox.findMany({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    prisma.eventConsumerReceipt.findMany({ take: 1 }),
    prisma.notificationPreference.count(),
    prisma.notificationDelivery.groupBy({ by: ["status"], _count: true }),
  ]);

  const eventIds = [...new Set([...dlq.map((d) => d.eventId), ...failedOutbox.map((o) => o.eventId)])];
  const relatedReceipts = eventIds.length
    ? await prisma.eventConsumerReceipt.findMany({ where: { eventId: { in: eventIds } } })
    : [];
  const relatedOutbox = eventIds.length
    ? await prisma.eventOutbox.findMany({
        where: { eventId: { in: eventIds } },
        select: {
          eventId: true,
          eventType: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          publishedAt: true,
          aggregateType: true,
          aggregateId: true,
        },
      })
    : [];

  console.log(
    JSON.stringify(
      {
        dumpedAt: new Date().toISOString(),
        counts: {
          dlq: dlq.length,
          unresolvedDlq: dlq.filter((d) => !d.resolvedAt).length,
          failedOutbox: failedOutbox.length,
          pendingOrProcessing: pendingOutbox.length,
          notificationPreferences: prefs,
          deliveries,
          receiptSampleExists: receipts.length > 0,
        },
        dlq: dlq.map((d) => ({
          id: d.id,
          eventId: d.eventId,
          eventType: d.eventType,
          consumerName: d.consumerName,
          attempts: d.attempts,
          error: d.error.slice(0, 500),
          createdAt: d.createdAt,
          lastAttemptAt: d.lastAttemptAt,
          resolvedAt: d.resolvedAt,
          resolution: d.resolution,
          payloadMeta: redact(
            typeof d.payload === "object" && d.payload && "homigo" in (d.payload as object)
              ? (d.payload as { homigo?: unknown }).homigo
              : { keys: Object.keys((d.payload as object) ?? {}) },
          ),
        })),
        failedOutbox: failedOutbox.map((o) => ({
          id: o.id,
          eventId: o.eventId,
          eventType: o.eventType,
          aggregateType: o.aggregateType,
          aggregateId: o.aggregateId,
          attempts: o.attempts,
          lastError: o.lastError?.slice(0, 500) ?? null,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
          publishedAt: o.publishedAt,
          availableAt: o.availableAt,
        })),
        relatedOutbox,
        relatedReceipts: relatedReceipts.map((r) => ({
          consumerName: r.consumerName,
          eventId: r.eventId,
          result: r.result,
          errorMessage: r.errorMessage?.slice(0, 200) ?? null,
          processedAt: r.processedAt,
        })),
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
