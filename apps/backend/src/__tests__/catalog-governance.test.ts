/**
 * A service written straight into the database is live by the schema's defaults: no publish gate,
 * no second admin, no version row, no audit entry. Application code cannot stop a database write,
 * so there are two controls instead — the scripts that do it refuse to run on a deployed
 * environment, and a read reports any live service that did not come through the governed path.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import { directCatalogWriteRefusal, directInsertLiveFlags } from "../lib/catalog-governance";
import { catalogService } from "../services/catalog.service";
import app from "../index";
import { dbReachable } from "./helpers/adversarial-fixtures";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

describe("scripts that insert live services refuse a deployed environment", () => {
  test("production and staging are refused, with the reason; a developer machine is not", () => {
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toContain("seed-services");
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "development", APP_ENV: "staging" } as NodeJS.ProcessEnv)).toContain("publish gate");
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "development", APP_ENV: "development" } as NodeJS.ProcessEnv)).toBeNull();
    expect(directCatalogWriteRefusal("seed-services", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  test("a script that inserts a service already on sale must ask for the flags, and is refused them on a deployed environment", () => {
    expect(directInsertLiveFlags("smoke", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({ isActive: true, lifecycleStatus: "ACTIVE", isCustomerVisible: true, isBookable: true });
    expect(() => directInsertLiveFlags("smoke", { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow("publish gate");
    expect(() => directInsertLiveFlags("smoke", { NODE_ENV: "development", APP_ENV: "staging" } as NodeJS.ProcessEnv)).toThrow("smoke");
  });

  test("no script inserts a service without saying whether it is on sale", () => {
    const dir = join(import.meta.dir, "..", "..", "scripts");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/(prisma|tx|db)\.service\.(create|upsert)\(/g)) {
            const window = src.slice(m.index!, m.index! + 500);
            if (!/directInsertLiveFlags\(|LIVE_FIXTURE_SERVICE|lifecycleStatus:/.test(window)) offenders.push(`${e.name}@${m.index}`);
          }
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
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
    // A row forced live by a direct write (explicit flags, as a seed or a manual UPDATE would).
    const raw = await prisma.service.create({ data: { ...LIVE_FIXTURE_SERVICE, name: `Raw ${RUN}`, slug: `raw-${RUN}`, description: "Inserted directly", category: "cleaning", basePrice: 100, estimatedDuration: 30 } });
    rawId = raw.id;
    const governed = await prisma.service.create({ data: { ...LIVE_FIXTURE_SERVICE, name: `Governed ${RUN}`, slug: `governed-${RUN}`, description: "Published with a version row", category: "cleaning", basePrice: 100, estimatedDuration: 30 } });
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

  test("a row inserted with nothing but its required fields is a draft: not active, not visible, not bookable", async () => {
    expect(dbOk).toBe(true);
    const bare = await prisma.service.create({ data: { name: `Bare ${RUN}`, slug: `bare-${RUN}`, description: "Inserted with defaults only", category: "cleaning", basePrice: 100, estimatedDuration: 30 } });
    try {
      expect({ lifecycle: bare.lifecycleStatus, active: bare.isActive, visible: bare.isCustomerVisible, bookable: bare.isBookable }).toEqual({ lifecycle: "DRAFT", active: false, visible: false, bookable: false });
      // The same through raw SQL, where no client default can help: the database's own default decides.
      const id = `raw_${RUN}`;
      await prisma.$executeRaw`INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, updated_at) VALUES (${id}, ${`Sql ${RUN}`}, ${`sql-${RUN}`}, 'Inserted by SQL', 'cleaning', 100, 30, now())`;
      const sql = await prisma.service.findUniqueOrThrow({ where: { id } });
      expect({ lifecycle: sql.lifecycleStatus, active: sql.isActive, visible: sql.isCustomerVisible, bookable: sql.isBookable }).toEqual({ lifecycle: "DRAFT", active: false, visible: false, bookable: false });
      const listed = await app.handle(new Request(`http://localhost/api/services/${bare.id}`));
      expect(listed.status).toBe(404);
      expect((await catalogService.ungovernedLiveServices()).some((s) => s.id === bare.id || s.id === id)).toBe(false);
      await prisma.service.delete({ where: { id } });
    } finally {
      await prisma.service.delete({ where: { id: bare.id } }).catch(() => {});
    }
  });

  test("a row that is not customer-visible is not the report's business", async () => {
    expect(dbOk).toBe(true);
    await prisma.service.update({ where: { id: rawId }, data: { isActive: false, isCustomerVisible: false, lifecycleStatus: "PAUSED" } });
    expect((await catalogService.ungovernedLiveServices()).find((s) => s.id === rawId)).toBeUndefined();
  });
});
