/**
 * Section 03 DB integration runner (node-friendly; avoids bun native crash on locked Prisma DLL).
 * Usage: cd apps/backend && bun run scripts/section03-db-cert.ts
 *
 * For arrive/start proximity + lifecycle transitions, also run:
 *   bun run scripts/section03-lifecycle-api-cert.ts
 */
import "dotenv/config";
import { BookingStatus, PaymentStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUN = `s03-${Date.now().toString(36)}`;
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { bookingService } = await import("../src/services/booking.service");
  const { jobEvidenceService } = await import("../src/services/job-evidence.service");
  const { bookingChatService } = await import("../src/services/booking-chat.service");

  const customer = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "S03",
      lastName: "Customer",
      phoneNumber: `+9199${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const providerUser = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "S03",
      lastName: "Partner",
      phoneNumber: `+9198${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });
  const otherUser = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "S03",
      lastName: "Other",
      phoneNumber: `+9197${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("No active service");
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "12 Test Lane",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: 12.97,
      longitude: 77.59,
      fullAddress: "12 Test Lane, Bengaluru",
    },
  });
  const provider = await prisma.provider.create({
    data: {
      userId: providerUser.id,
      businessName: `S03 Biz ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
    },
  });
  const other = await prisma.provider.create({
    data: {
      userId: otherUser.id,
      businessName: `S03 Other ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
    },
  });
  const booking = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `S03-${RUN}`,
      userId: customer.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.IN_PROGRESS,
      paymentStatus: PaymentStatus.SUCCESS,
      scheduledDate: new Date(),
      baseAmount: 499,
      finalAmount: 499,
      totalAmount: 499,
      startedAt: new Date(),
      arrivedAt: new Date(),
      enRouteAt: new Date(),
      acceptedAt: new Date(),
    },
  });

  const first = await bookingService.complete(provider.id, booking.id, 12.97, 77.59, "done");
  gate("complete.first", first.newlyCompleted === true && first.booking.status === "COMPLETED");
  const second = await bookingService.complete(provider.id, booking.id, 12.97, 77.59, "retry");
  gate("complete.idempotent", second.newlyCompleted === false);
  const earnings = await prisma.earning.count({ where: { bookingId: booking.id } });
  gate("complete.single_earning", earnings === 1, `count=${earnings}`);

  let wrongProviderBlocked = false;
  try {
    await bookingService.complete(other.id, booking.id, 12.97, 77.59);
  } catch (e) {
    wrongProviderBlocked = e instanceof Error && /FORBIDDEN/.test(e.message);
  }
  gate("complete.assignment_gate", wrongProviderBlocked);

  const evA = await jobEvidenceService.recordStage({
    bookingId: booking.id,
    providerId: provider.id,
    stage: "COMPLETION",
    latitude: 12.97,
    longitude: 77.59,
    clientUploadId: `e2e-${RUN}`,
  });
  const evB = await jobEvidenceService.recordStage({
    bookingId: booking.id,
    providerId: provider.id,
    stage: "COMPLETION",
    latitude: 12.98,
    longitude: 77.6,
    clientUploadId: `e2e-${RUN}`,
  });
  gate("evidence.idempotent", evA.id === evB.id);

  let evidenceCrossDenied = false;
  try {
    await jobEvidenceService.recordStage({
      bookingId: booking.id,
      providerId: other.id,
      stage: "ARRIVAL",
      clientUploadId: `other-${RUN}`,
    });
  } catch (e) {
    evidenceCrossDenied = e instanceof Error && /FORBIDDEN/.test(e.message);
  }
  gate("evidence.ownership", evidenceCrossDenied);

  const msg1 = await bookingChatService.sendMessage(
    booking.id,
    providerUser.id,
    "On my way",
    `msg-${RUN}`,
  );
  const msg2 = await bookingChatService.sendMessage(
    booking.id,
    providerUser.id,
    "On my way",
    `msg-${RUN}`,
  );
  gate("chat.idempotent", msg1.created === true && msg2.created === false && msg1.message.id === msg2.message.id);

  const stranger = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "Stranger",
      lastName: "X",
      phoneNumber: `+9196${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  let chatDenied = false;
  try {
    await bookingChatService.sendMessage(booking.id, stranger.id, "hi");
  } catch (e) {
    chatDenied = e instanceof Error && /FORBIDDEN/.test(e.message);
  }
  gate("chat.auth", chatDenied);

  const b2 = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `S03C-${RUN}`,
      userId: customer.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.IN_PROGRESS,
      paymentStatus: PaymentStatus.SUCCESS,
      scheduledDate: new Date(),
      baseAmount: 299,
      finalAmount: 299,
      totalAmount: 299,
      startedAt: new Date(),
    },
  });
  await Promise.allSettled([
    bookingService.complete(provider.id, b2.id, 12.97, 77.59),
    bookingService.complete(provider.id, b2.id, 12.97, 77.59),
    bookingService.complete(provider.id, b2.id, 12.97, 77.59),
  ]);
  const e2 = await prisma.earning.count({ where: { bookingId: b2.id } });
  gate("complete.concurrent_single_earning", e2 === 1, `count=${e2}`);

  console.log(failed === 0 ? "\nSECTION 03 DB CERT: FULL PASS" : `\nSECTION 03 DB CERT: ${failed} FAIL(S)`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
