/**
 * Seed a live Section 03 OFFERED job for partner@homigo.demo — non-mocked Playwright.
 *
 * Creates PENDING booking + AssignmentJob + SENT AssignmentAttempt so the partner
 * inbox shows Accept. Payment SUCCESS so the payment gate allows accept.
 *
 * Usage: cd apps/backend && bun run scripts/section03-seed-live-job.ts
 * Prints JSON fixture for E2E.
 */
import "dotenv/config";
import { requireDeclaredTarget } from "./lib/script-target";
import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  PaymentStatus,
  PrismaClient,
} from "@prisma/client";
requireDeclaredTarget({ label: "section03-seed-live-job" });

const prisma = new PrismaClient();
const RUN = `s03live-${Date.now().toString(36)}`;
const JOB_LAT = 12.9716;
const JOB_LNG = 77.5946;
const INSIDE = { lat: 12.9717, lng: 77.5947 };
const OUTSIDE = { lat: 28.6139, lng: 77.209 };

async function main() {
  const partnerUser = await prisma.user.findFirst({
    where: { email: "partner@homigo.demo" },
    include: { provider: true },
  });
  if (!partnerUser?.provider) {
    throw new Error("partner@homigo.demo / provider not found — run db seed");
  }

  const p = partnerUser.provider;
  await prisma.provider.update({
    where: { id: p.id },
    data: {
      isOnline: true,
      pausedAt: null,
      pauseReason: null,
      isActive: true,
      isApproved: true,
      // Approved + active is ACTIVE (20260829140000 backfill rule); APPLIED is outside dispatch.
      lifecycleState: "ACTIVE",
      isBanned: false,
      complianceRestricted: false,
      maxConcurrentJobs: Math.max(p.maxConcurrentJobs ?? 2, 10),
      city: p.city ?? "Bengaluru",
      serviceRadiusKm: p.serviceRadiusKm ?? 10,
      baseLatitude: p.baseLatitude ?? JOB_LAT,
      baseLongitude: p.baseLongitude ?? JOB_LNG,
      ...(p.serviceRegions.length === 0 ? { serviceRegions: ["Bengaluru"] } : {}),
    },
  });

  // The scenario puts the partner at a Bengaluru job. Whatever fix another suite left behind (the
  // heartbeat spec reports Delhi) would make the first Bengaluru beat a ~1,740 km jump, which the
  // presence anti-spoof refuses (400 IMPOSSIBLE_JUMP). Start from an unknown fix — null, not 0,0.
  await prisma.partnerPresence.updateMany({
    where: { providerId: p.id },
    data: {
      lastLocationAt: null,
      lastLocationReceivedAt: null,
      lastLocationLat: null,
      lastLocationLng: null,
      lastLocationAccuracy: null,
      lastLocationSource: null,
      lastLocationSeq: null,
    },
  });

  const stale = await prisma.booking.findMany({
    where: {
      OR: [
        {
          providerId: p.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS] },
        },
        {
          bookingNumber: { startsWith: "S03L-" },
          status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS] },
        },
      ],
    },
    select: { id: true },
  });
  for (const b of stale) {
    const now = new Date();
    // Cancel the way the product does (assignmentEngine.closeOffersInTx, "cancelled"): the booking,
    // its open offers and its job in one transaction. Cancelling only the booking left SENT offers
    // behind, and an open offer keeps the partner OFFERED (partner-operations hasOpenOffer) forever.
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          status: BookingStatus.CANCELLED_BY_PROVIDER,
          cancelledAt: now,
          cancellationReason: "s03 capacity free for live cert",
          providerId: p.id,
        },
      });
      const job = await tx.assignmentJob.findUnique({ where: { bookingId: b.id }, select: { id: true } });
      if (!job) return;
      await tx.assignmentAttempt.updateMany({
        where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
        data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
      });
      await tx.assignmentJob.update({
        where: { id: job.id },
        data: { status: AssignmentJobStatus.CANCELLED, currentProviderId: null, timeoutAt: null },
      });
    });
  }
  // Offers an earlier version of this seed stranded: SENT on an S03L booking that is already terminal.
  const strandedNow = new Date();
  const stranded = await prisma.assignmentAttempt.updateMany({
    where: {
      status: AssignmentAttemptStatus.SENT,
      job: { booking: { bookingNumber: { startsWith: "S03L-" }, status: { notIn: [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS] } } },
    },
    data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: strandedNow },
  });
  if (stranded.count > 0) console.error(`[section03-seed] closed ${stranded.count} stranded S03L offer(s)`);

  // Dedicated customer per run — avoids bookings_user_slot_excl collisions with prior cert seeds.
  const customer = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "Live",
      lastName: `S03-${RUN}`,
      email: `live-customer-${RUN}@homigo.demo`,
      phoneNumber: `+9199${String(Date.now()).slice(-8)}`,
      password: partnerUser.password,
      role: "CUSTOMER",
    },
  });
  const customerPasswordKnown = "Homigo@123";

  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("No active service");

  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "S03 Live",
      addressLine1: "MG Road",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      fullAddress: "MG Road, Bengaluru — Section 03 live cert",
    },
  });

  const booking = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `S03L-${RUN}`,
      userId: customer.id,
      providerId: null,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.PENDING,
      paymentStatus: PaymentStatus.SUCCESS,
      // Unique far-future slot per run — avoids bookings_provider_slot_excl / user_slot_excl.
      scheduledDate: new Date(Date.now() + (14 + Math.floor(Math.random() * 40)) * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 86_400_000)),
      baseAmount: service.basePrice,
      finalAmount: service.basePrice,
      totalAmount: service.basePrice,
      description: "Section 03 live web certification job",
    },
  });

  const existingPay = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
  if (!existingPay) {
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: customer.id,
        amount: service.basePrice,
        amountPaise: BigInt(Math.round(service.basePrice * 100)),
        paymentMethod: "test",
        razorpayOrderId: `order_s03_${RUN}`,
        idempotencyKey: `s03_${RUN}`,
        status: PaymentStatus.SUCCESS,
        settledAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  const job = await prisma.assignmentJob.create({
    data: {
      bookingId: booking.id,
      // A live offer is a DISPATCHED job with an open window (provider.service "pending" liveness rule);
      // a PENDING job never reaches the partner's request list.
      status: AssignmentJobStatus.DISPATCHED,
      currentProviderId: partnerUser.provider.id,
      dispatchAttempts: 1,
      lastDispatchedAt: new Date(),
      timeoutAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      attempts: {
        create: {
          providerId: partnerUser.provider.id,
          status: AssignmentAttemptStatus.SENT,
          dispatchedAt: new Date(),
        },
      },
    },
  });

  const out = {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    assignmentJobId: job.id,
    providerId: partnerUser.provider.id,
    customerId: customer.id,
    customerEmail: customer.email,
    customerPassword: customerPasswordKnown,
    partnerEmail: "partner@homigo.demo",
    partnerPassword: "Homigo@123",
    jobLat: JOB_LAT,
    jobLng: JOB_LNG,
    insideLat: INSIDE.lat,
    insideLng: INSIDE.lng,
    outsideLat: OUTSIDE.lat,
    outsideLng: OUTSIDE.lng,
    serviceName: service.name,
  };
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
