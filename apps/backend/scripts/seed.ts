/**
 * HOMIGO database seed — run: bun run db:seed
 * Requires DATABASE_URL in apps/backend/.env and applied migrations.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dir, "../.env") });

import {
  BookingStatus,
  KycStatus,
  PaymentStatus,
  PrismaClient,
  TrackingStatus,
  UserRole,
  WalletTxnStatus,
  WalletTxnType,
} from "@prisma/client";

const prisma = new PrismaClient();

async function hashPassword(plain: string) {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

function bookingNumber(seq: number) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `HOMIGO-${d}-${String(seq).padStart(5, "0")}`;
}

function txnNumber(seq: number) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `WXN-${d}-${String(seq).padStart(5, "0")}`;
}

async function main() {
  console.log("🌱 Seeding HOMIGO database…");

  await prisma.activityLog.deleteMany();
  await prisma.locationHistory.deleteMany();
  await prisma.tracking.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.earning.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.providerDocument.deleteMany();
  await prisma.location.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.address.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hashPassword("Homigo@123");

  const [deepCleaning, acService, plumbing] = await Promise.all([
    prisma.service.create({
      data: {
        name: "Deep Cleaning",
        slug: "deep-cleaning",
        description: "Professional deep cleaning for your entire home",
        category: "cleaning",
        basePrice: 899,
        estimatedDuration: 120,
        isFeatured: true,
        isPopular: true,
        availableCities: ["Mumbai", "Delhi", "Noida", "Bangalore"],
        tags: ["cleaning", "home", "professional"],
        includedServices: ["Kitchen", "Bathroom", "Living room"],
      },
    }),
    prisma.service.create({
      data: {
        name: "AC Service",
        slug: "ac-service",
        description: "AC maintenance, gas refill, and repair",
        category: "repair",
        basePrice: 599,
        estimatedDuration: 60,
        isFeatured: true,
        availableCities: ["Mumbai", "Delhi", "Noida", "Bangalore"],
        tags: ["ac", "repair", "cooling"],
      },
    }),
    prisma.service.create({
      data: {
        name: "Plumbing Repair",
        slug: "plumbing",
        description: "Leak fixes, tap installation, and drainage",
        category: "repair",
        basePrice: 449,
        estimatedDuration: 45,
        availableCities: ["Mumbai", "Delhi", "Noida"],
        tags: ["plumbing", "repair"],
      },
    }),
  ]);

  const customer = await prisma.user.create({
    data: {
      email: "customer@homigo.demo",
      phoneNumber: "+919876543210",
      firstName: "Arjun",
      lastName: "Sharma",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      kycStatus: KycStatus.APPROVED,
      walletBalance: 5000,
      referralCode: "ARJUN2024",
      preferredCity: "Noida",
    },
  });

  const vendorUser = await prisma.user.create({
    data: {
      email: "partner@homigo.demo",
      phoneNumber: "+919876543211",
      firstName: "Rahul",
      lastName: "Sharma",
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });

  await prisma.user.create({
    data: {
      email: "admin@homigo.demo",
      phoneNumber: "+919876543212",
      firstName: "Homigo",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
    },
  });

  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "123, Sector 62",
      city: "Noida",
      state: "Uttar Pradesh",
      zipCode: "201301",
      fullAddress: "123, Sector 62, Noida, Uttar Pradesh 201301",
      latitude: 28.627,
      longitude: 77.371,
      isDefault: true,
    },
  });

  await prisma.user.update({
    where: { id: customer.id },
    data: { defaultAddressId: address.id },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: vendorUser.id,
      serviceCategories: [deepCleaning.id, acService.id, plumbing.id],
      serviceRegions: ["Noida", "Delhi"],
      isVerified: true,
      isApproved: true,
      isOnline: true,
      rating: 4.8,
      totalReviews: 320,
      completedBookings: 1240,
      completionRate: 92,
      responseRate: 95,
      onTimeRate: 90,
      cancellationRate: 2,
      acceptanceRate: 92,
      walletBalance: 12480,
      totalEarnings: 124850,
      thisMonthEarnings: 54320,
      thisWeekEarnings: 18650,
      pushTokens: [],
    },
  });

  await prisma.location.create({
    data: {
      providerId: provider.id,
      latitude: 28.63,
      longitude: 77.38,
      accuracy: 12,
    },
  });

  const scheduled = new Date();
  scheduled.setDate(scheduled.getDate() + 1);
  scheduled.setHours(10, 0, 0, 0);

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: bookingNumber(1),
      userId: customer.id,
      providerId: provider.id,
      serviceId: deepCleaning.id,
      addressId: address.id,
      status: BookingStatus.ASSIGNED,
      scheduledDate: scheduled,
      scheduledTime: "10:00 AM",
      estimatedDuration: 120,
      baseAmount: 899,
      finalAmount: 899,
      totalAmount: 899,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
      acceptedAt: new Date(),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      userId: customer.id,
      amount: 899,
      amountPaid: 899,
      paymentMethod: "razorpay",
      razorpayOrderId: `order_demo_${booking.id}`,
      razorpayPaymentId: `pay_demo_${booking.id}`,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });

  await prisma.tracking.create({
    data: {
      bookingId: booking.id,
      status: TrackingStatus.ON_THE_WAY,
      estimatedArrivalTime: new Date(Date.now() + 12 * 60 * 1000),
      lastUpdateAt: new Date(),
    },
  });

  await prisma.walletTransaction.create({
    data: {
      transactionNumber: txnNumber(1),
      userId: customer.id,
      amount: 500,
      walletBalanceBefore: 4500,
      walletBalanceAfter: 5000,
      type: WalletTxnType.BONUS,
      description: "Welcome bonus",
      referenceType: "referral",
      status: WalletTxnStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  await prisma.earning.create({
    data: {
      providerId: provider.id,
      bookingId: booking.id,
      grossAmount: 899,
      commission: 179.8,
      netEarning: 719.2,
    },
  });

  const pendingBooking = await prisma.booking.create({
    data: {
      bookingNumber: bookingNumber(2),
      userId: customer.id,
      serviceId: acService.id,
      addressId: address.id,
      status: BookingStatus.PENDING,
      scheduledDate: scheduled,
      scheduledTime: "02:00 PM",
      estimatedDuration: 60,
      baseAmount: 599,
      finalAmount: 599,
      totalAmount: 599,
    },
  });

  console.log("✅ Seed complete");
  console.log({
    services: [deepCleaning.slug, acService.slug, plumbing.slug],
    customer: customer.email,
    partner: vendorUser.email,
    providerId: provider.id,
    bookings: [booking.bookingNumber, pendingBooking.bookingNumber],
    demoPassword: "Homigo@123",
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
