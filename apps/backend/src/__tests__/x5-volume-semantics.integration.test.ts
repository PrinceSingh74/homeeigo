/**
 * X-5 — booking-kind volume semantics, end to end on the isolated test DB through the real routes.
 *
 * A REWORK / REVISIT follow-up (§11) is a return visit to a job that already counted. Completing
 * one must complete the booking normally (FSM untouched) but add NO volume: no
 * provider.completedBookings increment, no ₹0 earning row, no incentive "completed jobs" credit —
 * and the rating recompute must not resurrect the count it was refused. STANDARD completions are
 * unchanged.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { ratingService } from "../services/rating.service";
import { partnerIncentivePayoutService } from "../services/partner-incentive-payout.service";
import { countStandardCompleted, getBookingKind, isFollowUpKind } from "../lib/booking-volume";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `x5vol-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
let hoursAhead = 60;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
  quality: { complaintWindowDays: 7 },
  warranty: { enabled: true, durationDays: 30, startEvent: "COMPLETION", eligibleIssueTypes: ["QUALITY", "INCOMPLETE"], reworkFirst: true, refundAllowed: true },
  rework: { fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 },
};

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data.booking?.id ?? r.json.data.id;
}

/** Drive the real flow to COMPLETED: accepted + paid + PIN verified, then the partner starts and completes. */
async function completedBooking(): Promise<string> {
  const id = await book();
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  const s = await call("POST", `/api/bookings/${id}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
  if (s.status !== 200) throw new Error(`start: ${s.status} ${JSON.stringify(s.json)}`);
  const c = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
  if (c.status !== 200) throw new Error(`complete: ${c.status} ${JSON.stringify(c.json)}`);
  return id;
}

/** A waived follow-up (REWORK via action REWORK, REVISIT via INSPECTION) created by the real case flow. */
async function followUpFor(action: "REWORK" | "INSPECTION"): Promise<{ parentId: string; fuId: string }> {
  const parentId = await completedBooking();
  const opened = await call("POST", `/api/bookings/${parentId}/cases`, { category: "QUALITY", description: "the seats still smell" }, customer());
  if (opened.status !== 201) throw new Error(`case: ${opened.status} ${JSON.stringify(opened.json)}`);
  const caseId: string = opened.json.data.case.id;
  const t = await call("POST", `/api/admin/cases/${caseId}/transition`, { to: "TRIAGE", reason: "test: triage" }, admin());
  if (t.status !== 200) throw new Error(`triage: ${t.status} ${JSON.stringify(t.json)}`);
  hoursAhead += 24;
  const r = await call("POST", `/api/admin/cases/${caseId}/resolve`, { action, scheduledDate: futureSlot(hoursAhead).toISOString(), reason: "test decision" }, admin());
  if (r.status !== 200) throw new Error(`resolve: ${r.status} ${JSON.stringify(r.json)}`);
  const fuId: string = r.json.data.resolution.followUpBookingId;
  if (!fuId) throw new Error(`no follow-up booking: ${JSON.stringify(r.json)}`);
  return { parentId, fuId };
}

/** Assign the follow-up to the fixture partner and satisfy the PIN gate; payment stays PENDING (waived). */
async function armFollowUp(fuId: string) {
  await prisma.booking.update({ where: { id: fuId }, data: { providerId: ctx.providerId, status: "ACCEPTED", startOtpVerifiedAt: new Date() } });
  const s = await call("POST", `/api/bookings/${fuId}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
  if (s.status !== 200) throw new Error(`fu start: ${s.status} ${JSON.stringify(s.json)}`);
}

const providerFacts = () =>
  prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { completedBookings: true, totalBookings: true, walletBalance: true, totalEarnings: true } });
const earningsFor = (bookingId: string) => prisma.earning.count({ where: { bookingId } });
const complete = (id: string) => call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('booking_cases') IS NOT NULL AS present`;
  if (!present) throw new Error("booking_cases is not deployed on the test DB — run the migration first");
  ctx = await seedAdversarialFixtures(RUN);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  // Follow-ups reference their parent; delete them first so the fixture sweep never trips the FK.
  await prisma.$executeRaw`DELETE FROM bookings WHERE parent_booking_id IN (SELECT id FROM bookings WHERE user_id = ${ctx.customerA.id})`.catch(() => {});
  await prisma.$executeRaw`DELETE FROM refund_requests WHERE case_id IN (SELECT id FROM booking_cases WHERE customer_id = ${ctx.customerA.id})`.catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("X-5 volume semantics through the real routes", () => {
  test("STANDARD completion increments completedBookings by 1 and writes exactly one earning row", async () => {
    if (!dbOk) return;
    const before = await providerFacts();
    const truthBefore = await countStandardCompleted(ctx.providerId);
    const incBefore = await partnerIncentivePayoutService.loadProgressSnapshot(ctx.providerId);
    const id = await completedBooking();
    expect(await getBookingKind(id)).toBe("STANDARD");
    const after = await providerFacts();
    // The stored counter is not incremented blindly: completion increments it AND the post-commit
    // rating metrics rewrite it from the truth (count of STANDARD completions). The fixture seeds one
    // COMPLETED booking the stored counter never saw, so the invariant to hold is counter == truth,
    // and truth grew by exactly one.
    const truthAfter = await countStandardCompleted(ctx.providerId);
    expect(truthAfter).toBe(truthBefore + 1);
    expect(after.completedBookings).toBe(truthAfter);
    expect(await earningsFor(id)).toBe(1);
    const earning = await prisma.earning.findUniqueOrThrow({ where: { bookingId: id } });
    expect(earning.netEarning).toBeGreaterThan(0);
    expect(after.totalEarnings).toBeCloseTo(before.totalEarnings + earning.netEarning, 2);
    // Incentive "completed jobs" progress credits a standard job.
    const incAfter = await partnerIncentivePayoutService.loadProgressSnapshot(ctx.providerId);
    expect(incAfter.daily).toBe(incBefore.daily + 1);
  });

  test("a WAIVED REWORK follow-up completes normally but adds no volume and no earning", async () => {
    if (!dbOk) return;
    const { fuId } = await followUpFor("REWORK");
    expect(await getBookingKind(fuId)).toBe("REWORK");
    expect(isFollowUpKind(await getBookingKind(fuId))).toBe(true);
    await armFollowUp(fuId);

    const before = await providerFacts();
    const incBefore = await partnerIncentivePayoutService.loadProgressSnapshot(ctx.providerId);
    const c = await complete(fuId);
    expect(c.status).toBe(200);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: fuId }, select: { status: true, completedAt: true } });
    expect(b.status).toBe("COMPLETED"); // (a) the FSM completes normally
    expect(b.completedAt).not.toBeNull();

    const after = await providerFacts();
    expect(after.completedBookings).toBe(before.completedBookings); // (b) no volume increment
    expect(after.totalBookings).toBe(before.totalBookings);
    expect(await earningsFor(fuId)).toBe(0); // (c) no ₹0 earning row
    expect(after.walletBalance).toBeCloseTo(before.walletBalance, 2);
    expect(after.totalEarnings).toBeCloseTo(before.totalEarnings, 2);
    // (e) incentive "completed jobs" progress is not satisfiable by a rework visit.
    const incAfter = await partnerIncentivePayoutService.loadProgressSnapshot(ctx.providerId);
    expect(incAfter.daily).toBe(incBefore.daily);
    expect(incAfter.weekly).toBe(incBefore.weekly);
    expect(incAfter.monthly).toBe(incBefore.monthly);
  });

  test("a REVISIT (INSPECTION) follow-up completion is equally volume-neutral", async () => {
    if (!dbOk) return;
    const { fuId } = await followUpFor("INSPECTION");
    expect(await getBookingKind(fuId)).toBe("REVISIT");
    await armFollowUp(fuId);

    const before = await providerFacts();
    const c = await complete(fuId);
    expect(c.status).toBe(200);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: fuId }, select: { status: true } });
    expect(b.status).toBe("COMPLETED");

    const after = await providerFacts();
    expect(after.completedBookings).toBe(before.completedBookings);
    expect(await earningsFor(fuId)).toBe(0);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance, 2);
  });

  test("two concurrent completes of a follow-up still add zero volume and zero earnings", async () => {
    if (!dbOk) return;
    const { fuId } = await followUpFor("REWORK");
    await armFollowUp(fuId);

    const before = await providerFacts();
    const [r1, r2] = await Promise.all([complete(fuId), complete(fuId)]);
    // Whoever loses the race is answered from the committed row, never with a second money path.
    expect([r1.status, r2.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect([r1.status, r2.status].every((s) => s < 500)).toBe(true);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: fuId }, select: { status: true } });
    expect(b.status).toBe("COMPLETED");

    const after = await providerFacts();
    expect(after.completedBookings).toBe(before.completedBookings);
    expect(await earningsFor(fuId)).toBe(0);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance, 2);
  });

  test("the rating metrics recompute does not resurrect follow-up volume", async () => {
    if (!dbOk) return;
    const before = await providerFacts();
    const followUps = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM bookings
      WHERE provider_id = ${ctx.providerId} AND status = 'COMPLETED' AND booking_kind IN ('REWORK', 'REVISIT')`;
    expect(followUps[0].n).toBeGreaterThanOrEqual(3); // the three completed follow-ups above

    await ratingService.updateProviderMetrics(ctx.providerId);
    const after = await providerFacts();
    // The recompute writes the STANDARD-only count — the same number complete() maintained.
    expect(after.completedBookings).toBe(await countStandardCompleted(ctx.providerId));
    expect(after.completedBookings).toBe(before.completedBookings);
  });
});
