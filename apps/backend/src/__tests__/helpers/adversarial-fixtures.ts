import { BookingStatus, PaymentStatus, UserRole, type User } from "@prisma/client";
import { JWTService } from "../../services/jwt.service";
import { rbacService } from "../../services/rbac.service";
import prisma from "../../lib/prisma";

const jwt = new JWTService();

export { prisma };

export type AdvCtx = {
  runId: string;
  serviceId: string;
  providerId: string;
  vendorUserId: string;
  customerA: User;
  customerB: User;
  addressAId: string;
  addressBId: string;
  legacyAdmin: User;
  supportAdmin: User;
  financeAdmin: User;
  superAdmin: User;
  paymentForRefundId: string;
};

/** Deterministic unique Indian mobile per fixture run (avoids slice collisions across parallel suites). */
export function fixturePhone(runId: string, slot: number | string): string {
  const hash = Bun.hash(`${runId}:${slot}`).toString(16).replace(/\D/g, "");
  const tail = runId.replace(/[^0-9a-z]/gi, "");
  const digits = `${hash}${tail}`.replace(/\D/g, "").slice(-10).padStart(10, "0");
  return `+91${digits}`;
}

export async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function hashPassword(plain: string) {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

export function bearer(user: Pick<User, "id" | "email">): string {
  return jwt.generateAccessToken({
    userId: user.id,
    email: user.email ?? `${user.id}@adv.test`,
  });
}

export async function seedAdversarialFixtures(runId: string): Promise<AdvCtx> {
  await rbacService.bootstrap();

  const passwordHash = await hashPassword("AdvTest@123");
  const tag = `adv-${runId}`;

  const service = await prisma.service.create({
    data: {
      name: `Adv Service ${tag}`,
      slug: `adv-service-${tag}`,
      description: "Adversarial integration fixture",
      category: "cleaning",
      basePrice: 500,
      estimatedDuration: 60,
      availableCities: ["Noida"],
      tags: ["adv"],
    },
  });

  const customerA = await prisma.user.create({
    data: {
      email: `${tag}-a@adv.test`,
      phoneNumber: fixturePhone(runId, "a"),
      firstName: "Adv",
      lastName: "UserA",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
    },
  });

  const customerB = await prisma.user.create({
    data: {
      email: `${tag}-b@adv.test`,
      phoneNumber: fixturePhone(runId, "b"),
      firstName: "Adv",
      lastName: "UserB",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
    },
  });

  const vendorUser = await prisma.user.create({
    data: {
      email: `${tag}-vendor@adv.test`,
      phoneNumber: fixturePhone(runId, "vendor"),
      firstName: "Adv",
      lastName: "Vendor",
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: vendorUser.id,
      serviceCategories: [service.id],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      isActive: true,
      isOnline: true,
      rating: 4.5,
      workingDays: [],
    },
  });

  const addressA = await prisma.address.create({
    data: {
      userId: customerA.id,
      label: "Home",
      addressLine1: "1 Adv Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 Adv Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });

  const addressB = await prisma.address.create({
    data: {
      userId: customerB.id,
      label: "Home",
      addressLine1: "2 Adv Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "2 Adv Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });

  const legacyAdmin = await prisma.user.create({
    data: {
      email: `${tag}-legacy-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "legacy-admin"),
      firstName: "Legacy",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
    },
  });

  const supportRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "SUPPORT_ADMIN" } });
  const financeRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "FINANCE_ADMIN" } });
  const superRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });

  const supportAdmin = await prisma.user.create({
    data: {
      email: `${tag}-support-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "support-admin"),
      firstName: "Support",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: supportRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const financeAdmin = await prisma.user.create({
    data: {
      email: `${tag}-finance-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "finance-admin"),
      firstName: "Finance",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: financeRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      email: `${tag}-super-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "super-admin"),
      firstName: "Super",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: superRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const refundBooking = await prisma.booking.create({
    data: {
      bookingNumber: `ADV-${tag}-REF`,
      userId: customerA.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: addressA.id,
      status: BookingStatus.COMPLETED,
      scheduledDate: new Date(Date.now() + 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
    },
  });

  const paymentForRefund = await prisma.payment.create({
    data: {
      bookingId: refundBooking.id,
      idempotencyKey: `booking_order:${refundBooking.id}`,
      userId: customerA.id,
      amount: 500,
      amountPaid: 500,
      paymentMethod: "razorpay",
      razorpayOrderId: `order_adv_${tag}`,
      razorpayPaymentId: `pay_adv_${tag}`,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });

  return {
    runId,
    serviceId: service.id,
    providerId: provider.id,
    vendorUserId: vendorUser.id,
    customerA,
    customerB,
    addressAId: addressA.id,
    addressBId: addressB.id,
    legacyAdmin,
    supportAdmin,
    financeAdmin,
    superAdmin,
    paymentForRefundId: paymentForRefund.id,
  };
}

export async function deleteBookingsForUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const bookings = await prisma.booking.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  if (bookingIds.length > 0) {
    await prisma.couponUsage.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.membershipCouponRedemption.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.membershipCashback.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.rating.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.tracking.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.assignmentJob.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.activityLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.supportTicket.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
}

export async function cleanupAdversarialFixtures(runId: string): Promise<void> {
  const tag = `adv-${runId}`;
  const users = await prisma.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) return;

  await deleteBookingsForUsers(userIds);
  await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminUser.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.provider.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.service.deleteMany({ where: { slug: { contains: tag } } });
}

export function futureSlot(hoursAhead = 48): Date {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}
