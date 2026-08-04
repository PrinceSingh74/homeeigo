#!/usr/bin/env node
/** Stage D outbox-only gate — booking create + outbox row + processor PUBLISHED (consumers may be OFF). */
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const p = new PrismaClient();
const tag = `sd_outbox_${Date.now()}`;

async function main() {
  const report = { tag, phase: 'outbox-only', gates: [], at: new Date().toISOString() };
  const push = (id, ok, detail) => report.gates.push({ id, status: ok ? 'PASS' : 'FAIL', detail });

  const cfg = {
    outbox: process.env.EVENTS_OUTBOX_ENABLED === 'true',
    consumers: process.env.EVENTS_CONSUMERS_ENABLED === 'true',
    cert: process.env.STAGING_EVENTS_CERTIFICATION === '1',
  };
  push('preflight.flags', cfg.cert && cfg.outbox, JSON.stringify(cfg));
  if (!cfg.cert || !cfg.outbox) {
    console.log(JSON.stringify(report));
    process.exit(2);
  }

  const customer = await p.user.findFirst({
    where: { role: 'CUSTOMER' },
    include: { addresses: { take: 1 } },
  });
  const service = await p.service.findFirst({ where: { isActive: true, category: 'cleaning' } });
  if (!customer?.addresses[0] || !service) {
    push('fixtures', false, 'missing customer/service');
    console.log(JSON.stringify(report));
    process.exit(2);
  }

  const booking = await p.booking.create({
    data: {
      bookingNumber: `HG-${tag}`,
      userId: customer.id,
      serviceId: service.id,
      addressId: customer.addresses[0].id,
      status: 'PENDING',
      scheduledDate: new Date(Date.now() + 86400000),
      finalAmount: 500,
      paymentMethod: 'razorpay',
    },
  });
  push('booking.created', true, booking.id);

  const { emitInTransaction } = require('/app/dist/events/core/event-publisher');
  const { buildBookingCreatedEvent } = require('/app/dist/events/catalog/booking.events');
  const ev = buildBookingCreatedEvent({
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    userId: customer.id,
    serviceId: service.id,
    serviceCategory: service.category,
    city: customer.addresses[0].city ?? 'Delhi',
    providerId: null,
    status: 'PENDING',
    finalAmount: 500,
    paymentMethod: 'razorpay',
    scheduledAt: booking.scheduledDate,
  });
  await p.$transaction(async (tx) => emitInTransaction(tx, ev));

  const pending = await p.eventOutbox.findUnique({ where: { eventId: ev.id } });
  push('outbox.persisted', pending?.status === 'PENDING', pending ? `status=${pending.status} type=${pending.eventType}` : 'missing');

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const row = await p.eventOutbox.findUnique({ where: { eventId: ev.id } });
    if (row?.status === 'PUBLISHED') {
      push('outbox.processor', true, `published after ${(i + 1) * 5}s attempts=${row.attempts}`);
      const receipts = await p.eventConsumerReceipt.count({ where: { eventId: ev.id } });
      push('consumers.state', true, `receipts=${receipts} consumersEnabled=${cfg.consumers}`);
      console.log(JSON.stringify(report));
      await p.$disconnect();
      process.exit(0);
    }
  }
  const last = await p.eventOutbox.findUnique({ where: { eventId: ev.id } });
  push('outbox.processor', false, `still ${last?.status} after 60s`);
  console.log(JSON.stringify(report));
  await p.$disconnect();
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
