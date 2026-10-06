/**
 * A service written straight into the database is live by the schema's defaults: no publish gate,
 * no second admin, no version row, no audit entry. Application code cannot stop a database write,
 * so there are two controls instead — the scripts that do it refuse to run on a deployed
 * environment, and a read reports any live service that did not come through the governed path.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import { directCatalogWriteRefusal } from "../lib/catalog-governance";
import { catalogService } from "../services/catalog.service";
import { dbReachable } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

describe("scripts that insert live services refuse a deployed environment", () => {
  test("production and staging are refused, with the reason; a developer machine is not", () => {
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toContain("seed-services");
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "development", APP_ENV: "staging" } as NodeJS.ProcessEnv)).toContain("publish gate");
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "development", APP_ENV: "development" } as NodeJS.ProcessEnv)).toBeNull();
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  for (const script of ["seed-services.ts", "seed-popular-services.ts"]) {
    test(`${script} asks before it writes`, () => {
      const src = readFileSync(join(import.meta.dir, "..", "..", "scripts", script), "utf8");
      const guard = src.indexOf("directCatalogWriteRefusal(");
      const firstWrite = src.search(/prisma\.service\.(create|update|upsert|updateMany)/);
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstWrite);
    });
  }
});

describe("a live service that skipped the governed path is reported", () => {
  const RUN = `ungov-${Date.now().toString(36)}`;
  let dbOk = false;
  let rawId = "";
  let governedId = "";

  beforeAll(async () => {
    dbOk = await dbReachable();
    if (!dbOk) return;
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    refuseIfNotIsolatedTestDb(db);
    // Exactly what a seed script does: the schema defaults make this row live.
    const raw = await prisma.service.create({ data: { name: `Raw ${RUN}`, slug: `raw-${RUN}`, description: "Inserted directly", category: "cleaning", basePrice: 100, estimatedDuration: 30 } });
    rawId = raw.id;
    const governed = await prisma.service.create({ data: { name: `Governed ${RUN}`, slug: `governed-${RUN}`, description: "Published with a version row", category: "cleaning", basePrice: 100, estimatedDuration: 30 } });
    governedId = governed.id;
    await prisma.serviceConfigVersion.create({ data: { serviceId: governed.id, version: 1, status: "PUBLISHED", catalogConfig: {}, snapshot: {}, publishedAt: new Date() } });
  }, 60_000);

  afterAll(async () => {
    if (!dbOk) return;
    await prisma.serviceConfigVersion.deleteMany({ where: { serviceId: { in: [rawId, governedId] } } }).catch(() => {});
    await prisma.service.deleteMany({ where: { id: { in: [rawId, governedId] } } }).catch(() => {});
  }, 60_000);

  test("the directly inserted row is listed with the reason; the published one is not", async () => {
    expect(dbOk).toBe(true);
    const found = await catalogService.ungovernedLiveServices();
    expect(found.find((s) => s.id === rawId)).toMatchObject({ slug: `raw-${RUN}`, reason: "NO_PUBLISHED_VERSION" });
    expect(found.find((s) => s.id === governedId)).toBeUndefined();
  });

  test("a row that is not customer-visible is not the report's business", async () => {
    expect(dbOk).toBe(true);
    await prisma.service.update({ where: { id: rawId }, data: { isActive: false, isCustomerVisible: false, lifecycleStatus: "PAUSED" } });
    expect((await catalogService.ungovernedLiveServices()).find((s) => s.id === rawId)).toBeUndefined();
  });
});
