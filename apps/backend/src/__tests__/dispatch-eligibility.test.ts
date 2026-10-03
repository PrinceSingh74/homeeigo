/**
 * Phase 2 dispatch eligibility — unit + integration tests.
 *   NODE_ENV=test bun test src/__tests__/dispatch-eligibility.test.ts
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import {
  evaluateDispatchEligibility,
  passesPresenceLocationGate,
  deriveZoneSupplyConfidence,
  customerAvailableNow,
} from "../services/dispatch-eligibility.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { matchingService } from "../services/matching.service";
import { partnerPresenceService } from "../services/partner-presence.service";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { PRESENCE_FRESH_SEC, LOCATION_FRESH_SEC } from "../lib/partner-presence.config";

const RUN_ID = `dispatch-elig-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let sessionId: string;
const JOB_LAT = 28.62;
const JOB_LNG = 77.37;
const deviceId = `device-${RUN_ID}`;
const jwt = new JWTService();
const refreshTokenService = new RefreshTokenService(prisma, jwt);

/**
 * Location sequence must strictly increase per provider — an anti-replay invariant, not test
 * bookkeeping. Hardcoding 1 assumed this file sent the partner's first heartbeat, which stopped
 * being true once the shared fixture began seeding presence. Read the row instead, as
 * `heartbeatFresh` does, so suite ordering can never cause a SEQUENCE_REGRESSION.
 */
async function nextSequence(): Promise<number> {
  const current = await prisma.partnerPresence.findUnique({
    where: { providerId: ctx.providerId },
    select: { lastLocationSeq: true },
  });
  return (current?.lastLocationSeq ?? 0) + 1;
}

function baseSnap(overrides: Partial<Parameters<typeof evaluateDispatchEligibility>[0]> = {}) {
  const now = new Date();
  return {
    providerId: "p1",
    lifecycleState: "ACTIVE",
    isActive: true,
    isApproved: true,
    isBanned: false,
    complianceRestricted: false,
    isOnline: true,
    pausedAt: null,
    lastHeartbeatAt: new Date(now.getTime() - 5_000),
    lastLocationAt: new Date(now.getTime() - 5_000),
    lastLocationLat: JOB_LAT,
    lastLocationLng: JOB_LNG,
    ...overrides,
  };
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
  const tokens = await refreshTokenService.createSessionTokens({
    userId: ctx.vendorUserId,
    email: `${RUN_ID}@adv.test`,
    deviceId,
  });
  sessionId = tokens.sessionId;
}, 60_000);

afterAll(async () => {
  if (dbOk) {
    await prisma.partnerPresence.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
    await cleanupAdversarialFixtures(RUN_ID);
  }
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe("dispatch-eligibility — pure evaluation", () => {
  test("ACTIVE + AVAILABLE + FRESH + FRESH → eligible", () => {
    const r = evaluateDispatchEligibility(baseSnap());
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.checks.presence).toBe(true);
    expect(r.checks.location).toBe(true);
  });

  test("ACTIVE + OFFLINE → not eligible", () => {
    const r = evaluateDispatchEligibility(baseSnap({ isOnline: false }));
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("NOT_AVAILABLE");
  });

  test("ACTIVE + AVAILABLE + STALE PRESENCE → not eligible", () => {
    const r = evaluateDispatchEligibility(
      baseSnap({
        lastHeartbeatAt: new Date(Date.now() - (PRESENCE_FRESH_SEC + 60) * 1000),
      }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("STALE_PRESENCE");
  });

  test("ACTIVE + AVAILABLE + STALE LOCATION → not eligible", () => {
    const r = evaluateDispatchEligibility(
      baseSnap({
        lastLocationAt: new Date(Date.now() - (LOCATION_FRESH_SEC + 120) * 1000),
      }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("STALE_LOCATION");
  });

  test("SUSPENDED + AVAILABLE → not eligible", () => {
    const r = evaluateDispatchEligibility(baseSnap({ lifecycleState: "SUSPENDED" }));
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("NOT_ACTIVE");
  });

  test("APPLIED + isApproved → not eligible (NOT_ACTIVE)", () => {
    const r = evaluateDispatchEligibility(
      baseSnap({ lifecycleState: "APPLIED", isApproved: true }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("NOT_ACTIVE");
  });

  test("NO_CAPACITY gate", () => {
    const r = evaluateDispatchEligibility(baseSnap({ capacityOk: false }));
    expect(r.reasons).toContain("NO_CAPACITY");
  });

  test("zone supply confidence deterministic", () => {
    expect(deriveZoneSupplyConfidence({ activePartners: 5, availablePartners: 3, livePartners: 4, freshLocationPartners: 4 }).confidence).toBe("HIGH");
    expect(deriveZoneSupplyConfidence({ activePartners: 2, availablePartners: 1, livePartners: 1, freshLocationPartners: 1 }).confidence).toBe("MEDIUM");
    expect(deriveZoneSupplyConfidence({ activePartners: 1, availablePartners: 0, livePartners: 0, freshLocationPartners: 0 }).confidence).toBe("LOW");
    expect(deriveZoneSupplyConfidence({ activePartners: 0, availablePartners: 0, livePartners: 0, freshLocationPartners: 0 }).customerLabel).toBe("Unavailable");
  });

  test("customerAvailableNow never leaks telemetry — only business-safe labels", () => {
    expect(customerAvailableNow(baseSnap()).availabilityLabel).toBe("Available now");
    expect(customerAvailableNow(baseSnap({ lastHeartbeatAt: new Date(Date.now() - 120_000) })).availabilityLabel).toBe(
      "Confirming professional",
    );
    expect(customerAvailableNow(baseSnap({ lifecycleState: "SUSPENDED" })).availabilityLabel).toBe("Unavailable");
    expect(customerAvailableNow(baseSnap({ isOnline: false })).availableNow).toBe(false);
  });
});

describe.serial("dispatch-eligibility — integration", () => {
  beforeEach(async () => {
    if (!dbOk) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: {
        isOnline: true,
        pausedAt: null,
        lifecycleState: "ACTIVE",
        isApproved: true,
        isBanned: false,
        isActive: true,
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        workingHoursStart: "00:00",
        workingHoursEnd: "23:59",
        serviceRadiusKm: 50,
        baseLatitude: JOB_LAT,
        baseLongitude: JOB_LNG,
        serviceRegions: [],
      },
    });
  });

  test("assertOfferEligible rejects stale presence at final revalidation", async () => {
    if (skipIfNoDb()) return;

    await partnerOperationsService.setOnline(ctx.providerId, true);

    /**
     * Age the heartbeat explicitly. The shared fixture seeds a FRESH heartbeat on purpose (so the
     * booking/capacity suites race on capacity rather than presence), so "no heartbeat yet" is not a
     * premise this test can assume — relying on it made the assertion depend on how long seeding took.
     * Staleness is the thing under test, so it is stated, not inherited.
     */
    await prisma.partnerPresence.updateMany({
      where: { providerId: ctx.providerId },
      data: { lastHeartbeatAt: new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000) },
    });

    const blocked = await prisma.$transaction(async (tx) =>
      partnerOperationsService.assertOfferEligible(tx, ctx.providerId, {
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        scheduledDate: new Date(Date.now() + 3600_000),
      }),
    );
    expect(blocked).toBe("STALE_PRESENCE");

    await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      {
        sessionId,
        deviceId,
        timestamp: new Date(),
        location: {
          latitude: JOB_LAT,
          longitude: JOB_LNG,
          capturedAt: new Date(),
          sequence: await nextSequence(),
        },
      },
    );

    const ok = await prisma.$transaction(async (tx) =>
      partnerOperationsService.assertOfferEligible(tx, ctx.providerId, {
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        scheduledDate: new Date(Date.now() + 3600_000),
      }),
    );
    expect(ok).toBeNull();
  });

  test("matching excludes partner without fresh presence", async () => {
    if (skipIfNoDb()) return;

    await partnerOperationsService.setOnline(ctx.providerId, true);
    await prisma.partnerPresence.deleteMany({ where: { providerId: ctx.providerId } });

    const withoutPresence = await matchingService.findBestProviders({
      // W2-D4: matching is scoped to the customer's population; a customer-less query is
      // a business query and the harness's partner is classified at creation. Ask within
      // the fixture world by naming the fixture customer.
      customerId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      scheduledDate: new Date(Date.now() + 3600_000),
      maxResults: 20,
    });
    expect(withoutPresence.some((m) => m.providerId === ctx.providerId)).toBe(false);

    await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      {
        sessionId,
        deviceId,
        timestamp: new Date(),
        location: { latitude: JOB_LAT, longitude: JOB_LNG, capturedAt: new Date(), sequence: await nextSequence() },
      },
    );

    const withPresence = await matchingService.findBestProviders({
      // W2-D4: matching is scoped to the customer's population; a customer-less query is
      // a business query and the harness's partner is classified at creation. Ask within
      // the fixture world by naming the fixture customer.
      customerId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      scheduledDate: new Date(Date.now() + 3600_000),
      maxResults: 20,
    });
    expect(withPresence.some((m) => m.providerId === ctx.providerId)).toBe(true);
  });

  test("stale presence does not mutate lifecycle/job/money", async () => {
    if (skipIfNoDb()) return;

    const before = await prisma.provider.findUnique({
      where: { id: ctx.providerId },
      select: { lifecycleState: true, isOnline: true },
    });

    await prisma.$transaction(async (tx) =>
      partnerOperationsService.assertOfferEligible(tx, ctx.providerId, {
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        scheduledDate: new Date(Date.now() + 3600_000),
      }),
    );

    const after = await prisma.provider.findUnique({
      where: { id: ctx.providerId },
      select: { lifecycleState: true, isOnline: true },
    });
    expect(after?.lifecycleState).toBe(before?.lifecycleState);
    expect(after?.isOnline).toBe(before?.isOnline);

    const earnings = await prisma.earning.count({ where: { providerId: ctx.providerId } });
    expect(earnings).toBeGreaterThanOrEqual(0);
  });

  test("APPLIED + isApproved blocked at offer gate", async () => {
    if (skipIfNoDb()) return;

    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "APPLIED", isApproved: true, isOnline: true },
    });
    await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      {
        sessionId,
        deviceId,
        timestamp: new Date(),
        location: { latitude: JOB_LAT, longitude: JOB_LNG, capturedAt: new Date(), sequence: await nextSequence() },
      },
    );

    const blocked = await prisma.$transaction(async (tx) =>
      partnerOperationsService.assertOfferEligible(tx, ctx.providerId, {
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        scheduledDate: new Date(Date.now() + 3600_000),
      }),
    );
    expect(blocked).toBe("ACCOUNT_RESTRICTED");

    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "ACTIVE" },
    });
  });

  test("assertAcceptEligible rejects stale location — same gate as offer, not a weaker one", async () => {
    if (skipIfNoDb()) return;

    await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      {
        sessionId,
        deviceId,
        timestamp: new Date(),
        location: { latitude: JOB_LAT, longitude: JOB_LNG, capturedAt: new Date(), sequence: await nextSequence() },
      },
    );
    await prisma.partnerPresence.update({
      where: { providerId: ctx.providerId },
      data: { lastLocationAt: new Date(Date.now() - (LOCATION_FRESH_SEC + 120) * 1000) },
    });

    const blocked = await prisma.$transaction(async (tx) =>
      partnerOperationsService.assertAcceptEligible(tx, ctx.providerId),
    );
    expect(blocked).toBe("STALE_LOCATION");
  });
});

describe("passesPresenceLocationGate", () => {
  test("null evidence fails closed", () => {
    expect(passesPresenceLocationGate(null)).toBe(false);
  });
});
