/**
 * Seed data for the Phase 10 §6 BROWSER verification (partner checklist, customer requirements,
 * admin requirement operations). Isolated test database ONLY.
 *
 *   NODE_ENV=development bun --env-file=.env.test run scripts/e2e-seed-phase10-s6-browser.ts
 *
 * Uses the adversarial fixture helper (customer, partner, admins, one service), configures the
 * service's Phase 06 requirements THROUGH THE ADMIN API (catalogue items + assignments, exactly as an
 * operator would), then books it through the real booking service so the requirements.v1 snapshot
 * and the §6 state rows are born the normal way. The booking is then placed at "arrived, paid, PIN
 * verified" — the moment the gate binds. Prints what the browser script needs.
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
const run = `browser-p10s6-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);
const admin = bearer(ctx.superAdmin);
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const codeOf = (c: string) => `${run}-${c}`;
for (const d of [
  { code: codeOf("socket"), kind: "CUSTOMER_PRECONDITION", name: "Working power socket", customerLabel: "A working power socket near the sofa" },
  { code: codeOf("shutoff"), kind: "CUSTOMER_PRECONDITION", name: "Water shut-off access", customerLabel: "Access to the water shut-off valve" },
  { code: codeOf("water"), kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water" },
]) {
  const r = await call("POST", "/api/admin/requirement-items", d, admin);
  if (r.status !== 200) throw new Error(`item ${d.code}: ${r.status} ${JSON.stringify(r.json)}`);
}
const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [
    { id: "socket", itemCode: codeOf("socket"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote: "A 3-pin socket within 5 m of the sofa.", sortOrder: 1 },
    { id: "shutoff", itemCode: codeOf("shutoff"), responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", sortOrder: 2 },
    { id: "water", itemCode: codeOf("water"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", sortOrder: 3 },
  ],
};
await prisma.service.update({ where: { id: ctx.serviceId }, data: { name: `Browser P10 Sofa ${run}`, displayName: "Browser P10 Sofa Cleaning" } });
const base = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin);
if (base.status !== 200) throw new Error(`service: ${base.status} ${JSON.stringify(base.json)}`);

const when = futureSlot(72);
const created = await bookingService.create(ctx.customerA.id, {
  serviceId: ctx.serviceId,
  addressId: ctx.addressAId,
  scheduledDate: when.toISOString(),
  variantId: "fabric",
  quantity: 2,
  requirementAttestations: ["water"],
});
if (!("booking" in created) || !created.booking) {
  console.error("booking create failed", JSON.stringify(created));
  process.exit(1);
}
const id = created.booking.id;
await prisma.booking.update({
  where: { id },
  data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date(), enRouteAt: new Date(), arrivedAt: new Date() },
});
const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
const partnerEmail = `${run}@partner.test`;
const login = await call("POST", "/api/auth/login", { email: partnerEmail, password: "AdvTest@123", setAuthCookies: false });
const customerLogin = await call("POST", "/api/auth/login", { email: ctx.customerA.email, password: "AdvTest@123", setAuthCookies: false });
const adminLogin = await call("POST", "/api/auth/login", { email: ctx.superAdmin.email, password: "AdvTest@123", setAuthCookies: false });
console.log(JSON.stringify({
  run,
  bookingId: id,
  bookingNumber: created.booking.bookingNumber,
  serviceId: ctx.serviceId,
  providerId: ctx.providerId,
  address: { latitude: a.latitude, longitude: a.longitude },
  partner: { email: partnerEmail, loginStatus: login.status },
  customer: { email: ctx.customerA.email, id: ctx.customerA.id, loginStatus: customerLogin.status },
  admin: { email: ctx.superAdmin.email, loginStatus: adminLogin.status },
  password: "AdvTest@123",
}, null, 2));
await prisma.$disconnect();
process.exit(0);
