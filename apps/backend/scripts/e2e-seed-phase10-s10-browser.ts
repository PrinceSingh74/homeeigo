/**
 * Seed data for the Phase 10 §10/§11 BROWSER verification (partner completes with quality gates,
 * customer confirms or reports an issue → case, admin decides). Isolated test database ONLY.
 *
 *   NODE_ENV=development bun --env-file=.env.test run scripts/e2e-seed-phase10-s10-browser.ts
 *
 * Configures the service's quality + warranty + execution blocks THROUGH THE ADMIN API, then seeds
 * two bookings through the real booking service:
 *   bookingA — "partner arrived, paid, PIN verified, started": the partner browser does the steps,
 *              evidence and complete (verdict PASS) and the customer browser confirms.
 *   bookingB — already COMPLETED through the real complete path (steps + evidence driven via the
 *              API here), completion PENDING_CUSTOMER: the customer browser reports an issue and
 *              the admin browser triages/decides the case.
 * The fixture password is the helper's published constant; no real credential is involved.
 */
import prisma from "../src/lib/prisma";
import app from "../src/index";
import { bearer, futureSlot, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";

const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(db)) {
  console.error(`refusing: ${db || "(no DATABASE_URL)"} is not an isolated test database`);
  process.exit(2);
}
const run = `browser-p10s10-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);
const admin = bearer(ctx.superAdmin);
const partner = bearer({ id: ctx.vendorUserId, email: `${run}@partner.test` });
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
await prisma.service.update({ where: { id: ctx.serviceId }, data: { name: `Browser P10 S10 ${run}`, displayName: "Browser P10 Quality" } });
const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  quality: {
    checklist: ["Seats shampooed", "Work area tidied"],
    proofRequired: true,
    confirmationWindowHours: 48,
    warrantyDays: 7,
    complaintWindowDays: 7,
  },
  execution: {
    steps: [
      { id: "prep", title: "Protect the floor", kind: "PREPARATION", estimatedMinutes: 5, sortOrder: 1 },
      { id: "shampoo", title: "Shampoo the seats", kind: "WORK", evidence: "PHOTO", dependsOn: ["prep"], estimatedMinutes: 30, sortOrder: 2 },
    ],
  },
};
const saved = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin);
if (saved.status !== 200) throw new Error(`service: ${saved.status} ${JSON.stringify(saved.json)}`);

async function seedBooking(hoursAhead: number): Promise<string> {
  const created = await bookingService.create(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(hoursAhead).toISOString(), variantId: "fabric", quantity: 2 });
  if (!("booking" in created) || !created.booking) throw new Error(`booking create failed: ${JSON.stringify(created)}`);
  const id = created.booking.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date(), enRouteAt: new Date(), arrivedAt: new Date() } });
  return id;
}
const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
const gps = { latitude: a.latitude, longitude: a.longitude };

// bookingA: started; the partner browser does steps → evidence → complete.
const bookingA = await seedBooking(72);
{
  const r = await call("POST", `/api/bookings/${bookingA}/start`, gps, partner);
  if (r.status !== 200) throw new Error(`A start: ${r.status} ${JSON.stringify(r.json)}`);
}

// bookingB: COMPLETED through the real path so the customer browser can report an issue.
const bookingB = await seedBooking(96);
{
  let r = await call("POST", `/api/bookings/${bookingB}/start`, gps, partner);
  if (r.status !== 200) throw new Error(`B start: ${r.status} ${JSON.stringify(r.json)}`);
  for (const code of ["prep", "shampoo"]) {
    r = await call("POST", `/api/bookings/${bookingB}/execution/${code}/START`, {}, partner);
    if (r.status !== 200) throw new Error(`B ${code} START: ${r.status} ${JSON.stringify(r.json)}`);
    let body: Record<string, unknown> = {};
    if (code === "shampoo") {
      // The step gate reads durable job_evidence rows (D1 authority), so record one first.
      const ev = await call("POST", `/api/bookings/${bookingB}/evidence`, { stage: "START", clientUploadId: `${run}-shampoo`, mediaStorageKey: `job-evidence/${run}-shampoo.jpg`, mediaMimeType: "image/jpeg", ...gps }, partner);
      if (ev.status !== 200 && ev.status !== 201) throw new Error(`B evidence: ${ev.status} ${JSON.stringify(ev.json)}`);
      body = { evidenceId: ev.json?.data?.evidence?.id ?? ev.json?.data?.id };
    }
    r = await call("POST", `/api/bookings/${bookingB}/execution/${code}/COMPLETE`, body, partner);
    if (r.status !== 200) throw new Error(`B ${code} COMPLETE: ${r.status} ${JSON.stringify(r.json)}`);
  }
  r = await call("POST", `/api/bookings/${bookingB}/complete`, { ...gps, photos: [`https://cdn.test/${run}-after.jpg`], completedChecklist: CONFIG.quality.checklist, notes: "done" }, partner);
  if (r.status !== 200) throw new Error(`B complete: ${r.status} ${JSON.stringify(r.json)}`);
}

console.log(JSON.stringify({ run, serviceId: ctx.serviceId, bookingA, bookingB, address: gps }, null, 2));
await prisma.$disconnect();
process.exit(0);
