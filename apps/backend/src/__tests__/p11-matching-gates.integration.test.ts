/**
 * Phase 11 — the canonical matching hard gates end to end on the isolated test DB.
 *
 * Real fixtures, real capability rows (raw SQL into the Phase 11 tables, `data_origin` declared,
 * `verified_by` set where the CHECKs demand it), the fixture service configured through the real
 * admin API, and the matcher driven through `findBestProvidersWithDiagnostics` plus the admin
 * diagnostics route. Every case names the gate it proves (GF4 … GF11, Q17, Q18/Q20).
 *
 * Runs against `homigo_test`; refuses anything else.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AssignmentAttemptStatus, AssignmentJobStatus, BookingStatus, PaymentStatus, UserRole, type DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import { matchingService, type MatchingDiagnostics, type MatchingRequest } from "../services/matching.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { resetMemoryLocksForTests } from "../lib/redis";
import { __capabilityLoaderCalls, SEED_PARTNER_FALLBACK_FLAG, STRICT_SERVICE_CAPABILITY_FLAG, loadServiceGateContext, seedPartnerFallbackDefault, seedPartnerFallbackPolicy } from "../services/provider-capability-loader";
import { currentEnvironment, invalidateFlagCache } from "../services/feature-flag.service";
import { sumCounterWhere } from "../lib/metrics";
import type { MatchingRejectionReason } from "../lib/provider-capability";
import { bearer, cleanupAdversarialFixtures, dbReachable, deleteBookingsForUsers, fixturePhone, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const RUN = `p11mg-${Date.now().toString(36)}`;
const TAG = `adv-${RUN}`;
const LAT = 28.62;
const LNG = 77.37;
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CERT = "gas-safety";
const SKILL = `wiring-${RUN}`;
const BIZ_ID = `biz-${RUN}`;

let ctx: AdvCtx;
let dbOk = false;
let passwordHash = "";
let hoursAhead = 48;
const extraProviderIds: string[] = [];
const extraUserIds: string[] = [];
let bizProviderId = "";
let raceServiceId = "";

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = () => bearer(ctx.superAdmin);

/** The fixture service, configured through the real admin editor with the typed requirement block. */
async function setRequirements(providerRequirements?: Record<string, unknown>) {
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
    pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250,
    catalogConfig: {
      materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
      quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
      variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
      ...(providerRequirements ? { providerRequirements } : {}),
    },
  }, admin());
  if (r.status !== 200) throw new Error(`service config: ${r.status} ${JSON.stringify(r.json)}`);
}

const setOrigin = (userId: string, origin: DataOrigin | null) => prisma.user.update({ where: { id: userId }, data: { dataOrigin: origin } });

/** A fully matchable partner (same base point, 24/7, radius 50 km) with an explicitly declared origin. */
async function mkProvider(slot: string, origin: DataOrigin | null): Promise<{ providerId: string; userId: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${slot}@adv.test`,
      dataOrigin: origin,
      phoneNumber: fixturePhone(RUN, slot),
      firstName: "P11",
      lastName: slot,
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  const p = await prisma.provider.create({
    data: {
      userId: user.id,
      serviceCategories: [ctx.serviceId],
      serviceRegions: [],
      serviceRadiusKm: 50,
      baseLatitude: LAT,
      baseLongitude: LNG,
      workingDays: ALL_DAYS,
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      isOnline: true,
      rating: 4.2,
    },
  });
  extraProviderIds.push(p.id);
  extraUserIds.push(user.id);
  return { providerId: p.id, userId: user.id };
}

async function presence(providerId: string, at: Date) {
  await prisma.partnerPresence.upsert({
    where: { providerId },
    create: { providerId, lastHeartbeatAt: at, lastSeenAt: at, lastLocationAt: at, lastLocationLat: LAT, lastLocationLng: LNG },
    update: { lastHeartbeatAt: at, lastSeenAt: at, lastLocationAt: at, lastLocationLat: LAT, lastLocationLng: LNG },
  });
}

// ── raw capability rows (tables are outside the Prisma model; parameterised only) ─────────────
const day = 86_400_000;
const past = (d: number) => new Date(Date.now() - d * day);
const future = (d: number) => new Date(Date.now() + d * day);

async function cert(providerId: string, o: { status?: "DECLARED" | "VERIFIED" | "REVOKED"; expiresAt?: Date | null; origin?: DataOrigin | null; type?: string } = {}) {
  const status = o.status ?? "VERIFIED";
  const verified = status === "VERIFIED";
  const revoked = status === "REVOKED";
  await prisma.$executeRaw`
    INSERT INTO provider_certifications (provider_id, certification_type, status, issued_at, expires_at, verified_by, verified_at, revoked_at, revoked_reason, data_origin)
    VALUES (${providerId}, ${o.type ?? CERT}, ${status}, ${past(30)}, ${o.expiresAt === undefined ? future(365) : o.expiresAt},
            ${verified ? "admin-test" : null}, ${verified ? new Date() : null},
            ${revoked ? new Date() : null}, ${revoked ? "test revocation" : null},
            ${o.origin === undefined ? "FIXTURE" : o.origin}::"DataOrigin")`;
}
const clearCerts = (providerId: string) => prisma.$executeRaw`DELETE FROM provider_certifications WHERE provider_id = ${providerId}`;

async function equipment(providerId: string, type: string, o: { status?: "DECLARED" | "VERIFIED"; operational?: "OPERATIONAL" | "OUT_OF_SERVICE" } = {}) {
  const status = o.status ?? "VERIFIED";
  await prisma.$executeRaw`
    INSERT INTO provider_equipment (provider_id, equipment_type, ownership, operational, status, verified_by, verified_at, data_origin)
    VALUES (${providerId}, ${type}, 'OWNED', ${o.operational ?? "OPERATIONAL"}, ${status}, ${status === "VERIFIED" ? "admin-test" : null}, ${status === "VERIFIED" ? new Date() : null}, 'FIXTURE'::"DataOrigin")`;
}
const clearEquipment = (providerId: string) => prisma.$executeRaw`DELETE FROM provider_equipment WHERE provider_id = ${providerId}`;

async function insurance(providerId: string, type: string, o: { status?: "DECLARED" | "VERIFIED"; expiresAt?: Date } = {}) {
  const status = o.status ?? "VERIFIED";
  await prisma.$executeRaw`
    INSERT INTO provider_insurance (provider_id, insurance_type, effective_from, expires_at, status, verified_by, verified_at, data_origin)
    VALUES (${providerId}, ${type}, ${past(10)}, ${o.expiresAt ?? future(200)}, ${status}, ${status === "VERIFIED" ? "admin-test" : null}, ${status === "VERIFIED" ? new Date() : null}, 'FIXTURE'::"DataOrigin")`;
}
const clearInsurance = (providerId: string) => prisma.$executeRaw`DELETE FROM provider_insurance WHERE provider_id = ${providerId}`;

async function language(providerId: string, code: string, proficiency: "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE") {
  await prisma.$executeRaw`
    INSERT INTO provider_languages (provider_id, language_code, proficiency, source, active, data_origin)
    VALUES (${providerId}, ${code}, ${proficiency}, 'SELF', true, 'FIXTURE'::"DataOrigin")
    ON CONFLICT (provider_id, language_code) DO UPDATE SET proficiency = EXCLUDED.proficiency`;
}
const clearLanguages = (providerId: string) => prisma.$executeRaw`DELETE FROM provider_languages WHERE provider_id = ${providerId}`;

async function skill(providerId: string, code: string, status: "DECLARED" | "VERIFIED") {
  await prisma.$executeRaw`INSERT INTO skills (code, category, name) VALUES (${code}, 'cleaning', ${code}) ON CONFLICT (code) DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO provider_skills (provider_id, skill_code, level, status, source, verified_by, verified_at, data_origin)
    VALUES (${providerId}, ${code}, 'SKILLED', ${status}, 'ADMIN', ${status === "VERIFIED" ? "admin-test" : null}, ${status === "VERIFIED" ? new Date() : null}, 'FIXTURE'::"DataOrigin")
    ON CONFLICT (provider_id, skill_code) DO UPDATE SET status = EXCLUDED.status, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at`;
}

async function serviceCapability(providerId: string, status: "REQUESTED" | "ACTIVE" | "SUSPENDED" | "REVOKED", origin: DataOrigin | null = "FIXTURE") {
  const active = status === "ACTIVE";
  await prisma.$executeRaw`
    INSERT INTO provider_service_capabilities (provider_id, service_id, status, source, verified_by, verified_at, data_origin)
    VALUES (${providerId}, ${ctx.serviceId}, ${status}, 'ADMIN', ${active ? "admin-test" : null}, ${active ? new Date() : null}, ${origin}::"DataOrigin")
    ON CONFLICT (provider_id, service_id) DO UPDATE SET status = EXCLUDED.status, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at`;
}
const clearServiceCapability = (providerId: string) => prisma.$executeRaw`DELETE FROM provider_service_capabilities WHERE provider_id = ${providerId}`;

async function setStrictFlag(enabled: boolean) {
  if (enabled) {
    await prisma.platformFeatureFlag.upsert({
      where: { key: STRICT_SERVICE_CAPABILITY_FLAG },
      create: { key: STRICT_SERVICE_CAPABILITY_FLAG, enabled: true, rolloutPct: 100, environment: currentEnvironment(), description: `p11 test ${RUN}` },
      update: { enabled: true, rolloutPct: 100, environment: currentEnvironment() },
    });
  } else {
    await prisma.platformFeatureFlag.deleteMany({ where: { key: STRICT_SERVICE_CAPABILITY_FLAG } });
  }
  await invalidateFlagCache(STRICT_SERVICE_CAPABILITY_FLAG);
}

// ── the matcher under test ──────────────────────────────────────────────────────────────────────
const diag = (customerId: string | undefined, extra: Partial<MatchingRequest> = {}) =>
  matchingService.findBestProvidersWithDiagnostics({ serviceId: ctx.serviceId, customerId, latitude: LAT, longitude: LNG, scheduledDate: futureSlot(48), maxResults: 100, ...extra });
const reasonsFor = (d: MatchingDiagnostics, providerId: string): MatchingRejectionReason[] => d.rejections.find((r) => r.providerId === providerId)?.reasons ?? [];
const matched = (d: MatchingDiagnostics, providerId: string) => d.matches.some((m) => m.providerId === providerId);
const candidate = (d: MatchingDiagnostics, providerId: string) => matched(d, providerId) || d.rejections.some((r) => r.providerId === providerId);

async function pendingBooking(suffix: string): Promise<{ bookingId: string; jobId: string }> {
  hoursAhead += 24;
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `P11-${RUN}-${suffix}`,
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(hoursAhead),
      status: BookingStatus.PENDING,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      estimatedDuration: 60,
    },
  });
  const job = await prisma.assignmentJob.create({ data: { bookingId: b.id, status: AssignmentJobStatus.PENDING } });
  return { bookingId: b.id, jobId: job.id };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('provider_service_capabilities') IS NOT NULL AS present`;
  if (!present) throw new Error("Phase 11 capability tables are not deployed on the test database");
  await setStrictFlag(false);
  ctx = await seedAdversarialFixtures(RUN);
  passwordHash = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId }, select: { password: true } })).password!;
  // Declared populations: customer A + the fixture partner are non-business; customer B is business.
  await setOrigin(ctx.customerA.id, "FIXTURE");
  await setOrigin(ctx.customerB.id, "REAL");
  await setOrigin(ctx.vendorUserId, "FIXTURE");
  await setRequirements();
}, 120_000);

/**
 * Cleanup BY ID. `cleanupAdversarialFixtures` finds its users with `email: { contains: tag }`, but the
 * PII extension nulls `users.email` on every create (the address lives in `email_encrypted`), so that
 * lookup matches nothing and the helper is a silent no-op — reported, not fixed here. Every row this
 * suite created is deleted by the ids it recorded; the helper is still called for anything it can see.
 */
async function cleanupByIds() {
  const userIds = [...new Set([
    ctx.customerA.id, ctx.customerB.id, ctx.vendorUserId, ctx.legacyAdmin.id, ctx.supportAdmin.id, ctx.financeAdmin.id, ctx.superAdmin.id,
    ...extraUserIds,
  ])];
  const providerIds = [...new Set([ctx.providerId, ...extraProviderIds])];
  const serviceIds = [ctx.serviceId, raceServiceId].filter(Boolean);
  await deleteBookingsForUsers(userIds);
  await prisma.assignmentAttempt.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { providerId: { in: providerIds } }] } });
  await prisma.providerMatchScore.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { providerId: { in: providerIds } }] } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminUser.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.partnerPresence.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.provider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
}

afterAll(async () => {
  if (!dbOk) return;
  await setStrictFlag(false);
  await prisma.$executeRaw`UPDATE services SET business_id = NULL WHERE id = ${ctx.serviceId}`;
  await prisma.$executeRaw`DELETE FROM businesses WHERE id = ${BIZ_ID}`;
  await cleanupAdversarialFixtures(RUN);
  await cleanupByIds();
  await prisma.$executeRaw`DELETE FROM skills WHERE code = ${SKILL}`;
}, 90_000);

describe.serial("Phase 11 — capability gates through the real matcher", () => {
  test("baseline: with no typed requirements the fixture partner is matched and carries no rejection", async () => {
    if (!dbOk) return;
    const d = await diag(ctx.customerA.id);
    expect(d.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(matched(d, ctx.providerId)).toBe(true);
    expect(reasonsFor(d, ctx.providerId)).toEqual([]);
  });

  test("a PAUSED service (owner decision 2026-09-29: no approved method facts) offers no candidate, so an existing booking of it is never dispatched; re-activated it matches again", async () => {
    if (!dbOk) return;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { lifecycleStatus: "PAUSED", isActive: false } });
    try {
      const d = await diag(ctx.customerA.id);
      expect(d.serviceOffered).toBe(false);
      expect(d.candidateCount).toBe(0);
      expect(d.matches).toEqual([]);
      expect(await matchingService.findBestProviders({ serviceId: ctx.serviceId, customerId: ctx.customerA.id, latitude: LAT, longitude: LNG, scheduledDate: futureSlot(48) })).toEqual([]);
    } finally {
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { lifecycleStatus: "ACTIVE", isActive: true } });
    }
    const again = await diag(ctx.customerA.id);
    expect(again.serviceOffered).toBe(true);
    expect(matched(again, ctx.providerId)).toBe(true);
  });

  test("diagnostics preview includeOffline: an offline partner is still EVALUATED (presence refuses it) so strict-vs-legacy parity is never vacuous; dispatch keeps online-only", async () => {
    if (!dbOk) return;
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: false } });
    try {
      const online = await diag(ctx.customerA.id);
      expect(candidate(online, ctx.providerId)).toBe(false);
      // The candidate query keeps the top MATCHING_MAX_CANDIDATES (500) by rating. homigo_test carries
      // thousands of offline partners left by other suites, so with offline partners included this
      // fixture partner could fall outside the cap — that is population, not the semantics under test.
      const prevCap = process.env.MATCHING_MAX_CANDIDATES;
      process.env.MATCHING_MAX_CANDIDATES = "100000";
      const withOffline = await matchingService
        .findBestProvidersWithDiagnostics(
          { serviceId: ctx.serviceId, customerId: ctx.customerA.id, latitude: LAT, longitude: LNG, scheduledDate: futureSlot(48), maxResults: 100 },
          { includeOffline: true },
        )
        .finally(() => {
          if (prevCap === undefined) delete process.env.MATCHING_MAX_CANDIDATES;
          else process.env.MATCHING_MAX_CANDIDATES = prevCap;
        });
      expect(candidate(withOffline, ctx.providerId)).toBe(true);
      expect(matched(withOffline, ctx.providerId)).toBe(false);
      expect(withOffline.candidateCount).toBeGreaterThan(0);
      // Dispatch can never ask for it.
      let refused = "";
      try {
        await (matchingService as unknown as { runMatching: (r: MatchingRequest, o: object) => Promise<unknown> }).runMatching(
          { serviceId: ctx.serviceId, latitude: LAT, longitude: LNG, scheduledDate: futureSlot(48) }, { persist: true, record: true, includeOffline: true },
        );
      } catch (e) {
        refused = e instanceof Error ? e.message : String(e);
      }
      expect(refused).toMatch(/diagnostics-only/);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: true } });
    }
  });

  test("GF4 CERTIFICATION_MISSING → unverified CERTIFICATION_UNVERIFIED → GF5 CERTIFICATION_EXPIRED → valid VERIFIED matches; metric counts the rejection", async () => {
    if (!dbOk) return;
    await setRequirements({ requiredCertifications: [{ type: CERT }] });
    const p = ctx.providerId;
    await clearCerts(p);
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["CERTIFICATION_MISSING"]);

    const before = sumCounterWhere("matching_rejection_total", "CERTIFICATION_MISSING");
    await matchingService.findBestProviders({ serviceId: ctx.serviceId, customerId: ctx.customerA.id, latitude: LAT, longitude: LNG, scheduledDate: futureSlot(48) });
    expect(sumCounterWhere("matching_rejection_total", "CERTIFICATION_MISSING")).toBeGreaterThan(before);

    await cert(p, { status: "DECLARED" });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["CERTIFICATION_UNVERIFIED"]);

    await clearCerts(p);
    await cert(p, { status: "VERIFIED", expiresAt: past(1) });
    const d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["CERTIFICATION_EXPIRED"]);
    expect(d.rejections.find((r) => r.providerId === p)?.details[0]?.detail).toContain("EXPIRED");

    await clearCerts(p);
    await cert(p, { status: "VERIFIED" });
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
  });

  test("a certificate marked verificationRequired:false accepts a DECLARED row; a REVOKED row never counts", async () => {
    if (!dbOk) return;
    await setRequirements({ requiredCertifications: [{ type: CERT, verificationRequired: false }] });
    const p = ctx.providerId;
    await clearCerts(p);
    await cert(p, { status: "DECLARED" });
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    await clearCerts(p);
    await cert(p, { status: "REVOKED" });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["CERTIFICATION_EXPIRED"]);
    await clearCerts(p);
  });

  test("GF6 EQUIPMENT_MISSING only for REQUIRED; OPTIONAL / CUSTOMER_PROVIDED / NOT_REQUIRED never reject; out-of-service or DECLARED gear does not count", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await clearEquipment(p);
    await setRequirements({ requiredEquipment: [{ type: "ladder", requirement: "OPTIONAL" }, { type: "van", requirement: "CUSTOMER_PROVIDED" }, { type: "drill", requirement: "NOT_REQUIRED" }] });
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);

    await setRequirements({ requiredEquipment: [{ type: "ladder", requirement: "REQUIRED" }, { type: "van", requirement: "CUSTOMER_PROVIDED" }] });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["EQUIPMENT_MISSING"]);

    await equipment(p, "ladder", { status: "VERIFIED", operational: "OUT_OF_SERVICE" });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["EQUIPMENT_MISSING"]);
    await clearEquipment(p);
    await equipment(p, "ladder", { status: "DECLARED" });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["EQUIPMENT_MISSING"]);
    await clearEquipment(p);
    await equipment(p, "ladder");
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    await clearEquipment(p);
  });

  test("GF7 INSURANCE_INVALID: missing, expired and unverified all refuse; a valid verified policy matches", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await clearInsurance(p);
    await setRequirements({ requiredInsurance: [{ type: "public-liability" }] });
    let d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["INSURANCE_INVALID"]);
    expect(d.rejections.find((r) => r.providerId === p)?.details[0]?.detail).toBe("public-liability:MISSING");

    await insurance(p, "public-liability", { expiresAt: past(1) });
    d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["INSURANCE_INVALID"]);
    expect(d.rejections.find((r) => r.providerId === p)?.details[0]?.detail).toBe("public-liability:EXPIRED");

    await clearInsurance(p);
    await insurance(p, "public-liability", { status: "DECLARED" });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["INSURANCE_INVALID"]);

    await clearInsurance(p);
    await insurance(p, "public-liability");
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    await clearInsurance(p);
  });

  test("LANGUAGE_MISMATCH: no row, or proficiency below the minimum, refuses; nothing is inferred from a name", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await clearLanguages(p);
    await setRequirements({ languages: [{ code: "hi", minProficiency: "FLUENT" }] });
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["LANGUAGE_MISMATCH"]);
    await language(p, "hi", "CONVERSATIONAL");
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["LANGUAGE_MISMATCH"]);
    await language(p, "hi", "FLUENT");
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    await clearLanguages(p);
  });

  test("SKILL_MISSING for a typed skill (verifiedOnly refuses DECLARED); several failing gates are all reported, in order", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await clearCerts(p);
    await setRequirements({ skills: [{ code: SKILL, verifiedOnly: true }], requiredCertifications: [{ type: CERT }], languages: [{ code: "ta" }] });
    let d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["SKILL_MISSING", "CERTIFICATION_MISSING", "LANGUAGE_MISMATCH"]);
    await skill(p, SKILL, "DECLARED");
    d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["SKILL_MISSING", "CERTIFICATION_MISSING", "LANGUAGE_MISMATCH"]);
    await skill(p, SKILL, "VERIFIED");
    await cert(p);
    await language(p, "ta", "BASIC");
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    await clearCerts(p);
    await clearLanguages(p);
    await setRequirements();
  });
});

describe.serial("Phase 11 — profile gates read the provider record", () => {
  test("KYC, background check, experience and academy training each refuse until the record meets them", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    const before = await prisma.provider.findUniqueOrThrow({ where: { id: p }, select: { isVerified: true, backgroundCheckStatus: true, experienceYears: true } });
    const mod = await prisma.partnerAcademyModule.create({ data: { slug: `p11-train-${RUN}`, title: "P11 training", contentType: "ARTICLE", isPublished: true, categoryIds: [] } });
    try {
      await prisma.provider.update({ where: { id: p }, data: { isVerified: false, backgroundCheckStatus: "PENDING", experienceYears: 1 } });
      await setRequirements({ kycRequired: true, backgroundCheckRequired: true, experienceYears: 3, trainingModules: [mod.slug] });
      expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["KYC_UNVERIFIED", "BACKGROUND_CHECK_NOT_CLEARED", "EXPERIENCE_INSUFFICIENT", "TRAINING_INCOMPLETE"]);

      await prisma.provider.update({ where: { id: p }, data: { isVerified: true, backgroundCheckStatus: "CLEARED", experienceYears: 3 } });
      expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["TRAINING_INCOMPLETE"]);

      // A module that was opened but not finished is not completed training.
      const progress = await prisma.partnerAcademyProgress.create({ data: { providerId: p, moduleId: mod.id } });
      expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["TRAINING_INCOMPLETE"]);
      await prisma.partnerAcademyProgress.update({ where: { id: progress.id }, data: { completedAt: new Date() } });
      expect(matched(await diag(ctx.customerA.id), p)).toBe(true);

      // A failed check refuses again, and a service that asks for nothing ignores the record.
      await prisma.provider.update({ where: { id: p }, data: { backgroundCheckStatus: "FAILED" } });
      expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["BACKGROUND_CHECK_NOT_CLEARED"]);
      await setRequirements();
      expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    } finally {
      await prisma.partnerAcademyModule.delete({ where: { id: mod.id } });
      await prisma.provider.update({ where: { id: p }, data: before });
      await setRequirements();
    }
  });
});

describe.serial("Phase 11 — a business customer gets business partners only unless the owner turns the seed fallback on", () => {
  /** `true` / `false` write an explicit flag row (which always decides); `null` removes the row (environment default). */
  async function setSeedFallback(enabled: boolean | null) {
    if (enabled === null) {
      await prisma.platformFeatureFlag.deleteMany({ where: { key: SEED_PARTNER_FALLBACK_FLAG } });
    } else {
      await prisma.platformFeatureFlag.upsert({
        where: { key: SEED_PARTNER_FALLBACK_FLAG },
        create: { key: SEED_PARTNER_FALLBACK_FLAG, enabled, rolloutPct: 100, environment: currentEnvironment(), description: `p11 test ${RUN}` },
        update: { enabled, rolloutPct: 100, environment: currentEnvironment() },
      });
    }
    await invalidateFlagCache(SEED_PARTNER_FALLBACK_FLAG);
  }

  test("with no flag row the environment decides: on only where the marketplace is the seed accounts; an explicit row always wins", async () => {
    if (!dbOk) return;
    expect(seedPartnerFallbackDefault("dev")).toBe(true);
    expect(seedPartnerFallbackDefault("Development")).toBe(true);
    expect(seedPartnerFallbackDefault("local")).toBe(true);
    for (const env of ["production", "staging", "test", "prod", ""]) expect(seedPartnerFallbackDefault(env)).toBe(false);
    try {
      await setSeedFallback(null);
      expect(await seedPartnerFallbackPolicy()).toEqual({ enabled: seedPartnerFallbackDefault(currentEnvironment()), source: "ENVIRONMENT_DEFAULT" });
      await setSeedFallback(false);
      expect(await seedPartnerFallbackPolicy()).toEqual({ enabled: false, source: "FLAG" });
      await setSeedFallback(true);
      expect(await seedPartnerFallbackPolicy()).toEqual({ enabled: true, source: "FLAG" });
    } finally {
      await setSeedFallback(null);
    }
  });

  test("flag off: a paid business job with no business partner matches nobody; flag on: the on-duty seed partner, never a suite fixture", async () => {
    if (!dbOk) return;
    const svc = await prisma.service.create({
      data: { ...LIVE_FIXTURE_SERVICE, name: `P11 seed ${RUN}`, slug: `p11-seed-${TAG}`, description: "seed fallback fixture", category: `p11seed-${RUN}`, basePrice: 500, estimatedDuration: 60, availableCities: ["Noida"], tags: ["adv"] },
    });
    // The only two partners who offer this service: the application's own seed account and a suite fixture.
    const seedUser = await prisma.user.create({
      data: {
        email: `${TAG}-seed@homigo.demo`, dataOrigin: "INFERRED_SYNTHETIC", phoneNumber: fixturePhone(RUN, "seed"), firstName: "P11", lastName: "seed",
        password: passwordHash, role: UserRole.VENDOR, isEmailVerified: true, isPhoneVerified: true,
      },
    });
    const seed = await prisma.provider.create({
      data: {
        userId: seedUser.id, serviceCategories: [svc.id], serviceRegions: [], serviceRadiusKm: 50, baseLatitude: LAT, baseLongitude: LNG, workingDays: ALL_DAYS,
        workingHoursStart: "00:00", workingHoursEnd: "23:59", isVerified: true, isApproved: true, lifecycleState: "ACTIVE", isActive: true, isOnline: true, rating: 4.2,
      },
    });
    extraProviderIds.push(seed.id);
    extraUserIds.push(seedUser.id);
    const fixture = await mkProvider("seedfx", "FIXTURE");
    await prisma.provider.update({ where: { id: fixture.providerId }, data: { serviceCategories: [svc.id] } });
    try {
      await setSeedFallback(false);
      const off = await diag(ctx.customerB.id, { serviceId: svc.id });
      expect(off.matches).toEqual([]);
      expect(candidate(off, seed.id)).toBe(false);
      expect((await loadServiceGateContext(svc.id, ctx.customerB.id)).seedPartnerFallback).toBe(false);

      await setSeedFallback(true);
      expect((await loadServiceGateContext(svc.id, ctx.customerB.id)).seedPartnerFallback).toBe(true);
      const on = await diag(ctx.customerB.id, { serviceId: svc.id });
      // The seed account is recognised although its address is stored encrypted (`users.email` is NULL).
      expect((await prisma.user.findUniqueOrThrow({ where: { id: seedUser.id }, select: { email: true } })).email).toBeNull();
      expect(on.matches.map((m) => m.providerId)).toEqual([seed.id]);
      expect(matched(on, fixture.providerId)).toBe(false);
      // The switch never applies to a fixture customer, who keeps its own population.
      expect((await loadServiceGateContext(svc.id, ctx.customerA.id)).seedPartnerFallback).toBe(false);
      const forFixture = await diag(ctx.customerA.id, { serviceId: svc.id });
      expect(matched(forFixture, fixture.providerId)).toBe(true);
    } finally {
      await setSeedFallback(null);
      await prisma.providerMatchScore.deleteMany({ where: { providerId: { in: [seed.id, fixture.providerId] } } });
      await prisma.provider.updateMany({ where: { id: { in: [seed.id, fixture.providerId] } }, data: { serviceCategories: [] } });
      await prisma.service.delete({ where: { id: svc.id } });
    }
  });
});

describe.serial("Phase 11 — GF8 strict service capability (feature flag)", () => {
  let legacy: { providerId: string };

  test("legacy mode: a partner with only the String[] entry is matched; STRICT refuses it with SERVICE_CAPABILITY_MISSING", async () => {
    if (!dbOk) return;
    legacy = await mkProvider("legacy", "FIXTURE");
    let d = await diag(ctx.customerA.id);
    expect(d.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(matched(d, legacy.providerId)).toBe(true);

    await setStrictFlag(true);
    d = await diag(ctx.customerA.id);
    expect(d.serviceCapabilityMode).toBe("STRICT");
    expect(reasonsFor(d, legacy.providerId)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
    expect(reasonsFor(d, ctx.providerId)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
  });

  test("STRICT: an ACTIVE capability row admits the partner; REQUESTED / SUSPENDED do not", async () => {
    if (!dbOk) return;
    await serviceCapability(legacy.providerId, "REQUESTED");
    expect(reasonsFor(await diag(ctx.customerA.id), legacy.providerId)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
    await serviceCapability(legacy.providerId, "ACTIVE");
    expect(matched(await diag(ctx.customerA.id), legacy.providerId)).toBe(true);
    await serviceCapability(legacy.providerId, "SUSPENDED");
    expect(reasonsFor(await diag(ctx.customerA.id), legacy.providerId)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
  });

  test("STRICT: the typed row is the way in even without the String[] entry", async () => {
    if (!dbOk) return;
    await prisma.provider.update({ where: { id: legacy.providerId }, data: { serviceCategories: [] } });
    await serviceCapability(legacy.providerId, "ACTIVE");
    expect(matched(await diag(ctx.customerA.id), legacy.providerId)).toBe(true);
    await prisma.provider.update({ where: { id: legacy.providerId }, data: { serviceCategories: [ctx.serviceId] } });
  });

  test("flag off again: legacy mode keeps the legacy partner; a partner WITH rows still needs an ACTIVE one", async () => {
    if (!dbOk) return;
    await setStrictFlag(false);
    await clearServiceCapability(legacy.providerId);
    let d = await diag(ctx.customerA.id);
    expect(d.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(matched(d, legacy.providerId)).toBe(true);
    expect(matched(d, ctx.providerId)).toBe(true);
    // Rows present but none ACTIVE: the partner has entered the typed model and is judged by it.
    await serviceCapability(legacy.providerId, "REVOKED");
    d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, legacy.providerId)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
    await clearServiceCapability(legacy.providerId);
  });
});

describe.serial("Phase 11 — GF11 business-owned service", () => {
  test("services.business_id without membership → BUSINESS_NOT_AUTHORIZED; active membership → matched; ended membership refuses again", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await prisma.$executeRaw`INSERT INTO businesses (id, name, status, data_origin) VALUES (${BIZ_ID}, ${`P11 Biz ${RUN}`}, 'ACTIVE', 'FIXTURE'::"DataOrigin") ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`UPDATE services SET business_id = ${BIZ_ID} WHERE id = ${ctx.serviceId}`;
    let d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);

    await prisma.$executeRaw`INSERT INTO business_providers (business_id, provider_id, role, active, effective_from, data_origin) VALUES (${BIZ_ID}, ${p}, 'MEMBER', true, ${past(1)}, 'FIXTURE'::"DataOrigin")`;
    d = await diag(ctx.customerA.id);
    expect(matched(d, p)).toBe(true);

    await prisma.$executeRaw`UPDATE business_providers SET effective_to = ${new Date()} WHERE business_id = ${BIZ_ID} AND provider_id = ${p}`;
    d = await diag(ctx.customerA.id);
    expect(reasonsFor(d, p)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);

    await prisma.$executeRaw`UPDATE business_providers SET effective_to = NULL WHERE business_id = ${BIZ_ID} AND provider_id = ${p}`;
    await prisma.$executeRaw`UPDATE businesses SET status = 'SUSPENDED' WHERE id = ${BIZ_ID}`;
    expect(reasonsFor(await diag(ctx.customerA.id), p)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);

    await prisma.$executeRaw`UPDATE services SET business_id = NULL WHERE id = ${ctx.serviceId}`;
    await prisma.$executeRaw`DELETE FROM businesses WHERE id = ${BIZ_ID}`;
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
  });
});

describe.serial("Phase 11 — presence and provenance", () => {
  test("Q17 PRESENCE_STALE for a near-term job; a far appointment does not need a live ping", async () => {
    if (!dbOk) return;
    const stale = await mkProvider("stale", "FIXTURE");
    const fresh = await mkProvider("fresh", "FIXTURE");
    await presence(stale.providerId, new Date(Date.now() - 10 * 60_000));
    await presence(fresh.providerId, new Date());
    const near = new Date(Date.now() + 2 * 3_600_000);
    const d = await diag(ctx.customerA.id, { scheduledDate: near });
    expect(reasonsFor(d, stale.providerId)).toEqual(["PRESENCE_STALE"]);
    expect(matched(d, fresh.providerId)).toBe(true);
    const far = await diag(ctx.customerA.id);
    expect(matched(far, stale.providerId)).toBe(true);
  });

  test("GF9 a fixture partner is never a candidate for a business customer, and a business partner never for a fixture customer", async () => {
    if (!dbOk) return;
    const biz = await mkProvider("biz", "REAL");
    bizProviderId = biz.providerId;
    const forBusiness = await diag(ctx.customerB.id);
    expect(candidate(forBusiness, ctx.providerId)).toBe(false);
    expect(matched(forBusiness, biz.providerId)).toBe(true);
    const forFixture = await diag(ctx.customerA.id);
    expect(candidate(forFixture, biz.providerId)).toBe(false);
    expect(matched(forFixture, ctx.providerId)).toBe(true);
    // An anonymous caller is business.
    const anonymous = await diag(undefined);
    expect(candidate(anonymous, ctx.providerId)).toBe(false);
    expect(matched(anonymous, biz.providerId)).toBe(true);
  });

  test("GF10 unknown provenance (data_origin NULL) counts as business by the analytics-scope policy: matched for a business customer, invisible to a fixture one", async () => {
    if (!dbOk) return;
    const unknown = await mkProvider("unknown", null);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: unknown.userId }, select: { dataOrigin: true } });
    expect(row.dataOrigin).toBeNull();
    const forBusiness = await diag(ctx.customerB.id);
    expect(matched(forBusiness, unknown.providerId)).toBe(true);
    const forFixture = await diag(ctx.customerA.id);
    expect(candidate(forFixture, unknown.providerId)).toBe(false);
  });

  test("a FIXTURE-origin certificate does not satisfy a business booking; a REAL one does", async () => {
    if (!dbOk) return;
    const biz = bizProviderId;
    await setRequirements({ requiredCertifications: [{ type: CERT }] });
    await clearCerts(biz);
    await cert(biz, { origin: "FIXTURE" });
    expect(reasonsFor(await diag(ctx.customerB.id), biz)).toEqual(["CERTIFICATION_MISSING"]);
    await clearCerts(biz);
    await cert(biz, { origin: "REAL" });
    expect(matched(await diag(ctx.customerB.id), biz)).toBe(true);
    await clearCerts(biz);
    await setRequirements();
  });
});

describe.serial("Phase 11 — offer-time and accept-time re-check", () => {
  const offer = (providerId: string, capability: Awaited<ReturnType<typeof loadServiceGateContext>>) =>
    prisma.$transaction((tx) => partnerOperationsService.assertOfferEligible(tx, providerId, { latitude: LAT, longitude: LNG, scheduledDate: futureSlot(72), capability, livePresenceRequired: false }));
  const accept = (providerId: string, capability: Awaited<ReturnType<typeof loadServiceGateContext>>) =>
    prisma.$transaction((tx) => partnerOperationsService.assertAcceptEligible(tx, providerId, capability, futureSlot(72)));

  test("a certificate that expires or is revoked after matching blocks both the offer and the accept with its reason code", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await setRequirements({ requiredCertifications: [{ type: CERT }] });
    await clearCerts(p);
    await cert(p);
    const gate = await loadServiceGateContext(ctx.serviceId, ctx.customerA.id);
    expect(matched(await diag(ctx.customerA.id), p)).toBe(true);
    expect(await offer(p, gate)).toBeNull();
    expect(await accept(p, gate)).toBeNull();

    await prisma.$executeRaw`UPDATE provider_certifications SET expires_at = ${past(1)} WHERE provider_id = ${p} AND certification_type = ${CERT}`;
    expect(await offer(p, gate)).toBe("CERTIFICATION_EXPIRED");
    expect(await accept(p, gate)).toBe("CERTIFICATION_EXPIRED");

    await prisma.$executeRaw`UPDATE provider_certifications SET expires_at = ${future(30)}, status = 'REVOKED', verified_by = NULL, verified_at = NULL, revoked_at = now(), revoked_reason = 'test' WHERE provider_id = ${p} AND certification_type = ${CERT}`;
    expect(await offer(p, gate)).toBe("CERTIFICATION_EXPIRED");
    await clearCerts(p);
    await setRequirements();
  });

  test("a service capability revoked after matching blocks the offer; provenance is re-checked too; compliance restriction is real state", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    const gate = await loadServiceGateContext(ctx.serviceId, ctx.customerA.id);
    await serviceCapability(p, "ACTIVE");
    expect(await offer(p, gate)).toBeNull();
    await serviceCapability(p, "REVOKED");
    expect(await offer(p, gate)).toBe("SERVICE_CAPABILITY_MISSING");
    expect(await accept(p, gate)).toBe("SERVICE_CAPABILITY_MISSING");
    await clearServiceCapability(p);

    // The booking is a business customer's: the fixture partner fails provenance at offer time.
    const bizGate = await loadServiceGateContext(ctx.serviceId, ctx.customerB.id);
    expect(await offer(p, bizGate)).toBe("PROVENANCE_INVALID");

    await prisma.provider.update({ where: { id: p }, data: { complianceRestricted: true } });
    expect(await offer(p, gate)).toBe("ACCOUNT_RESTRICTED");
    expect(await accept(p, gate)).toBe("ACCOUNT_RESTRICTED");
    await prisma.provider.update({ where: { id: p }, data: { complianceRestricted: false } });
    expect(await offer(p, gate)).toBeNull();
  });

  test("an offer through the ids form (no prebuilt context) reads the service through the transaction", async () => {
    if (!dbOk) return;
    const p = ctx.providerId;
    await setRequirements({ requiredInsurance: [{ type: "public-liability" }] });
    const blocked = await prisma.$transaction((tx) =>
      partnerOperationsService.assertOfferEligible(tx, p, { latitude: LAT, longitude: LNG, scheduledDate: futureSlot(72), capability: { serviceId: ctx.serviceId, customerId: ctx.customerA.id }, livePresenceRequired: false }),
    );
    expect(blocked).toBe("INSURANCE_INVALID");
    await setRequirements();
  });
});

describe.serial("Phase 11 — Q18/Q20 duplicate assignment race", () => {
  test("two concurrent dispatch ticks for one job produce exactly one offer", async () => {
    if (!dbOk) return;
    resetMemoryLocksForTests();
    // An isolated service (its own category) with ONE partner: the shared test database carries
    // leaked fixture partners from other suites, and a race proof must not depend on them.
    const svc = await prisma.service.create({
      data: { ...LIVE_FIXTURE_SERVICE, name: `P11 race ${RUN}`, slug: `p11-race-${TAG}`, description: "race fixture", category: `p11race-${RUN}`, basePrice: 500, estimatedDuration: 60, availableCities: ["Noida"], tags: ["adv"] },
    });
    raceServiceId = svc.id;
    const racer = await mkProvider("race", "FIXTURE");
    await prisma.provider.update({ where: { id: racer.providerId }, data: { serviceCategories: [svc.id] } });
    hoursAhead += 24;
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `P11-${RUN}-race`, userId: ctx.customerA.id, serviceId: svc.id, addressId: ctx.addressAId, scheduledDate: futureSlot(hoursAhead),
        status: BookingStatus.PENDING, paymentStatus: PaymentStatus.SUCCESS, paymentMethod: "razorpay", baseAmount: 500, finalAmount: 500, totalAmount: 500, estimatedDuration: 60,
      },
    });
    const job = await prisma.assignmentJob.create({ data: { bookingId: booking.id, status: AssignmentJobStatus.PENDING } });
    const only = await diag(ctx.customerA.id, { serviceId: svc.id });
    expect(only.matches.map((m) => m.providerId)).toEqual([racer.providerId]);

    const [a, b] = await Promise.all([assignmentEngine.dispatchBookingNow(booking.id), assignmentEngine.dispatchBookingNow(booking.id)]);
    expect(a || b).toBe(true);
    const attempts = await prisma.assignmentAttempt.findMany({ where: { jobId: job.id }, select: { providerId: true, status: true } });
    expect(attempts).toEqual([{ providerId: racer.providerId, status: AssignmentAttemptStatus.SENT }]);
    const after = await prisma.assignmentJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, currentProviderId: true } });
    expect(after.status).toBe(AssignmentJobStatus.DISPATCHED);
    expect(after.currentProviderId).toBe(racer.providerId);
    // Out of every later candidate set.
    await prisma.provider.update({ where: { id: racer.providerId }, data: { isOnline: false } });
  }, 60_000);
});

describe.serial("Phase 11 — scale: determinism, one batch per match, latency", () => {
  const BULK = 50;

  test(`insert ${BULK} candidate partners`, async () => {
    if (!dbOk) return;
    for (let i = 0; i < BULK; i += 1) await mkProvider(`bulk${i}`, "FIXTURE");
    const d = await diag(ctx.customerA.id);
    expect(d.candidateCount).toBeGreaterThanOrEqual(BULK + 1);
  }, 120_000);

  test("deterministic: two identical runs return the same matches and rejections in the same order", async () => {
    if (!dbOk) return;
    await setRequirements({ requiredCertifications: [{ type: CERT }] });
    await clearCerts(ctx.providerId);
    await cert(ctx.providerId);
    const a = await diag(ctx.customerA.id);
    const b = await diag(ctx.customerA.id);
    expect(a.matches.map((m) => m.providerId)).toEqual(b.matches.map((m) => m.providerId));
    expect(a.rejections.map((r) => `${r.providerId}:${r.reasons.join(",")}`)).toEqual(b.rejections.map((r) => `${r.providerId}:${r.reasons.join(",")}`));
    expect(a.counts).toEqual(b.counts);
    expect(a.matches.map((m) => m.providerId)).toContain(ctx.providerId);
    expect(a.counts.CERTIFICATION_MISSING).toBeGreaterThanOrEqual(BULK);
  });

  test("no N+1: one capability batch per match regardless of candidate count; latency with the whole set", async () => {
    if (!dbOk) return;
    const before = __capabilityLoaderCalls();
    const d = await diag(ctx.customerA.id);
    expect(__capabilityLoaderCalls() - before).toBe(1);
    expect(d.candidateCount).toBeGreaterThanOrEqual(BULK + 1);
    // Reported, not asserted against a fixed budget: the number depends on the machine.
    console.log(`p11 diagnostics latency: candidates=${d.candidateCount} matches=${d.matches.length} rejections=${d.rejections.length} latencyMs=${d.latencyMs}`);
    expect(d.latencyMs).toBeLessThan(10_000);
    await clearCerts(ctx.providerId);
    await setRequirements();
  });
});

describe.serial("Phase 11 — admin diagnostics route", () => {
  test("GET /api/admin/bookings/:id/matching-diagnostics: admin 200 with rejections + counts; customer refused; unknown 404", async () => {
    if (!dbOk) return;
    await setRequirements({ requiredCertifications: [{ type: CERT }] });
    await clearCerts(ctx.providerId);
    const { bookingId } = await pendingBooking("diag");
    const r = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics`, undefined, admin());
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.data.bookingId).toBe(bookingId);
    expect(r.json.data.jobLocated).toBe(true);
    expect(r.json.data.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(r.json.data.counts.CERTIFICATION_MISSING).toBeGreaterThanOrEqual(1);
    const mine = r.json.data.rejections.find((x: any) => x.providerId === ctx.providerId);
    expect(mine.reasons).toEqual(["CERTIFICATION_MISSING"]);
    expect(mine.details[0]).toEqual({ reason: "CERTIFICATION_MISSING", detail: CERT });
    expect(typeof r.json.data.latencyMs).toBe("number");
    // Read-only: no match score was persisted for this customer by the diagnostics run.
    const persisted = await prisma.providerMatchScore.count({ where: { userId: ctx.customerA.id, providerId: ctx.providerId, createdAt: { gte: new Date(Date.now() - 5_000) } } });
    expect(persisted).toBe(0);

    const asCustomer = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics`, undefined, bearer(ctx.customerA));
    expect([401, 403]).toContain(asCustomer.status);
    const missing = await call("GET", `/api/admin/bookings/does-not-exist/matching-diagnostics`, undefined, admin());
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("NOT_FOUND");
    await setRequirements();

    // ?includeOffline=1: with the partner offline it is still a candidate (refused by presence), so
    // a strict-vs-legacy comparison is not vacuous; the default stays online-only; a bad value is refused.
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: false } });
    try {
      const def = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics`, undefined, admin());
      expect(def.json.data.offlineIncluded).toBe(false);
      expect(def.json.data.rejections.some((x: any) => x.providerId === ctx.providerId) || def.json.data.matches.some((x: any) => x.providerId === ctx.providerId)).toBe(false);
      const off = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?includeOffline=1&mode=STRICT`, undefined, admin());
      expect(off.status).toBe(200);
      expect(off.json.data.offlineIncluded).toBe(true);
      expect(off.json.data.candidateCount).toBeGreaterThan(0);
      expect((await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?includeOffline=yes`, undefined, admin())).status).toBe(400);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: true } });
    }
  });

  test("?mode= previews the other capability mode read-only: no flag row written, dispatch mode unchanged, bad mode refused", async () => {
    if (!dbOk) return;
    await setRequirements();
    const flagRows = () => prisma.platformFeatureFlag.count({ where: { key: "matching.strict_service_capability" } });
    const flagsBefore = await flagRows();
    const { bookingId } = await pendingBooking("diag-preview");

    const legacy = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?mode=LEGACY_FALLBACK`, undefined, admin());
    const strict = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?mode=STRICT`, undefined, admin());
    expect(legacy.status).toBe(200);
    expect(strict.status).toBe(200);
    expect(legacy.json.data.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(strict.json.data.serviceCapabilityMode).toBe("STRICT");
    expect(strict.json.data.capabilityModePreviewed).toBe(true);

    // The fixture provider holds no typed service row: strict refuses it for exactly that reason,
    // legacy does not name that reason at all.
    const reasonsOf = (r: any) => (r.json.data.rejections.find((x: any) => x.providerId === ctx.providerId)?.reasons ?? []) as string[];
    const rowsForProvider = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM provider_service_capabilities WHERE provider_id = ${ctx.providerId}`;
    if (Number(rowsForProvider[0]!.n) === 0) {
      expect(reasonsOf(strict)).toContain("SERVICE_CAPABILITY_MISSING");
      expect(reasonsOf(legacy)).not.toContain("SERVICE_CAPABILITY_MISSING");
    }

    // Nothing was switched: no flag row appeared and the un-previewed call still reads the flag.
    expect(await flagRows()).toBe(flagsBefore);
    const plain = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics`, undefined, admin());
    expect(plain.json.data.serviceCapabilityMode).toBe("LEGACY_FALLBACK");
    expect(plain.json.data.capabilityModePreviewed).toBe(false);

    const bad = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?mode=OFF`, undefined, admin());
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INVALID_MODE");
    const asCustomer = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics?mode=STRICT`, undefined, bearer(ctx.customerA));
    expect([401, 403]).toContain(asCustomer.status);
  });

  test("a job with no usable position is diagnosed without an invented location: every candidate LOCATION_GATE_FAILED (job_location_unknown)", async () => {
    if (!dbOk) return;
    // `addresses.latitude/longitude` are NOT NULL, so the engine's "unknown position" branch is
    // reached exactly as `diagnosticsForBooking` reaches it for a booking without an address: NaN.
    const d = await diag(ctx.customerA.id, { latitude: Number.NaN, longitude: Number.NaN });
    expect(d.matches).toEqual([]);
    expect(d.candidateCount).toBeGreaterThanOrEqual(1);
    expect(d.rejections.length).toBe(d.candidateCount);
    for (const rej of d.rejections) {
      expect(rej.reasons).toContain("LOCATION_GATE_FAILED");
      expect(rej.details.find((x) => x.reason === "LOCATION_GATE_FAILED")?.detail).toBe("job_location_unknown");
    }
    expect(d.counts.LOCATION_GATE_FAILED).toBe(d.candidateCount);
  });
});
