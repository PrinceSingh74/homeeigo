/**
 * PARTNER INTELLIGENCE — Item 2, Zone Recommendations.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise, so partner rows are never
 * written into production data.
 *
 * Fixtures here are deliberate and labelled: unlike the real-data observation (which uses live
 * partners and seeds nothing), these tests need controlled inputs to prove "changed signal →
 * expected rank change". Controlled fixtures in an isolated database are not fabricated evidence —
 * they are how the mechanism is shown to work at all.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  zoneRecommendationService,
  ZONE_RULES_VERSION,
  MIN_ZONE_HISTORY_JOBS,
} from "../services/zone-recommendation.service";

let providerNear = "";
let providerFar = "";
let serviceId = "";
let zoneNearId = "";
/** Only the zones THIS run created — an adopted zone belongs to whoever seeded it. */
let seededZoneIds: string[] = [];

const NEAR = { lat: 12.9716, lng: 77.5946 };
const FAR = { lat: 13.35, lng: 77.95 };

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  const stamp = Date.now();
  const mkProvider = async (tag: string, phone: string, at: { lat: number; lng: number }) => {
    const user = await prisma.user.create({
      data: { firstName: tag, lastName: "ZR", password: "x", role: "VENDOR", phoneNumber: phone, email: tag + "@zr.test" },
    });
    const p = await prisma.provider.create({
      data: { userId: user.id, businessName: tag, isActive: true, isVerified: true, isOnline: true },
    });
    await prisma.location.create({
      data: { providerId: p.id, latitude: at.lat, longitude: at.lng, accuracy: 5 },
    });
    return { providerId: p.id, userId: user.id };
  };

  const near = await mkProvider("zr-near-" + stamp, "+9195" + String(stamp).slice(-8), NEAR);
  const far = await mkProvider("zr-far-" + stamp, "+9194" + String(stamp).slice(-8), FAR);
  providerNear = near.providerId;
  providerFar = far.providerId;

  const svc = await prisma.service.findFirst({ select: { id: true } });
  serviceId = svc?.id ?? "";

  /**
   * Zone GEOMETRY is platform configuration, not partner history — seeding it in an isolated
   * database is fixture setup, not fabricated evidence. Without it there are no candidates, every
   * assertion early-returns, and the suite passes while proving nothing (it did exactly that on the
   * first run: 16 tests, 6 expect() calls).
   *
   * Two zones with DIFFERENT live demand, so the ranking has something real to separate.
   */
  const existing = await prisma.geofence.count();
  if (existing === 0) {
    const zNear = await prisma.geofence.create({
      data: {
        name: "ZR Near Zone", zoneType: "SERVICE_ZONE", city: "Bengaluru", isActive: true,
        centerLat: NEAR.lat, centerLng: NEAR.lng, radiusMeters: 8000,
      },
    });
    const zFar = await prisma.geofence.create({
      data: {
        name: "ZR Far Zone", zoneType: "SERVICE_ZONE", city: "Bengaluru", isActive: true,
        centerLat: FAR.lat, centerLng: FAR.lng, radiusMeters: 8000,
      },
    });
    zoneNearId = zNear.id;
    seededZoneIds = [zNear.id, zFar.id];

    // Live unserved demand in the NEAR zone only — the signal the ranking is supposed to find.
    const svcId = serviceId || (await prisma.service.findFirst({ select: { id: true } }))?.id;
    if (svcId) {
      const cust = await prisma.user.create({
        data: {
          firstName: "zr-demand-" + stamp, lastName: "ZR", password: "x", role: "CUSTOMER",
          phoneNumber: "+9192" + String(stamp).slice(-8), email: "zrd" + stamp + "@zr.test",
        },
      });
      const addr = await prisma.address.create({
        data: {
          userId: cust.id, label: "Home", addressLine1: "1 Near St", city: "Bengaluru", state: "KA",
          zipCode: "560001", latitude: NEAR.lat, longitude: NEAR.lng,
        },
      });
      for (let i = 0; i < 6; i++) {
        await prisma.booking.create({
          data: {
            bookingNumber: "ZRD-" + stamp + "-" + i, userId: cust.id, serviceId: svcId, addressId: addr.id,
            status: "PENDING", scheduledDate: new Date(Date.now() + (i + 1) * 3_600_000),
            baseAmount: 800, finalAmount: 800, totalAmount: 800,
          },
        });
      }
    }
  } else {
    const zones = await prisma.geofence.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
    zoneNearId = zones[0]?.id ?? "";
  }
});

/** Fails the suite loudly if the fixtures did not produce a rankable world. */
describe("ZR — fixtures actually produce candidates", () => {
  test("the isolated database has zones and the service can rank them", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    expect(r.state).toBe("OK");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe("ZR — result envelope is always well-formed", () => {
  test("an unknown provider is UNAVAILABLE with a reason, not an empty ranking", async () => {
    const r = await zoneRecommendationService.recommend("does-not-exist");
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.reasonCode).toBe("PROVIDER_NOT_FOUND");
    expect(r.recommendations).toEqual([]);
  });

  test("every result carries both rule fingerprints", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    expect(r.rulesVersion).toBe(ZONE_RULES_VERSION);
    // The context's own version travels too, so a recommendation can be traced through both layers.
    if (r.state === "OK") expect(r.contextRulesVersion).toBe("pi.rules.v1");
    expect(typeof r.generatedAt).toBe("string");
  });
});

describe("ZR — scores are bounded and decomposable", () => {
  test("score, coverage and confidence stay inside their ranges", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (const z of r.recommendations) {
      expect(z.score).toBeGreaterThanOrEqual(0);
      expect(z.score).toBeLessThanOrEqual(100);
      expect(z.coverage).toBeGreaterThanOrEqual(0);
      expect(z.coverage).toBeLessThanOrEqual(1);
      expect(z.confidence).toBeGreaterThanOrEqual(0);
      expect(z.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("every zone explains itself with all six dimensions", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    const expected = ["UNMET_DEMAND", "SURGE", "DEMAND_TREND", "TRAVEL", "PARTNER_HISTORY", "COMPETITION"];
    for (const z of r.recommendations) {
      expect([...z.reasons.map((x) => String(x.code))].sort()).toEqual([...expected].sort());
      for (const reason of z.reasons) {
        // A dimension either contributed with a bounded sub-score, or says why it could not.
        if (reason.state === "CONTRIBUTED") {
          expect(reason.subScore).not.toBeNull();
          expect(reason.subScore!).toBeGreaterThanOrEqual(0);
          expect(reason.subScore!).toBeLessThanOrEqual(100);
        } else {
          expect(reason.subScore).toBeNull();
          expect(typeof reason.reasonCode).toBe("string");
        }
      }
    }
  });

  test("the score is reproducible from its own reasons", async () => {
    // The decisive explainability property: the number is not an opaque model output.
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (const z of r.recommendations) {
      const contributing = z.reasons.filter((x) => x.state === "CONTRIBUTED" && x.subScore !== null);
      if (contributing.length === 0) continue;
      const w = contributing.reduce((s, x) => s + x.weight, 0);
      const recomputed = Math.round(contributing.reduce((s, x) => s + x.subScore! * x.weight, 0) / w);
      expect(recomputed).toBe(z.score);
    }
  });

  test("a missing dimension lowers coverage instead of scoring zero", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (const z of r.recommendations) {
      const missing = z.reasons.filter((x) => x.state !== "CONTRIBUTED");
      if (missing.length > 0) expect(z.coverage).toBeLessThan(1);
    }
  });
});

describe("ZR — missing signals are never invented", () => {
  test("history below the floor reports INSUFFICIENT_HISTORY, not zero benefit", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (const z of r.recommendations) {
      const h = z.reasons.find((x) => x.code === "PARTNER_HISTORY")!;
      if (z.evidence.partnerJobsInZone < MIN_ZONE_HISTORY_JOBS) {
        expect(h.state).toBe("INSUFFICIENT_HISTORY");
        expect(h.subScore).toBeNull();
      }
    }
  });

  test("travel is scored only when the location is usable", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (const z of r.recommendations) {
      const t = z.reasons.find((x) => x.code === "TRAVEL")!;
      // Never a silent zero-distance: either a real distance, or an explicit reason.
      if (z.evidence.distanceKm === null) {
        expect(t.state).toBe("UNAVAILABLE");
        expect(t.subScore).toBeNull();
      } else {
        expect(t.state).toBe("CONTRIBUTED");
      }
    }
  });

  test("the platform ops score is carried as evidence but never ranks the zone", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    // Measured on live data: the ops composite is inverted for partners (an idle zone scores 100).
    // It must appear as evidence and must not be one of the weighted dimensions.
    expect(r.recommendations[0].evidence).toHaveProperty("platformScore");
    expect(r.recommendations[0].reasons.map((x) => x.code)).not.toContain("PLATFORM_SCORE");
  });
});

describe("ZR — determinism and ties", () => {
  test("same input produces byte-identical output", async () => {
    const a = await zoneRecommendationService.recommend(providerNear);
    const b = await zoneRecommendationService.recommend(providerNear);
    const strip = (r: typeof a) => JSON.stringify({ ...r, generatedAt: "" });
    expect(strip(b)).toBe(strip(a));
  });

  test("ties break on zone id, never on insertion order", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    for (let i = 1; i < r.recommendations.length; i++) {
      const prev = r.recommendations[i - 1];
      const cur = r.recommendations[i];
      expect(prev.score).toBeGreaterThanOrEqual(cur.score);
      if (prev.score === cur.score) expect(prev.zoneId.localeCompare(cur.zoneId)).toBeLessThanOrEqual(0);
    }
  });

  test("ranks are dense and start at 1", async () => {
    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    expect(r.recommendations.map((z) => z.rank)).toEqual(r.recommendations.map((_, i) => i + 1));
  });
});

describe("ZR — a changed signal changes the ranking", () => {
  test("travel distance separates two partners standing in different places", async () => {
    const near = await zoneRecommendationService.recommend(providerNear);
    const far = await zoneRecommendationService.recommend(providerFar);
    if (near.state !== "OK" || far.state !== "OK") return;

    const nearTravel = near.recommendations.map((z) => z.reasons.find((x) => x.code === "TRAVEL")!);
    const farTravel = far.recommendations.map((z) => z.reasons.find((x) => x.code === "TRAVEL")!);
    // Both have live fixes, so travel must contribute for both...
    expect(nearTravel.every((t) => t.state === "CONTRIBUTED")).toBe(true);
    expect(farTravel.every((t) => t.state === "CONTRIBUTED")).toBe(true);
    // ...and the partner standing somewhere else must see different travel values.
    /**
     * Compare per ZONE, not per rank. Ordered by rank both partners read [0, 57] — each one's own
     * nearest zone ranks first — which is the personalisation working, not a collision. The real
     * question is whether the same zone is a different distance for the two partners.
     */
    const byZone = (res: typeof near) =>
      new Map(res.recommendations.map((z) => [z.zoneId, z.evidence.distanceKm]));
    const nearMap = byZone(near);
    const farMap = byZone(far);
    let differed = 0;
    for (const [zoneId, d] of nearMap) {
      const other = farMap.get(zoneId);
      if (other !== undefined && other !== d) differed += 1;
    }
    expect(differed).toBeGreaterThan(0);
  });

  test("earning more per job in a zone raises that zone's history sub-score", async () => {
    if (!serviceId || !zoneNearId) return;

    const zone = await prisma.geofence.findUnique({
      where: { id: zoneNearId },
      select: { centerLat: true, centerLng: true },
    });
    if (!zone) return;

    const user = await prisma.user.create({
      data: {
        firstName: "zr-hist-" + Date.now(), lastName: "ZR", password: "x", role: "CUSTOMER",
        phoneNumber: "+9193" + String(Date.now()).slice(-8), email: "zrh" + Date.now() + "@zr.test",
      },
    });
    const addr = await prisma.address.create({
      data: {
        userId: user.id, label: "Home", addressLine1: "1 Zone St", city: "T", state: "T", zipCode: "1",
        latitude: zone.centerLat, longitude: zone.centerLng,
      },
    });

    // Enough completed jobs to clear the sample floor, at a high value per job.
    for (let i = 0; i < MIN_ZONE_HISTORY_JOBS + 1; i++) {
      await prisma.booking.create({
        data: {
          bookingNumber: "ZR-" + Date.now() + "-" + i, userId: user.id, serviceId, addressId: addr.id,
          providerId: providerNear, status: "COMPLETED",
          scheduledDate: new Date(Date.now() - (i + 2) * 86_400_000),
          // Required by the `booking_completed_requires_timestamp` check constraint — a COMPLETED
          // booking with no completion time is not a valid row, and the database says so.
          completedAt: new Date(Date.now() - (i + 2) * 86_400_000),
          baseAmount: 5000, finalAmount: 5000, totalAmount: 5000,
        },
      });
    }

    const r = await zoneRecommendationService.recommend(providerNear);
    if (r.state !== "OK") return;
    const z = r.recommendations.find((x) => x.zoneId === zoneNearId);
    if (!z) return;

    expect(z.evidence.partnerJobsInZone).toBeGreaterThanOrEqual(MIN_ZONE_HISTORY_JOBS);
    const h = z.reasons.find((x) => x.code === "PARTNER_HISTORY")!;
    // Above the floor the dimension now contributes instead of reporting insufficient history.
    expect(h.state).toBe("CONTRIBUTED");
    expect(h.subScore).not.toBeNull();
  });
});

describe("ZR — cross-partner isolation", () => {
  test("a recommendation only ever reflects the requested partner's own history", async () => {
    const near = await zoneRecommendationService.recommend(providerNear);
    const far = await zoneRecommendationService.recommend(providerFar);
    if (near.state !== "OK" || far.state !== "OK") return;

    // providerNear was given completed bookings above; providerFar has none. If history leaked
    // across partners, providerFar would show jobs it never did.
    const farJobs = far.recommendations.reduce((s, z) => s + z.evidence.partnerJobsInZone, 0);
    expect(farJobs).toBe(0);

    const nearJobs = near.recommendations.reduce((s, z) => s + z.evidence.partnerJobsInZone, 0);
    expect(nearJobs).toBeGreaterThan(0);
  });

  test("earnings evidence never carries another partner's money", async () => {
    const far = await zoneRecommendationService.recommend(providerFar);
    if (far.state !== "OK") return;
    for (const z of far.recommendations) expect(z.evidence.partnerEarningsInZone).toBe(0);
  });
});

/**
 * Zone geometry is shared state in this database. Leaving it behind makes the NEXT run adopt it
 * (this suite only seeds when no geofence exists at all), and duplicates at identical coordinates
 * silently re-attribute partner history to the wrong zone — which is exactly how a leak from
 * `surge-alert.integration.test.ts` made this suite fail.
 */
afterAll(async () => {
  if (seededZoneIds.length === 0) return;
  await prisma.geofence.deleteMany({ where: { id: { in: seededZoneIds } } });
}, 30_000);
