#!/usr/bin/env bun
/**
 * Phase 5 certification fixtures — enterprise partner + booking data for runtime verification.
 *   bun --env-file=.env run scripts/phase-5-cert-fixtures.ts
 */
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { BookingStatus, KycStatus, PrismaClient, UserRole } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolvePrismaDatasourceUrl } from "../src/lib/database-url";
import { normalizeEmail, normalizePhone } from "../src/lib/pii-normalize";
import { PasswordService } from "../src/services/password.service";
import { userPiiService } from "../src/services/user-pii.service";
import { bookingService } from "../src/services/booking.service";

const EVIDENCE_DIR = path.join(process.cwd(), "..", "..", "docs", "evidence", "phase-5");
const DEMO_PASSWORD = "Homigo@123";
const CERT_TAG = "phase5-cert";

const rawPrisma = new PrismaClient({
  datasources: { db: { url: resolvePrismaDatasourceUrl() } },
});

async function ensureDemoUsers(): Promise<void> {
  execSync("bun --env-file=.env run scripts/ensure-demo-users.ts", {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

async function upsertVendorAlias(): Promise<{ userId: string; providerId: string }> {
  const email = "vendor@homigo.demo";
  const phone = "+919876543213";
  const passwordHash = await PasswordService.hashPassword(DEMO_PASSWORD);
  const pii = {
    email: normalizeEmail(email),
    phoneNumber: normalizePhone(phone),
    emailEncrypted: null,
    emailHash: null,
    phoneEncrypted: null,
    phoneHash: null,
    dataEncryptionStatus: "PARTIAL" as const,
  };

  let user = await userPiiService.findByEmail(email);
  if (!user) {
    user = await rawPrisma.user.create({
      data: {
        firstName: "Vendor",
        lastName: "Cert",
        password: passwordHash,
        role: UserRole.VENDOR,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
        ...pii,
      },
    });
    console.log(`Created ${email}`);
  } else {
    user = await rawPrisma.user.update({
      where: { id: user.id },
      data: { ...pii, password: passwordHash, role: UserRole.VENDOR, isActive: true },
    });
    console.log(`Updated ${email}`);
  }

  const services = await prisma.service.findMany({ where: { isActive: true }, select: { id: true } });
  const categories = services.length ? services.map((s) => s.id) : ["cleaning", "repair"];

  let provider = await prisma.provider.findUnique({ where: { userId: user.id } });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        userId: user.id,
        serviceCategories: categories,
        serviceRegions: ["Noida", "Delhi"],
        isVerified: true,
        isApproved: true,
        isOnline: true,
        isActive: true,
        rating: 4.9,
        totalReviews: 120,
        completionRate: 98,
        responseRate: 97,
        avgResponseTime: 2,
        acceptanceRate: 96,
        registrationStatus: "APPROVED",
        partnerApprovedAt: new Date(),
      },
    });
    await prisma.location.upsert({
      where: { providerId: provider.id },
      create: { providerId: provider.id, latitude: 28.63, longitude: 77.38, accuracy: 12 },
      update: { latitude: 28.63, longitude: 77.38 },
    });
    console.log(`Created provider for ${email}: ${provider.id}`);
  } else {
    await prisma.provider.update({
      where: { userId: user.id },
      data: { isApproved: true, isActive: true, isOnline: true, registrationStatus: "APPROVED" },
    });
  }

  const existingSession = await prisma.partnerAttendanceSession.findFirst({
    where: { providerId: provider!.id, source: "CERT_FIXTURE" },
  });
  if (!existingSession) {
    await prisma.partnerAttendanceSession.create({
      data: {
        providerId: provider!.id,
        checkInAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        checkOutAt: new Date(Date.now() - 30 * 60 * 1000),
        source: "CERT_FIXTURE",
      },
    });
  }

  return { userId: user.id, providerId: provider!.id };
}

async function resolveActors() {
  const customer = await userPiiService.findByEmail("customer@homigo.demo");
  const partner = await userPiiService.findByEmail("partner@homigo.demo");
  const admin = await userPiiService.findByEmail("admin@homigo.demo");
  if (!customer || !partner || !admin) {
    throw new Error("Demo users missing — run ensure-demo-users first");
  }
  const provider = await prisma.provider.findUnique({ where: { userId: partner.id } });
  if (!provider) throw new Error("Partner provider missing");
  const address = await rawPrisma.address.findFirst({ where: { userId: customer.id, isDefault: true } });
  if (!address) throw new Error("Customer address missing");
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("No active service in catalog");
  return { customer, partner, admin, provider, address, service };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

async function createCertBooking(
  userId: string,
  addressId: string,
  serviceId: string,
  providerId: string | null,
  scheduledDate: string,
): Promise<string> {
  const result = await bookingService.create(userId, {
    serviceId,
    addressId,
    scheduledDate,
    providerId: providerId ?? undefined,
    description: `${CERT_TAG} synthetic booking`,
  });
  if ("error" in result && result.error) {
    throw new Error(`bookingService.create failed: ${result.error}`);
  }
  const booking = (result as { booking?: { id: string } }).booking;
  if (!booking?.id) throw new Error("bookingService.create returned no booking id");
  return booking.id;
}

async function ensurePendingBookings(
  customerId: string,
  addressId: string,
  serviceId: string,
  providerId: string,
): Promise<{ acceptBookingId: string; rejectBookingId: string; writableBookingId: string }> {
  const existing = await prisma.booking.findMany({
    where: { description: { contains: CERT_TAG }, userId: customerId },
    select: { id: true, status: true, description: true },
  });

  let acceptBooking = existing.find((b) => b.description?.includes("accept"));
  let rejectBooking = existing.find((b) => b.description?.includes("reject"));
  let writableBooking = existing.find((b) => b.description?.includes("writable"));

  if (!acceptBooking) {
    const id = await createCertBooking(customerId, addressId, serviceId, null, futureDate(10));
    acceptBooking = { id, status: BookingStatus.PENDING, description: `${CERT_TAG} accept` };
    await prisma.booking.update({ where: { id }, data: { description: `${CERT_TAG} accept`, status: BookingStatus.PENDING } });
  }
  if (!rejectBooking) {
    const id = await createCertBooking(customerId, addressId, serviceId, null, futureDate(11));
    rejectBooking = { id, status: BookingStatus.PENDING, description: `${CERT_TAG} reject` };
    await prisma.booking.update({ where: { id }, data: { description: `${CERT_TAG} reject`, status: BookingStatus.PENDING } });
  }
  if (!writableBooking) {
    const id = await createCertBooking(customerId, addressId, serviceId, providerId, futureDate(14));
    writableBooking = { id, status: BookingStatus.PENDING, description: `${CERT_TAG} writable` };
    await prisma.booking.update({
      where: { id },
      data: { description: `${CERT_TAG} writable`, providerId, status: BookingStatus.PENDING },
    });
  }

  return {
    acceptBookingId: acceptBooking.id,
    rejectBookingId: rejectBooking.id,
    writableBookingId: writableBooking.id,
  };
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  console.log("Phase 5 — ensuring certification fixtures\n");

  await ensureDemoUsers();
  const vendor = await upsertVendorAlias();
  const actors = await resolveActors();
  const bookings = await ensurePendingBookings(
    actors.customer.id,
    actors.address.id,
    actors.service.id,
    actors.provider.id,
  );

  const fixture = {
    generatedAt: new Date().toISOString(),
    certTag: CERT_TAG,
    customer: { id: actors.customer.id, email: "customer@homigo.demo" },
    partner: { id: actors.partner.id, email: "partner@homigo.demo", providerId: actors.provider.id },
    vendor: { id: vendor.userId, email: "vendor@homigo.demo", providerId: vendor.providerId },
    admin: { id: actors.admin.id, email: "admin@homigo.demo" },
    serviceId: actors.service.id,
    addressId: actors.address.id,
    bookings,
  };

  const outPath = path.join(EVIDENCE_DIR, "cert-fixtures.json");
  writeFileSync(outPath, JSON.stringify(fixture, null, 2));
  console.log(`\nFixtures written: ${outPath}`);
  console.log(JSON.stringify(fixture, null, 2));
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
