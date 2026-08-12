/**
 * Phase 16/17/18 regression suite — runs against the ISOLATED homigo_test DB.
 *   NODE_ENV=test bun test src/__tests__/phase16-18-regression.test.ts
 * Real DB assertions (no mocks): geofencing, wallet checkout (zero drift), tracking throttle.
 */
import { afterAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { geofenceService } from "../services/geofence.service";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { bookingService } from "../services/booking.service";
import { trackingService } from "../services/tracking.service";
import { financialIntegrityService } from "../services/financial-integrity.service";

const LAT = 19.076;
const LNG = 72.8777;
const createdGeofenceIds: string[] = [];
const createdUserIds: string[] = [];

async function newUser(role: "CUSTOMER" | "VENDOR" = "CUSTOMER") {
  const u = await prisma.user.create({
    data: { email: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.test`, phoneNumber: `+9176${Math.floor(1e6 + Math.random() * 8e6)}`, firstName: "Reg", lastName: "Test", password: "x".repeat(20), role, walletBalance: 0 },
  });
  createdUserIds.push(u.id);
  return u;
}
async function fundWallet(userId: string, inr: number) {
  const t = await walletService.addMoney(userId, inr);
  if ("error" in t) throw new Error(t.error);
  await walletService.verifyTopUp(userId, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_${Date.now()}_${Math.random()}`, razorpaySignature: "sig" });
}
async function newBooking(userId: string) {
  const s = await prisma.service.create({ data: { name: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, slug: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 } });
  const a = await prisma.address.create({ data: { userId, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: LAT, longitude: LNG } });
  const c = await bookingService.create(userId, { serviceId: s.id, addressId: a.id, scheduledDate: new Date(Date.now() + 3 * 86400_000).toISOString() });
  if (!("booking" in c) || !c.booking) throw new Error(JSON.stringify(c));
  return c.booking;
}

afterAll(async () => {
  await prisma.geofenceEvent.deleteMany({ where: { geofenceId: { in: createdGeofenceIds } } }).catch(() => {});
  await prisma.geofence.deleteMany({ where: { id: { in: createdGeofenceIds } } }).catch(() => {});
  await prisma.$disconnect();
});

describe("Phase 16.3 — Geofencing", () => {
  test("containment, ENTER/EXIT, 5-min duplicate suppression", async () => {
    const g = await geofenceService.create({ name: `Reg Society ${Date.now()}`, zoneType: "SOCIETY", centerLat: 28.4595, centerLng: 77.095, radiusMeters: 400 });
    createdGeofenceIds.push(g.id);
    expect(geofenceService.pointInGeofence(g, 28.4596, 77.0951)).toBe(true); // ~15m inside
    expect(geofenceService.pointInGeofence(g, 28.47, 77.095)).toBe(false); // ~450m outside

    const subj = { userId: `reg-geo-${Date.now()}` };
    const enter = await geofenceService.processLocationUpdate(subj, 28.4596, 77.0951);
    expect(enter.entered.length).toBe(1);
    const stay = await geofenceService.processLocationUpdate(subj, 28.4596, 77.0951);
    expect(stay.entered.length).toBe(0); // no duplicate ENTER while inside
    await geofenceService.processLocationUpdate(subj, 28.6, 77.3); // leave
    const reenter = await geofenceService.processLocationUpdate(subj, 28.4596, 77.0951); // within 5 min
    expect(reenter.entered.length).toBe(0); // suppressed by 5-minute window

    const enters = await prisma.geofenceEvent.count({ where: { userId: subj.userId, geofenceId: g.id, eventType: "ENTER" } });
    expect(enters).toBe(1);
  });

  test("concurrent entry yields exactly one ENTER (advisory lock)", async () => {
    const g = await geofenceService.create({ name: `Reg Conc ${Date.now()}`, zoneType: "SOCIETY", centerLat: 28.46, centerLng: 77.1, radiusMeters: 300 });
    createdGeofenceIds.push(g.id);
    const subj = { userId: `reg-conc-${Date.now()}` };
    await Promise.allSettled(Array.from({ length: 25 }, () => geofenceService.processLocationUpdate(subj, 28.4601, 77.1001)));
    const enters = await prisma.geofenceEvent.count({ where: { userId: subj.userId, geofenceId: g.id, eventType: "ENTER" } });
    expect(enters).toBe(1);
  });
});

describe("Phase 18 — Wallet checkout (zero drift)", () => {
  test("wallet-only payment is idempotent and ledger-consistent", async () => {
    const baseline = (await financialIntegrityService.validate()).issues.filter((i) => ["LEDGER_IMBALANCE", "WALLET_LIABILITY_MISMATCH", "MISSING_LEDGER_ENTRY"].includes(i.category)).length;
    const u = await newUser();
    await fundWallet(u.id, 2000);
    const b = await newBooking(u.id);

    const pay = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
    expect("ok" in pay && pay.ok).toBe(true);
    const after1 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after1.walletBalance).toBe(2000 - b.finalAmount);
    const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(bk.paymentStatus).toBe("SUCCESS");

    // Idempotent re-pay — no double debit.
    const pay2 = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
    expect("ok" in pay2 && pay2.alreadyPaid).toBe(true);
    const after2 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after2.walletBalance).toBe(after1.walletBalance);

    const afterIssues = (await financialIntegrityService.validate()).issues.filter((i) => ["LEDGER_IMBALANCE", "WALLET_LIABILITY_MISMATCH", "MISSING_LEDGER_ENTRY"].includes(i.category)).length;
    expect(afterIssues).toBeLessThanOrEqual(baseline); // zero introduced drift
  });

  test("insufficient wallet balance is rejected", async () => {
    const u = await newUser();
    await fundWallet(u.id, 100);
    const b = await newBooking(u.id);
    const pay = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
    expect("error" in pay && pay.error).toBe("INSUFFICIENT_WALLET_BALANCE");
  });
});

describe("Phase 17 — Tracking", () => {
  test("sub-10m/5s update is throttled; presence is set", async () => {
    const cu = await newUser();
    const pu = await newUser("VENDOR");
    const pv = await prisma.provider.create({ data: { userId: pu.id, serviceCategories: ["cleaning"], serviceRegions: ["Mumbai"], isActive: true, isApproved: true, isVerified: true } });
    const s = await prisma.service.create({ data: { name: `tr-${Date.now()}`, slug: `tr-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 } });
    const a = await prisma.address.create({ data: { userId: cu.id, label: "H", addressLine1: "1", city: "Mumbai", state: "MH", zipCode: "400001", latitude: LAT, longitude: LNG } });
    const cr = await bookingService.create(cu.id, { serviceId: s.id, addressId: a.id, scheduledDate: new Date(Date.now() + 3 * 86400_000).toISOString() });
    if (!("booking" in cr) || !cr.booking) throw new Error("setup");
    await prisma.booking.update({ where: { id: cr.booking.id }, data: { providerId: pv.id, status: "ACCEPTED" } });

    const u1 = await trackingService.updateLocation(pv.id, { bookingId: cr.booking.id, latitude: 19.08, longitude: 72.88 });
    expect((u1 as { throttled?: boolean })?.throttled).toBeUndefined();
    const u2 = await trackingService.updateLocation(pv.id, { bookingId: cr.booking.id, latitude: 19.080005, longitude: 72.880005 }); // ~0.7m
    expect((u2 as { throttled?: boolean })?.throttled).toBe(true);
    expect(await trackingService.isProviderOnline(pv.id)).toBe(true);

    await prisma.tracking.deleteMany({ where: { bookingId: cr.booking.id } }).catch(() => {});
  });
});
