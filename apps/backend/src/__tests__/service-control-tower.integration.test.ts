/**
 * Service control tower, the read and taxonomy side: what changed between two published versions,
 * who did what to a service, and managing the customer category tree.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `sct-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const services: string[] = [];
const categories: string[] = [];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  for (const id of services) {
    await prisma.serviceConfigVersion.deleteMany({ where: { serviceId: id } }).catch(() => {});
    await prisma.service.delete({ where: { id } }).catch(() => {});
  }
  // Children first: a parent with children cannot be deleted.
  for (const id of [...categories].reverse()) await prisma.serviceCategory.delete({ where: { id } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

type Res = { status: number; json: { success: boolean; code?: string; error?: string; data?: any } };
async function call(method: string, path: string, body?: unknown, token: string | null = bearer(ctx.superAdmin)): Promise<Res> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Res["json"] };
}

/** A live service at version N, last edited by the support admin, then edited once more (direct policy in tests). */
async function liveServiceWithTwoVersions() {
  const created = await call("POST", "/api/admin/services", {
    name: `Tower ${RUN} ${services.length}`,
    description: "A fixture service with a real description",
    category: "cleaning",
    basePrice: 300,
    estimatedDuration: 60,
    catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    isActive: false,
  });
  if (created.status !== 200) throw new Error(`create: ${JSON.stringify(created.json)}`);
  const id = created.json.data.service.id as string;
  services.push(id);
  await prisma.service.update({ where: { id }, data: { lifecycleStatus: "READY_FOR_REVIEW", updatedBy: ctx.supportAdmin.id } });
  if ((await call("POST", `/api/admin/services/${id}/approve`, {})).status !== 200) throw new Error("approve");
  const live = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ACTIVE" });
  if (live.status !== 200) throw new Error(`publish: ${JSON.stringify(live.json)}`);
  const first = live.json.data.service.version as number;
  const edited = await call("PUT", `/api/admin/services/${id}`, {
    basePrice: 450,
    minPrice: 450,
    maxPrice: 450,
    catalogConfig: { materialPolicy: "CUSTOMER_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    changeReason: "Annual price review",
  });
  if (edited.status !== 200) throw new Error(`edit: ${JSON.stringify(edited.json)}`);
  return { id, first, second: edited.json.data.service.version as number };
}

describe.serial("what changed between two published versions", () => {
  test("lists each changed price field and configuration section with both values", async () => {
    expect(dbOk).toBe(true);
    const s = await liveServiceWithTwoVersions();
    expect(s.second).toBe(s.first + 1);
    const r = await call("GET", `/api/admin/services/${s.id}/versions/diff?from=${s.first}&to=${s.second}`);
    expect(r.status).toBe(200);
    expect(r.json.data.from.version).toBe(s.first);
    expect(r.json.data.to.version).toBe(s.second);
    expect(r.json.data.changes).toContainEqual({ field: "basePrice", before: 300, after: 450 });
    expect(r.json.data.changes).toContainEqual({ field: "config.materialPolicy", before: "PROFESSIONAL_PROVIDED", after: "CUSTOMER_PROVIDED" });
    expect(r.json.data.changes.some((c: { field: string }) => c.field === "config.equipmentPolicy")).toBe(false);
  });

  test("a version that does not exist is 404, and a malformed request is 400", async () => {
    expect(dbOk).toBe(true);
    const s = await liveServiceWithTwoVersions();
    expect((await call("GET", `/api/admin/services/${s.id}/versions/diff?from=${s.first}&to=999`)).status).toBe(404);
    expect((await call("GET", `/api/admin/services/${s.id}/versions/diff?from=abc&to=${s.second}`)).status).toBe(400);
    expect((await call("GET", `/api/admin/services/${s.id}/versions/diff?from=${s.first}&to=${s.second}`, undefined, bearer(ctx.customerA))).status).toBe(403);
  });
});

describe.serial("a required training module must be one a professional can complete", () => {
  const moduleSlug = `gate-module-${RUN}`.toLowerCase();
  let moduleId = "";

  async function inReviewRequiringModule(n: number) {
    const created = await call("POST", "/api/admin/services", {
      name: `Tower training ${RUN} ${n}`,
      description: "A fixture service with a real description",
      category: "cleaning",
      basePrice: 300,
      estimatedDuration: 60,
      catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", providerRequirements: { trainingModules: [moduleSlug] } },
      isActive: false,
    });
    if (created.status !== 200) throw new Error(`create: ${JSON.stringify(created.json)}`);
    const id = created.json.data.service.id as string;
    services.push(id);
    await prisma.service.update({ where: { id }, data: { lifecycleStatus: "READY_FOR_REVIEW", updatedBy: ctx.supportAdmin.id } });
    return id;
  }
  const gateOf = async (id: string) =>
    ((await call("GET", `/api/admin/services/${id}`)).json.data.service.publishGates as { code: string; status: string }[]).find((g) => g.code === "TRAINING_MODULE_UNAVAILABLE");

  test("published module: approval and go-live proceed; unpublished: both are refused and the rail says why", async () => {
    expect(dbOk).toBe(true);
    const mod = await prisma.partnerAcademyModule.create({ data: { slug: moduleSlug, title: `Gate module ${RUN}`, contentType: "ARTICLE", isPublished: true } });
    moduleId = mod.id;
    try {
      const live = await inReviewRequiringModule(1);
      expect(await gateOf(live)).toBeUndefined();
      expect((await call("POST", `/api/admin/services/${live}/approve`, {})).status).toBe(200);
      expect((await call("POST", `/api/admin/services/${live}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);

      await prisma.partnerAcademyModule.update({ where: { id: moduleId }, data: { isPublished: false } });

      // A service not yet live cannot be approved or published while nobody could qualify for it.
      const blocked = await inReviewRequiringModule(2);
      expect(await gateOf(blocked)).toMatchObject({ status: "FAIL" });
      const refused = await call("POST", `/api/admin/services/${blocked}/approve`, {});
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe("SERVICE_NOT_BOOKABLE");
      expect(JSON.stringify(refused.json)).toContain("TRAINING_MODULE_UNAVAILABLE");

      // The service that is already live is not unpublished, and its rail warns that it cannot be matched.
      expect(await gateOf(live)).toMatchObject({ status: "WARNING" });
      expect((await prisma.service.findUniqueOrThrow({ where: { id: live } })).lifecycleStatus).toBe("ACTIVE");
    } finally {
      await prisma.partnerAcademyModule.delete({ where: { id: moduleId } }).catch(() => {});
    }
  });
});

describe.serial("restoring a published version", () => {
  test("restores price and configuration as a NEW version, with the reason on record; history is not rewritten", async () => {
    expect(dbOk).toBe(true);
    const s = await liveServiceWithTwoVersions();
    const noReason = await call("POST", `/api/admin/services/${s.id}/versions/${s.first}/restore`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.json.code).toBe("REASON_REQUIRED");
    const r = await call("POST", `/api/admin/services/${s.id}/versions/${s.first}/restore`, { reason: "Price change reverted" });
    expect(r.status).toBe(200);
    const live = await prisma.service.findUniqueOrThrow({ where: { id: s.id } });
    expect(live.basePrice).toBe(300);
    expect((live.catalogConfig as { materialPolicy?: string }).materialPolicy).toBe("PROFESSIONAL_PROVIDED");
    expect(live.version).toBe(s.second + 1);
    // The version restored from, and the one replaced, are both still there, unchanged.
    const kept = await prisma.serviceConfigVersion.findMany({ where: { serviceId: s.id, status: "PUBLISHED" }, orderBy: { version: "asc" }, select: { version: true } });
    const versions = kept.map((v) => v.version);
    expect(versions.slice(-3)).toEqual([s.first, s.second, s.second + 1]);
    expect(new Set(versions).size).toBe(versions.length);
    const diff = await call("GET", `/api/admin/services/${s.id}/versions/diff?from=${s.first}&to=${s.second + 1}`);
    expect(diff.json.data.changes.filter((c: { field: string }) => c.field === "basePrice" || c.field === "config.materialPolicy")).toEqual([]);
  });

  test("an unknown version is 404, and restoring what is already live changes nothing", async () => {
    expect(dbOk).toBe(true);
    const s = await liveServiceWithTwoVersions();
    expect((await call("POST", `/api/admin/services/${s.id}/versions/999/restore`, { reason: "x" })).status).toBe(404);
    const same = await call("POST", `/api/admin/services/${s.id}/versions/${s.second}/restore`, { reason: "No-op" });
    expect(same.status).toBe(409);
    expect(same.json.code).toBe("NOTHING_TO_RESTORE");
    expect((await prisma.service.findUniqueOrThrow({ where: { id: s.id } })).version).toBe(s.second);
  });
});

describe.serial("who did what to a service", () => {
  test("the audit trail shows the approval, the publish and the versioned edit with its reason, newest first", async () => {
    expect(dbOk).toBe(true);
    const s = await liveServiceWithTwoVersions();
    // Audit rows are written after the response; wait for them rather than assume they are instant.
    let entries: any[] = [];
    for (let i = 0; i < 40; i++) {
      entries = (await call("GET", `/api/admin/services/${s.id}/audit`)).json.data?.entries ?? [];
      if (entries.some((e) => e.action === "SERVICE_CONFIG_VERSIONED") && entries.some((e) => e.action === "SERVICE_APPROVED")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("SERVICE_APPROVED");
    expect(actions).toContain("SERVICE_LIFECYCLE_CHANGED");
    expect(actions).toContain("SERVICE_CONFIG_VERSIONED");
    const edit = entries.find((e) => e.action === "SERVICE_CONFIG_VERSIONED");
    expect(edit.actorId).toBe(ctx.superAdmin.id);
    expect(edit.reason).toBe("Annual price review");
    expect(edit.version).toBe(s.second);
    expect(edit.changes).toContain("basePrice");
    // Ids are resolved to names once per response, so the trail reads as people, not identifiers.
    const trail = await call("GET", `/api/admin/services/${s.id}/audit`);
    const name = trail.json.data.actors[ctx.superAdmin.id];
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe(ctx.superAdmin.id);
    const versions = await call("GET", `/api/admin/services/${s.id}/versions`);
    expect(versions.json.data.actors[ctx.superAdmin.id]).toBe(name);
    const one = await call("GET", `/api/admin/services/${s.id}`);
    expect(one.json.data.actors[ctx.superAdmin.id]).toBe(name);
    // A name is all that is added: no email, phone or role.
    expect(JSON.stringify(trail.json.data.actors)).not.toMatch(/@|\+91/);
    const times = entries.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Only this service's rows, and nothing but the listed fields.
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(["action", "actorId", "approvedBy", "at", "changes", "from", "id", "reason", "status", "to", "version"]);
  });

  test("another service's history is not mixed in, and a non-admin cannot read it", async () => {
    expect(dbOk).toBe(true);
    const a = await liveServiceWithTwoVersions();
    const b = await call("POST", "/api/admin/services", { name: `Tower quiet ${RUN}`, description: "Nothing happened here", category: "cleaning", basePrice: 100, estimatedDuration: 30, isActive: false });
    services.push(b.json.data.service.id);
    const quiet = await call("GET", `/api/admin/services/${b.json.data.service.id}/audit`);
    expect(quiet.status).toBe(200);
    expect(quiet.json.data.entries.some((e: { action: string }) => e.action === "SERVICE_CONFIG_VERSIONED")).toBe(false);
    expect((await call("GET", `/api/admin/services/${a.id}/audit`, undefined, bearer(ctx.customerA))).status).toBe(403);
    expect((await call("GET", "/api/admin/services/does-not-exist/audit")).status).toBe(404);
  });
});

describe.serial("managing the customer category tree", () => {
  const slug = (s: string) => `${s}-${RUN}`.toLowerCase();

  async function category(body: Record<string, unknown>) {
    const r = await call("POST", "/api/admin/service-categories", body);
    if (r.status === 200) categories.push(r.json.data.category.id);
    return r;
  }

  test("creates a top-level category and a subcategory under it", async () => {
    expect(dbOk).toBe(true);
    const top = await category({ name: `Garden ${RUN}`, slug: slug("garden"), sortOrder: 90 });
    expect(top.status).toBe(200);
    expect(top.json.data.category).toMatchObject({ slug: slug("garden"), parentId: null, isActive: true, sortOrder: 90 });
    const sub = await category({ name: `Lawn ${RUN}`, slug: slug("lawn"), parentId: top.json.data.category.id });
    expect(sub.status).toBe(200);
    expect(sub.json.data.category.parentId).toBe(top.json.data.category.id);
    const tree = await call("GET", "/api/admin/service-categories");
    const found = tree.json.data.categories.find((c: { slug: string }) => c.slug === slug("garden"));
    expect(found.subcategories.map((s: { slug: string }) => s.slug)).toEqual([slug("lawn")]);
  });

  test("refuses a duplicate slug, a malformed slug, an unknown parent and a third level", async () => {
    expect(dbOk).toBe(true);
    const top = await category({ name: `Pool ${RUN}`, slug: slug("pool") });
    const sub = await category({ name: `Pool clean ${RUN}`, slug: slug("pool-clean"), parentId: top.json.data.category.id });
    expect((await category({ name: "Again", slug: slug("pool") })).json.code).toBe("DUPLICATE");
    expect((await category({ name: "Bad", slug: "Has Spaces" })).json.code).toBe("INVALID_IDENTITY");
    expect((await category({ name: "Orphan", slug: slug("orphan"), parentId: "no-such-parent" })).json.code).toBe("INVALID_TAXONOMY");
    expect((await category({ name: "Too deep", slug: slug("deep"), parentId: sub.json.data.category.id })).json.code).toBe("INVALID_TAXONOMY");
  });

  test("renames and reorders a category; the slug cannot change because customer URLs use it", async () => {
    expect(dbOk).toBe(true);
    const top = await category({ name: `Roof ${RUN}`, slug: slug("roof") });
    const id = top.json.data.category.id;
    const r = await call("PUT", `/api/admin/service-categories/${id}`, { name: `Roofing ${RUN}`, sortOrder: 5, description: "Roof repair and waterproofing" });
    expect(r.status).toBe(200);
    expect(r.json.data.category).toMatchObject({ name: `Roofing ${RUN}`, sortOrder: 5, slug: slug("roof") });
    expect((await call("PUT", `/api/admin/service-categories/${id}`, { slug: slug("roof-2") })).json.code).toBe("SLUG_IMMUTABLE");
    expect((await call("PUT", "/api/admin/service-categories/no-such-id", { name: "X" })).status).toBe(404);
  });

  test("a category that still holds a live service cannot be switched off; an empty one can", async () => {
    expect(dbOk).toBe(true);
    const busy = await category({ name: `Busy ${RUN}`, slug: slug("busy") });
    const empty = await category({ name: `Empty ${RUN}`, slug: slug("empty") });
    const s = await liveServiceWithTwoVersions();
    await prisma.service.update({ where: { id: s.id }, data: { categoryId: busy.json.data.category.id, subcategoryId: null } });
    const refused = await call("PUT", `/api/admin/service-categories/${busy.json.data.category.id}`, { isActive: false });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("CATEGORY_IN_USE");
    const off = await call("PUT", `/api/admin/service-categories/${empty.json.data.category.id}`, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.json.data.category.isActive).toBe(false);
  });

  test("a non-admin cannot create or change a category", async () => {
    expect(dbOk).toBe(true);
    expect((await call("POST", "/api/admin/service-categories", { name: "X", slug: slug("x") }, bearer(ctx.customerA))).status).toBe(403);
    expect((await call("POST", "/api/admin/service-categories", { name: "X", slug: slug("x") }, null)).status).toBe(401);
  });
});
