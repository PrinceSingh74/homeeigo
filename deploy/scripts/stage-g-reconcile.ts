/** Stage G — Read-only final reconciliation for controlled soak entities. */
import prisma from "/app/src/lib/prisma.ts";

const STAGE_G_RUN_ID = process.env.STAGE_G_RUN_ID ?? "";

async function main() {
  const runMarker = STAGE_G_RUN_ID || "stageG";
  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { user: { email: { contains: runMarker } } },
        { service: { slug: { contains: "stageG" } } },
      ],
    },
    select: {
      id: true,
      status: true,
      bookingNumber: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const bookingIds = bookings.map((b) => b.id);
  const outboxRows = bookingIds.length
    ? await prisma.eventOutbox.findMany({
        where: { aggregateId: { in: bookingIds } },
        select: { eventId: true, eventType: true, status: true, aggregateId: true, createdAt: true, publishedAt: true },
      })
    : [];

  const dlqRows = await prisma.eventDeadLetter.findMany({
    where: { resolvedAt: null },
    select: { id: true, eventId: true, eventType: true, consumerName: true, attempts: true, error: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const stageGPayments = await prisma.payment.findMany({
    where: { booking: { user: { email: { contains: runMarker } } } },
    select: { id: true, status: true, amount: true, razorpayOrderId: true, createdAt: true },
  });

  const lost = outboxRows.filter((r) => r.status === "FAILED").length;
  const stranded = outboxRows.filter((r) => ["PENDING", "PROCESSING"].includes(r.status)).length;
  const published = outboxRows.filter((r) => r.status === "PUBLISHED").length;

  console.log(
    JSON.stringify(
      {
        STAGE_G_RUN_ID: runMarker,
        BOOKINGS_FOUND: bookings.length,
        BOOKINGS_COMPLETED: bookings.filter((b) => b.status === "COMPLETED").length,
        BOOKINGS: bookings.map((b) => ({ id: b.id, status: b.status, number: b.bookingNumber })),
        EVENTS_GENERATED: outboxRows.length,
        EVENTS_PUBLISHED: published,
        EVENTS_STRANDED: stranded,
        EVENTS_FAILED: lost,
        LOST: lost,
        STRANDED: stranded,
        DLQ_UNRESOLVED: dlqRows.length,
        DLQ_ENTRIES: dlqRows.map((d) => ({
          id: d.id,
          eventType: d.eventType,
          consumerName: d.consumerName,
          attempts: d.attempts,
          errorClass: d.error?.slice(0, 120) ?? null,
        })),
        PAYMENTS: stageGPayments.map((p) => ({ id: p.id, status: p.status, orderId: p.razorpayOrderId })),
        MIGRATION_CHECK: "external",
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
