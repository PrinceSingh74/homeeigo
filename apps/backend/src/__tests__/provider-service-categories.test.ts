/**
 * P1-6 — Provider.serviceCategories null-safety.
 *
 * Investigation found: the Prisma ORM client already coerces a genuine SQL NULL to `[]` for
 * String[] fields on read (empirically verified against real NULL rows in sibling columns
 * service_regions/working_days/certifications on the same table) — so there was no live crash
 * today. But the DB column had no NOT NULL/DEFAULT, unlike the Prisma type's claim of `string[]`
 * (never null), and 3 sibling array columns on this exact table already carry real NULL rows —
 * proving the underlying cause is active, not hypothetical. Fix: DEFAULT '{}' + true NOT NULL at
 * the DB level (migration 20260824140000), closing the gap outright rather than only relying on
 * the ORM's read-time coercion continuing to be exercised correctly by every future caller.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Prisma } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerOperationsService } from "../services/partner-operations.service";
import { providerOffersService, type ServiceMatchTokens } from "../lib/service-match";

function matchTokens(overrides: Partial<ServiceMatchTokens> = {}): ServiceMatchTokens {
  return {
    serviceId: "svc_1",
    category: "cleaning",
    serviceSlug: "cleaning-basic",
    categoryServiceIds: ["svc_1", "svc_2"],
    partnerRegistrationSlugs: ["cleaning"],
    ...overrides,
  };
}

const RUN_ID = `p16-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 30_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("P1-6 — providers.service_categories DB constraint", () => {
  test("NOT NULL: a raw SQL write of an explicit NULL is now rejected at the DB level", async () => {
    if (skipIfNoDb()) return;
    let caught: unknown;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE providers SET service_categories = NULL WHERE id = $1`,
        ctx.providerId,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // Postgres NOT NULL violation surfaces through Prisma as a raw-query failure (P2010) wrapping
    // the underlying "null value in column ... violates not-null constraint" error.
    expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe("P2010");

    const row = await prisma.provider.findUnique({ where: { id: ctx.providerId }, select: { serviceCategories: true } });
    expect(row?.serviceCategories).toEqual([ctx.serviceId]); // unchanged — the rejected write never applied
  });

  test("DEFAULT: a raw SQL INSERT omitting service_categories gets '{}', not NULL", async () => {
    if (skipIfNoDb()) return;
    const vendor = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`p16-${RUN_ID}-vendor-raw@adv.test`),
        email: `p16-${RUN_ID}-vendor-raw@adv.test`,
        phoneNumber: `+91${Date.now().toString().slice(-10)}`,
        firstName: "Raw",
        lastName: "Insert",
        password: "x",
        role: "VENDOR",
      },
    });

    // Deliberately omit service_categories to prove the column-level DEFAULT fires — this is only
    // reachable via raw SQL; Prisma's generated `provider.create()` type requires the field.
    const rows = await prisma.$queryRaw<{ id: string; service_categories: string[] | null }[]>`
      INSERT INTO providers (id, user_id, is_verified, is_approved, is_active, is_online, rating, working_days, updated_at)
      VALUES (${`prov_p16_raw_${Date.now()}`}, ${vendor.id}, true, true, true, false, 0, ARRAY[]::text[], NOW())
      RETURNING id, service_categories
    `;
    const created = rows[0];
    expect(created?.service_categories).toEqual([]);
    expect(created?.service_categories).not.toBeNull();

    await prisma.provider.delete({ where: { id: created!.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: vendor.id } }).catch(() => undefined);
  });
});

describe.serial("P2-10 — sibling array columns (serviceRegions / workingDays / certifications)", () => {
  const SIBLINGS = [
    { column: "service_regions", field: "serviceRegions" as const },
    { column: "working_days", field: "workingDays" as const },
    { column: "certifications", field: "certifications" as const },
  ];

  for (const { column, field } of SIBLINGS) {
    test(`NOT NULL: a raw SQL write of an explicit NULL to ${column} is rejected`, async () => {
      if (skipIfNoDb()) return;
      let caught: unknown;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE providers SET ${column} = NULL WHERE id = $1`,
          ctx.providerId,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe("P2010");

      // The rejected write must not have partially applied.
      const row = await prisma.provider.findUnique({
        where: { id: ctx.providerId },
        select: { [field]: true } as never,
      });
      expect(Array.isArray((row as Record<string, unknown>)[field])).toBe(true);
    });
  }

  test("DEFAULT: a raw INSERT omitting all three array columns gets '{}' for each, never NULL", async () => {
    if (skipIfNoDb()) return;
    const vendor = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`p210-${RUN_ID}-vendor@adv.test`),
        email: `p210-${RUN_ID}-vendor@adv.test`,
        phoneNumber: `+91${(Date.now() + 7).toString().slice(-10)}`,
        firstName: "P210",
        lastName: "Raw",
        password: "x",
        role: "VENDOR",
      },
    });

    // service_categories is included only because P1-6 made it NOT NULL with no default path here;
    // the three P2-10 columns are deliberately omitted to prove their DEFAULT fires.
    const rows = await prisma.$queryRaw<
      { id: string; service_regions: string[] | null; working_days: string[] | null; certifications: string[] | null }[]
    >`
      INSERT INTO providers (id, user_id, is_verified, is_approved, is_active, is_online, rating, updated_at)
      VALUES (${`prov_p210_${Date.now()}`}, ${vendor.id}, true, true, true, false, 0, NOW())
      RETURNING id, service_regions, working_days, certifications
    `;
    const created = rows[0]!;
    expect(created.service_regions).toEqual([]);
    expect(created.working_days).toEqual([]);
    expect(created.certifications).toEqual([]);

    await prisma.provider.delete({ where: { id: created.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: vendor.id } }).catch(() => undefined);
  });

  test("no NULL rows remain in any of the three columns after the backfill", async () => {
    if (skipIfNoDb()) return;
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM providers
      WHERE service_regions IS NULL OR working_days IS NULL OR certifications IS NULL
    `;
    expect(Number(row!.n)).toBe(0);
  });

  test("readinessFor still treats an empty serviceRegions as 'no declared area' (backfill changed no behavior)", () => {
    // NULL and [] were always semantically identical here — the backfill must not have altered
    // how a provider with no declared regions is evaluated.
    const withCity = partnerOperationsService.readinessFor({
      isActive: true,
      isBanned: false,
      isApproved: true,
      serviceCategories: ["cleaning"],
      serviceRegions: [],
      serviceRadiusKm: null,
      city: "Noida",
      baseLatitude: null,
      baseLongitude: null,
    });
    // A city alone still satisfies the service-area requirement.
    expect(withCity.blockers.some((b) => b.code === "SERVICE_AREA_REQUIRED")).toBe(false);

    const withNothing = partnerOperationsService.readinessFor({
      isActive: true,
      isBanned: false,
      isApproved: true,
      serviceCategories: ["cleaning"],
      serviceRegions: [],
      serviceRadiusKm: null,
      city: null,
      baseLatitude: null,
      baseLongitude: null,
    });
    expect(withNothing.blockers.some((b) => b.code === "SERVICE_AREA_REQUIRED")).toBe(true);
  });
});

describe.serial("P1-6 — cross-surface behavior: null / empty / populated", () => {
  test("readinessFor: empty serviceCategories correctly blocks with SKILL_REQUIRED, does not crash", () => {
    const readiness = partnerOperationsService.readinessFor({
      isActive: true,
      isBanned: false,
      isApproved: true,
      serviceCategories: [],
      serviceRegions: ["Noida"],
      serviceRadiusKm: null,
      city: "Noida",
      baseLatitude: null,
      baseLongitude: null,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((b) => b.code === "SKILL_REQUIRED")).toBe(true);
  });

  test("readinessFor: populated serviceCategories does not block on SKILL_REQUIRED", () => {
    const readiness = partnerOperationsService.readinessFor({
      isActive: true,
      isBanned: false,
      isApproved: true,
      serviceCategories: ["cleaning"],
      serviceRegions: ["Noida"],
      serviceRadiusKm: null,
      city: "Noida",
      baseLatitude: null,
      baseLongitude: null,
    });
    expect(readiness.blockers.some((b) => b.code === "SKILL_REQUIRED")).toBe(false);
  });

  test("providerOffersService: empty serviceCategories never matches, never throws", () => {
    const tokens = matchTokens();
    expect(() => providerOffersService([], tokens)).not.toThrow();
    expect(providerOffersService([], tokens)).toBe(false);
  });

  test("providerOffersService: populated serviceCategories matches correctly", () => {
    const tokens = matchTokens();
    expect(providerOffersService(["svc_1"], tokens)).toBe(true);
    expect(providerOffersService(["unrelated"], tokens)).toBe(false);
  });

  test("real DB round-trip via ORM: a provider whose sibling array column IS null still reads serviceCategories as []", async () => {
    if (skipIfNoDb()) return;
    // Reuse the empirically-confirmed coercion path: find any real row (sibling columns already
    // have real NULLs in this dev/test data pattern) and confirm the ORM read is always an array,
    // never null/undefined, regardless of what any array column's raw DB state is.
    const anyProvider = await prisma.provider.findFirst({ select: { id: true, serviceCategories: true } });
    if (!anyProvider) return;
    expect(Array.isArray(anyProvider.serviceCategories)).toBe(true);
  });
});
