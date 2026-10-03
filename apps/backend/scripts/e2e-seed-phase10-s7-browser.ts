/**
 * Seed data for the Phase 10 §7/§8 BROWSER verification (partner work steps, customer "what was
 * done", admin work-steps card + reset). Isolated test database ONLY.
 *
 *   NODE_ENV=development bun --env-file=.env.test run scripts/e2e-seed-phase10-s7-browser.ts
 *
 * Configures, THROUGH THE ADMIN API, one Phase 06 requirement (a REQUIRED_AT_START partner check)
 * and a three-step plan (prep → apply [PHOTO, safety-linked] → tidy [optional]); books it through the
 * real booking service; records the partner check and starts the job through the real services; and
 * uploads one real evidence row for the PHOTO step. Prints what the browser script needs.
 * The fixture password is the helper's published constant; no real credential is involved.
 */
import prisma from "../src/lib/prisma";
import app from "../src/index";
import { bearer, futureSlot, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";
import { bookingRequirementService } from "../src/services/booking-requirement.service";

const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(db)) {
  console.error(`refusing: ${db || "(no DATABASE_URL)"} is not an isolated test database`);
  process.exit(2);
}
const run = `browser-p10s7-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);
const admin = bearer(ctx.superAdmin);
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const code = `${run}-shutoff`;
const item = await call("POST", "/api/admin/requirement-items", { code, kind: "CUSTOMER_PRECONDITION", name: "Water shut-off access", customerLabel: "Access to the water shut-off valve" }, admin);
if (item.status !== 200) throw new Error(`item: ${item.status} ${JSON.stringify(item.json)}`);
await prisma.service.update({ where: { id: ctx.serviceId }, data: { name: `Browser P10 S7 ${run}`, displayName: "Browser P10 Sofa Steps" } });
const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [{ id: "shutoff", itemCode: code, responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", sortOrder: 1 }],
  execution: {
    steps: [
      { id: "prep", title: "Protect the floor", kind: "PREPARATION", ppe: ["Gloves"], estimatedMinutes: 5, sortOrder: 1 },
      { id: "apply", title: "Shampoo the seats", kind: "WORK", evidence: "PHOTO", dependsOn: ["prep"], safetyRequirement: "shutoff", warnings: ["Keep the machine away from sockets"], estimatedMinutes: 30, sortOrder: 2 },
      { id: "tidy", title: "Tidy up", kind: "CLOSEOUT", mandatory: false, skipPolicy: "SKIP_WITH_REASON", sortOrder: 3 },
    ],
  },
};
const saved = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin);
if (saved.status !== 200) throw new Error(`service: ${saved.status} ${JSON.stringify(saved.json)}`);

const created = await bookingService.create(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(72).toISOString(), variantId: "fabric", quantity: 2 });
if (!("booking" in created) || !created.booking) {
  console.error("booking create failed", JSON.stringify(created));
  process.exit(1);
}
const id = created.booking.id;
await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date(), enRouteAt: new Date(), arrivedAt: new Date() } });
const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
const chk = await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "shutoff", outcome: "SATISFIED", latitude: a.latitude as number, longitude: a.longitude as number });
if (!chk.ok) throw new Error(`partner check: ${JSON.stringify(chk)}`);
await bookingService.start(ctx.providerId, id, a.latitude as number, a.longitude as number);
const ev = await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "START", mediaStorageKey: `evidence/${run}/seats.jpg` } as never });
console.log(JSON.stringify({ run, bookingId: id, bookingNumber: created.booking.bookingNumber, evidenceId: ev.id, address: { latitude: a.latitude, longitude: a.longitude } }, null, 2));
await prisma.$disconnect();
process.exit(0);
