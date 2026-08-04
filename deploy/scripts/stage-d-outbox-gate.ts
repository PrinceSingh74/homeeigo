/** Stage D outbox gate — raw SQL fixtures to avoid deferred-column P2022 on staging. */
import prisma from "/app/src/lib/prisma.ts";
import { emitInTransaction } from "/app/src/events/core/event-publisher.ts";
import { buildBookingCreatedEvent } from "/app/src/events/catalog/booking.events.ts";
import { EVENT_TYPES } from "/app/src/events/catalog/event-types.ts";

const tag = `sd_ob_${Date.now()}`;
const gates: { id: string; status: string; detail: string }[] = [];
const push = (id: string, ok: boolean, detail: string) =>
  gates.push({ id, status: ok ? "PASS" : "FAIL", detail });

async function main() {
  push(
    "preflight",
    process.env.STAGING_EVENTS_CERTIFICATION === "1" &&
      process.env.EVENTS_OUTBOX_ENABLED === "true" &&
      process.env.EVENTS_CONSUMERS_ENABLED !== "true",
    JSON.stringify({
      cert: process.env.STAGING_EVENTS_CERTIFICATION,
      outbox: process.env.EVENTS_OUTBOX_ENABLED,
      consumers: process.env.EVENTS_CONSUMERS_ENABLED,
    }),
  );

  type Row = { user_id: string; address_id: string; service_id: string; city: string; category: string };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT u.id AS user_id, a.id AS address_id, s.id AS service_id, COALESCE(a.city,'Delhi') AS city, s.category
    FROM users u
    JOIN addresses a ON a.user_id = u.id
    CROSS JOIN services s
    WHERE u.role = 'CUSTOMER' AND s.is_active = true AND s.category = 'cleaning'
    LIMIT 1`;
  if (!rows[0]) {
    push("fixtures", false, "no customer/address/service");
    console.log(JSON.stringify({ phase: "outbox-only", tag, gates, summary: "BLOCKED" }, null, 2));
    process.exit(2);
  }
  const { user_id, address_id, service_id, city, category } = rows[0];
  push("fixtures", true, `user=${user_id} service=${service_id}`);

  const bookingNumber = `HG-${tag}`;
  const bookingRows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO bookings (id, booking_number, user_id, service_id, address_id, status, scheduled_date, base_amount, final_amount, total_amount, payment_method, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${bookingNumber}, ${user_id}, ${service_id}, ${address_id}, 'PENDING'::"BookingStatus", NOW() + interval '1 day', 500, 500, 500, 'razorpay', NOW(), NOW())
    RETURNING id`;
  const bookingId = bookingRows[0].id;
  push("booking.create", true, bookingId);

  const ev = buildBookingCreatedEvent({
    bookingId,
    bookingNumber,
    userId: user_id,
    serviceId: service_id,
    serviceCategory: category,
    city,
    providerId: null,
    status: "PENDING",
    finalAmount: 500,
    paymentMethod: "razorpay",
    scheduledAt: new Date(Date.now() + 86400000),
  });
  await prisma.$transaction(async (tx) => emitInTransaction(tx, ev));

  let outboxRow = await prisma.eventOutbox.findUnique({ where: { eventId: ev.id } });
  push(
    "outbox.persisted",
    outboxRow?.status === "PENDING" || outboxRow?.status === "PROCESSING" || outboxRow?.status === "PUBLISHED",
    outboxRow ? `${outboxRow.eventType} status=${outboxRow.status}` : "missing",
  );

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    outboxRow = await prisma.eventOutbox.findUnique({ where: { eventId: ev.id } });
    if (outboxRow?.status === "PUBLISHED") break;
  }
  push(
    "outbox.processor",
    outboxRow?.status === "PUBLISHED",
    `status=${outboxRow?.status} attempts=${outboxRow?.attempts}`,
  );

  const receipts = await prisma.eventConsumerReceipt.count({ where: { eventId: ev.id } });
  push("consumers.off", receipts === 0, `receipts=${receipts}`);

  const failed = gates.filter((g) => g.status === "FAIL").length;
  console.log(
    JSON.stringify({ phase: "outbox-only", tag, bookingId, eventType: EVENT_TYPES.BOOKING_CREATED, gates, summary: failed ? "FAIL" : "PASS" }, null, 2),
  );
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
