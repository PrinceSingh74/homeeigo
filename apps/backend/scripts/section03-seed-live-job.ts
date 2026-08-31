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
import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  PaymentStatus,
  PrismaClient,
} from "@prisma/client";

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
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        status: BookingStatus.CANCELLED_BY_PROVIDER,
        cancelledAt: new Date(),
        cancellationReason: "s03 capacity free for live cert",
        providerId: p.id,
      },
    });
  }

  // Dedicated customer per run — avoids bookings_user_slot_excl collisions with prior cert seeds.
  const customer = await prisma.user.create({
    data: {
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
    data: {
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
      status: AssignmentJobStatus.PENDING,
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
