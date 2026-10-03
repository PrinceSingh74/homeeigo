import "dotenv/config";
import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  PaymentStatus,
  PrismaClient,
} from "@prisma/client";

const prisma = new PrismaClient();
const RUN = `dbg${Date.now().toString(36)}`;

async function main() {
  const partner = await prisma.user.findFirst({
    where: { email: "partner@homigo.demo" },
    include: { provider: true },
  });
  if (!partner?.provider) throw new Error("no partner");
  const cust = await prisma.user.create({
    data: { dataOrigin: "TEST",
      firstName: "D",
      lastName: RUN,
      phoneNumber: `+9198${String(Date.now()).slice(-8)}`,
      password: partner.password,
      role: "CUSTOMER",
    },
  });
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("no service");
  const address = await prisma.address.create({
    data: {
      userId: cust.id,
      label: "x",
      addressLine1: "a",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: 12.97,
      longitude: 77.59,
      fullAddress: "x",
    },
  });
  const booking = await prisma.booking.create({
    data: { dataOrigin: "TEST",
      bookingNumber: `DBG-${RUN}`,
      userId: cust.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.PENDING,
      paymentStatus: PaymentStatus.SUCCESS,
      scheduledDate: new Date(Date.now() + 8 * 864e5),
      baseAmount: 100,
      finalAmount: 100,
      totalAmount: 100,
    },
  });
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      userId: cust.id,
      amount: 100,
      amountPaise: BigInt(10000),
      paymentMethod: "test",
      razorpayOrderId: `o_${RUN}`,
      idempotencyKey: `i_${RUN}`,
      status: PaymentStatus.SUCCESS,
      settledAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.assignmentJob.create({
    data: {
      bookingId: booking.id,
      status: AssignmentJobStatus.PENDING,
      currentProviderId: partner.provider.id,
      dispatchAttempts: 1,
      lastDispatchedAt: new Date(),
      attempts: {
        create: {
          providerId: partner.provider.id,
          status: AssignmentAttemptStatus.SENT,
        },
      },
    },
  });

  const { bookingService } = await import("../src/services/booking.service");
  try {
    const r = await bookingService.accept(partner.provider.id, booking.id, 30);
    console.log("RESULT", JSON.stringify(r).slice(0, 800));
  } catch (e) {
    console.error("THROW", e);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
