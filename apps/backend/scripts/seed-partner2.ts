/**
 * Seeds partner2@homigo.demo for cross-partner isolation tests (test env only).
 * Idempotent — skips if user + provider already exist.
 *
 *   cd apps/backend && bun --env-file=.env run scripts/seed-partner2.ts
 */
import prisma from "../src/lib/prisma";
import { PasswordService } from "../src/services/password.service";
import { UserRole } from "@prisma/client";

const EMAIL = "partner2@homigo.demo";
const PASSWORD = "Homigo@123";

async function main() {
  const existing = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, provider: { select: { id: true } } },
  });
  if (existing?.provider) {
    console.log(JSON.stringify({ status: "exists", email: EMAIL, providerId: existing.provider.id }));
    return;
  }

  const services = await prisma.service.findMany({
    where: { isActive: true },
    take: 2,
    select: { id: true },
  });
  if (services.length === 0) throw new Error("No active services — run db:seed first");

  const passwordHash = await PasswordService.hashPassword(PASSWORD);
  const user = existing
    ? existing
    : await prisma.user.create({
        data: {
          email: EMAIL,
          phoneNumber: "+919876543299",
          firstName: "Priya",
          lastName: "Verma",
          password: passwordHash,
          role: UserRole.VENDOR,
          isEmailVerified: true,
          isPhoneVerified: true,
        },
        select: { id: true },
      });

  const provider = await prisma.provider.create({
    data: {
      userId: user.id,
      serviceCategories: services.map((s) => s.id),
      serviceRegions: ["Gurgaon", "Delhi"],
      isVerified: true,
      isApproved: true,
      isOnline: true,
      isActive: true,
      lifecycleState: "ACTIVE",
      rating: 4.2,
      totalReviews: 85,
      completedBookings: 410,
      completionRate: 88,
      responseRate: 90,
      onTimeRate: 85,
      cancellationRate: 4,
      acceptanceRate: 88,
      walletBalance: 3200,
      totalEarnings: 42100,
      thisMonthEarnings: 9800,
      thisWeekEarnings: 2100,
      pushTokens: [],
    },
  });

  await prisma.location.create({
    data: {
      providerId: provider.id,
      latitude: 28.46,
      longitude: 77.03,
      accuracy: 15,
    },
  });

  console.log(JSON.stringify({ status: "created", email: EMAIL, userId: user.id, providerId: provider.id }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
