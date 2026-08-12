/**
 * Ensure demo login accounts work after PII encryption / key rotation.
 * Re-hashes passwords (bcryptjs) and re-encrypts emails with current keys.
 *
 * Usage: bun run scripts/ensure-demo-users.ts
 */
import "../src/load-env";
import { KycStatus, PrismaClient, UserRole } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolvePrismaDatasourceUrl } from "../src/lib/database-url";

/** Bypass PII auto-encrypt extension — demo accounts use plaintext email for reliable local login. */
const rawPrisma = new PrismaClient({
  datasources: { db: { url: resolvePrismaDatasourceUrl() } },
});
import { normalizeEmail, normalizePhone } from "../src/lib/pii-normalize";
import { PasswordService } from "../src/services/password.service";
import { rbacService } from "../src/services/rbac.service";
import { userPiiService } from "../src/services/user-pii.service";

const DEMO_PASSWORD = "Homigo@123";

const DEMOS = [
  {
    email: "admin@homigo.demo",
    phone: "+919876543212",
    firstName: "Homigo",
    lastName: "Admin",
    role: UserRole.ADMIN,
  },
  {
    email: "partner@homigo.demo",
    phone: "+919876543211",
    firstName: "Rahul",
    lastName: "Sharma",
    role: UserRole.VENDOR,
  },
  {
    email: "customer@homigo.demo",
    phone: "+919876543210",
    firstName: "Arjun",
    lastName: "Sharma",
    role: UserRole.CUSTOMER,
  },
  {
    email: "customer2@homigo.demo",
    phone: "+919876543209",
    firstName: "Priya",
    lastName: "Singh",
    role: UserRole.CUSTOMER,
  },
] as const;

/** Plain-text email so login works even when encryption keys were rotated. */
const plainPiiFields = (email: string, phone: string) => ({
  email: normalizeEmail(email),
  phoneNumber: normalizePhone(phone),
  emailEncrypted: null,
  emailHash: null,
  phoneEncrypted: null,
  phoneHash: null,
  dataEncryptionStatus: "PARTIAL" as const,
});

async function upsertDemoUser(demo: (typeof DEMOS)[number]) {
  const passwordHash = await PasswordService.hashPassword(DEMO_PASSWORD);
  const pii = plainPiiFields(demo.email, demo.phone);

  let user = await userPiiService.findByEmail(demo.email);
  if (!user) {
    user = await rawPrisma.user.findFirst({
      where: { email: pii.email, role: demo.role },
    });
  }

  if (!user) {
    user = await rawPrisma.user.create({
      data: {
        firstName: demo.firstName,
        lastName: demo.lastName,
        password: passwordHash,
        role: demo.role,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
        ...(demo.role === UserRole.CUSTOMER
          ? {
              kycStatus: KycStatus.APPROVED,
              walletBalance: 5000,
              referralCode: demo.email.startsWith("customer2") ? "DEMO2026B" : "DEMO2026",
            }
          : {}),
        ...pii,
      },
    });
    console.log(`Created ${demo.email} (${demo.role})`);
    return user;
  }

  user = await rawPrisma.user.update({
    where: { id: user.id },
    data: {
      ...pii,
      password: passwordHash,
      role: demo.role,
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  console.log(`Updated ${demo.email} (${demo.role})`);
  return user;
}

async function ensureAdminProfile(userId: string) {
  await rbacService.bootstrap();
  const existing = await prisma.adminUser.findUnique({ where: { userId } });
  if (existing) return;

  const superRole = await prisma.adminRole.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (!superRole) throw new Error("SUPER_ADMIN role missing after bootstrap");

  await prisma.adminUser.create({
    data: { userId, roleId: superRole.id, grantedBy: "DEMO_ENSURE" },
  });
  console.log("Linked admin@homigo.demo to SUPER_ADMIN");
}

async function ensurePartnerProvider(userId: string) {
  const demoCategories = [
    "cleaning",
    "repair",
    "plumbing",
    "ac-repair",
    "electrician",
    "pest-control",
    "salon",
    "beauty",
  ];

  const services = await prisma.service.findMany({ where: { isActive: true }, select: { id: true } });
  const categories = [
    ...new Set([...demoCategories, ...services.map((s) => s.id)]),
  ];

  const existing = await prisma.provider.findUnique({ where: { userId } });
  if (existing) {
    await prisma.provider.update({
      where: { userId },
      data: {
        serviceCategories: categories,
        isApproved: true,
        isActive: true,
        isOnline: true,
        registrationStatus: "APPROVED",
        rating: 4.95,
        totalReviews: 500,
        completionRate: 99,
        responseRate: 99,
        avgResponseTime: 1,
        acceptanceRate: 98,
      },
    });
    return existing.id;
  }

  const provider = await prisma.provider.create({
    data: {
      userId,
      serviceCategories: categories,
      serviceRegions: ["Noida", "Delhi"],
      isVerified: true,
      isApproved: true,
      isOnline: true,
      isActive: true,
      rating: 4.95,
      totalReviews: 500,
      completionRate: 99,
      responseRate: 99,
      avgResponseTime: 1,
      acceptanceRate: 98,
      registrationStatus: "APPROVED",
      partnerApprovedAt: new Date(),
    },
  });

  await prisma.location.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, latitude: 28.63, longitude: 77.38, accuracy: 12 },
    update: { latitude: 28.63, longitude: 77.38 },
  });

  console.log(`Created demo provider ${provider.id}`);
  return provider.id;
}

async function ensureCustomerAddress(userId: string) {
  const existing = await rawPrisma.address.findFirst({ where: { userId } });
  if (existing) return existing.id;

  const address = await rawPrisma.address.create({
    data: {
      userId,
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
  await rawPrisma.user.update({
    where: { id: userId },
    data: { defaultAddressId: address.id },
  });
  console.log(`Created demo customer address ${address.id}`);
  return address.id;
}

async function main() {
  for (const demo of DEMOS) {
    const user = await upsertDemoUser(demo);
    if (demo.role === UserRole.ADMIN) await ensureAdminProfile(user.id);
    if (demo.role === UserRole.VENDOR) await ensurePartnerProvider(user.id);
    if (demo.role === UserRole.CUSTOMER) await ensureCustomerAddress(user.id);

    const ok = await PasswordService.comparePassword(DEMO_PASSWORD, user.password!);
    const found = await userPiiService.findByEmail(demo.email);
    console.log(
      JSON.stringify({
        email: demo.email,
        findByEmail: !!found,
        passwordOk: ok,
        userId: user.id,
      }),
    );
  }

  console.log(`\nDemo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await rawPrisma.$disconnect();
  });
