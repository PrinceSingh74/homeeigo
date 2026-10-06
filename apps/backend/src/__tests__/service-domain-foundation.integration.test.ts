/**
 * Service domain Phases 01–04 against the real database and the real routes:
 * identity uniqueness, taxonomy integrity, lifecycle transitions, atomic versioning, role access,
 * role-safe projections, backend-authoritative selection (frontend bypass) and the partner brief.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN_ID = `svcfnd-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const created: string[] = [];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  for (const id of created) {
    await prisma.serviceConfigVersion.deleteMany({ where: { serviceId: id } }).catch(() => {});
    await prisma.service.delete({ where: { id } }).catch(() => {});
  }
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

type Res = { status: number; json: { success: boolean; code?: string; error?: string; data?: any; issues?: any[]; field?: string; allowed?: string[]; currentVersion?: number } };

async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.handle(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Res["json"] };
}
const admin = () => bearer(ctx.superAdmin);

async function approveAndPublish(serviceId: string) {
  await prisma.service.update({
    where: { id: serviceId },
    data: {
      lifecycleStatus: "READY_FOR_REVIEW",
      isActive: false,
      isBookable: false,
      isCustomerVisible: false,
      updatedBy: ctx.supportAdmin.id,
    },
  });
  const approved = await call("POST", `/api/admin/services/${serviceId}/approve`, {}, admin());
  if (approved.status !== 200) throw new Error(`approve: ${JSON.stringify(approved.json)}`);
  const live = await call("POST", `/api/admin/services/${serviceId}/lifecycle`, { to: "ACTIVE" }, admin());
  if (live.status !== 200) throw new Error(`publish: ${JSON.stringify(live.json)}`);
  return live;
}
const tag = (s: string) => `${s}-${RUN_ID}`.toLowerCase();

async function createService(over: Record<string, unknown> = {}) {
  const body = {
    name: `Svc ${tag(String(over.slug ?? "x"))}`,
    description: "A fixture service with a real description",
    category: "cleaning",
    basePrice: 300,
    estimatedDuration: 60,
    materialPolicy: undefined,
    catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    isActive: false,
    ...over,
  };
  const r = await call("POST", "/api/admin/services", body, admin());
  if (r.status === 200) created.push(r.json.data.service.id);
  return r;
}

describe.serial("Phase 01 — identity is enforced by the database", () => {
  test("service_code defaults to slug; slug, service_code and internal_service_code are unique", async () => {
    if (!dbOk) return;
    const a = await prisma.service.create({
      data: { name: `Raw A ${RUN_ID}`, slug: tag("raw-a"), description: "raw", category: "cleaning", basePrice: 100, estimatedDuration: 30, internalServiceCode: `INT-${RUN_ID}` },
    });
    created.push(a.id);
    expect(a.serviceCode).toBe(tag("raw-a"));
    const dupe = async (data: Partial<Prisma.ServiceUncheckedCreateInput>) =>
      prisma.service.create({
        data: { name: `Raw ${Math.random()}`, slug: tag(`raw-${Math.random().toString(36).slice(2, 8)}`), description: "raw", category: "cleaning", basePrice: 100, estimatedDuration: 30, ...data },
      });
    await expect(dupe({ slug: tag("raw-a") })).rejects.toMatchObject({ code: "P2002" });
    await expect(dupe({ serviceCode: tag("raw-a") })).rejects.toMatchObject({ code: "P2002" });
    await expect(dupe({ internalServiceCode: `INT-${RUN_ID}` })).rejects.toMatchObject({ code: "P2002" });
  });

  test("format and range CHECKs refuse impossible rows", async () => {
    if (!dbOk) return;
    const bad = async (data: Partial<Prisma.ServiceUncheckedCreateInput>) =>
      prisma.service.create({
        data: { name: `Bad ${Math.random()}`, slug: tag(`bad-${Math.random().toString(36).slice(2, 8)}`), description: "raw", category: "cleaning", basePrice: 100, estimatedDuration: 30, ...data },
      });
    await expect(bad({ slug: "Has Spaces", serviceCode: tag("valid-code") })).rejects.toThrow(/services_slug_format/);
    await expect(bad({ serviceCode: "UPPER_case" })).rejects.toThrow(/services_service_code_format/);
    await expect(bad({ minPrice: 200 })).rejects.toThrow(/services_price_range/);
    await expect(bad({ estimatedDuration: 0 })).rejects.toThrow(/services_estimated_duration_positive/);
    await expect(bad({ basePrice: -1 })).rejects.toThrow(/services_base_price_nonneg/);
  });

  test("taxonomy: category derived from the operational category; a foreign subcategory is refused", async () => {
    if (!dbOk) return;
    const home = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: "home-cleaning" } });
    const foreignSub = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: "hourly" } }); // child of home-help
    const s = await prisma.service.create({
      data: { name: `Tax ${RUN_ID}`, slug: tag("tax"), description: "raw", category: "cleaning", basePrice: 100, estimatedDuration: 30 },
    });
    created.push(s.id);
    expect(s.categoryId).toBe(home.id);
    await expect(Promise.resolve(prisma.service.update({ where: { id: s.id }, data: { subcategoryId: foreignSub.id } }))).rejects.toThrow(
      /SERVICE_SUBCATEGORY_MISMATCH/,
    );
    await expect(Promise.resolve(prisma.service.update({ where: { id: s.id }, data: { categoryId: foreignSub.id } }))).rejects.toThrow(
      /SERVICE_CATEGORY_NOT_TOP_LEVEL/,
    );
  });

  test("taxonomy tree is exactly two levels deep", async () => {
    if (!dbOk) return;
    const sub = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: "rooms" } });
    await expect(
      Promise.resolve(prisma.serviceCategory.create({ data: { slug: tag("grandchild"), name: "Too deep", parentId: sub.id } })),
    ).rejects.toThrow(/SERVICE_CATEGORY_TOO_DEEP/);
  });

  test("public category tree: 13 categories with their subcategories", async () => {
    if (!dbOk) return;
    const r = await call("GET", "/api/services/categories");
    expect(r.status).toBe(200);
    const slugs = r.json.data.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("home-cleaning");
    expect(slugs).toContain("pet-care");
    expect(slugs.length).toBe(13);
    const cleaning = r.json.data.categories.find((c: { slug: string }) => c.slug === "home-cleaning");
    expect(cleaning.subcategories.map((s: { slug: string }) => s.slug)).toEqual(["rooms", "furnishings", "fixtures"]);
    expect(JSON.stringify(r.json)).not.toMatch(/operationalCategories|"id":/);
  });
});

describe.serial("Phase 01 — admin identity & taxonomy API", () => {
  let id = "";
  test("create with taxonomy by slug; version 1 is written with the acting admin", async () => {
    if (!dbOk) return;
    const r = await createService({ slug: tag("sofa"), categorySlug: "home-cleaning", subcategorySlug: "furnishings", internalServiceCode: `OPS.${RUN_ID}` });
    expect(r.status).toBe(200);
    const svc = r.json.data.service;
    id = svc.id;
    expect(svc.taxonomy).toEqual({ category: { slug: "home-cleaning", name: "Home Cleaning" }, subcategory: { slug: "furnishings", name: "Furnishings" } });
    expect(svc.serviceCode).toBe(tag("sofa"));
    expect(svc.lifecycleStatus).toBe("DRAFT");
    expect(svc.version).toBe(1);
    expect(svc.createdBy).toBe(ctx.superAdmin.id);
    await approveAndPublish(id);
    const v = await prisma.serviceConfigVersion.findUniqueOrThrow({ where: { serviceId_version: { serviceId: id, version: 1 } } });
    expect(v.createdBy).toBe(ctx.superAdmin.id);
    expect(v.snapshot).toMatchObject({ slug: tag("sofa"), basePrice: 300, serviceCode: tag("sofa") });
  });
  test("duplicate business code → 409 DUPLICATE", async () => {
    if (!dbOk) return;
    const r = await createService({ slug: tag("sofa-2"), serviceCode: tag("sofa") });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("DUPLICATE");
  });
  test("subcategory from another category → 400 INVALID_TAXONOMY; unknown category → 400", async () => {
    if (!dbOk) return;
    expect((await createService({ slug: tag("t1"), categorySlug: "home-cleaning", subcategorySlug: "hourly" })).json.code).toBe("INVALID_TAXONOMY");
    expect((await createService({ slug: tag("t2"), categorySlug: "no-such-category" })).json.code).toBe("INVALID_TAXONOMY");
  });
  test("unsafe media → 400 INVALID_MEDIA", async () => {
    if (!dbOk) return;
    const r = await createService({ slug: tag("m1"), thumbnail: "javascript:alert(1)" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_MEDIA");
    expect((await createService({ slug: tag("m2"), images: ["https://ok.test/a.jpg", "//evil.test/b.jpg"] })).json.code).toBe("INVALID_MEDIA");
  });
  test("service code is immutable once set", async () => {
    if (!dbOk) return;
    const r = await call("PUT", `/api/admin/services/${id}`, { serviceCode: "renamed-code" }, admin());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SERVICE_CODE_IMMUTABLE");
  });
  test("a price change on a live service bumps the version atomically; a stale editor is refused", async () => {
    if (!dbOk) return;
    const current = (await prisma.service.findUniqueOrThrow({ where: { id } })).version;
    const r = await call("PUT", `/api/admin/services/${id}`, { basePrice: 350, expectedVersion: current }, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.service.version).toBe(current + 1);
    expect(await prisma.serviceConfigVersion.count({ where: { serviceId: id } })).toBe(current + 1);
    const stale = await call("PUT", `/api/admin/services/${id}`, { basePrice: 360, expectedVersion: current }, admin());
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("VERSION_CONFLICT");
    // A content-only edit does not create a new selling version.
    const content = await call("PUT", `/api/admin/services/${id}`, { detailedDescription: "Longer copy" }, admin());
    expect(content.json.data.service.version).toBe(current + 1);
  });
  test("concurrent price saves never share a version and never lose a version row", async () => {
    if (!dbOk) return;
    const before = (await prisma.service.findUniqueOrThrow({ where: { id } })).version;
    const results = await Promise.all([370, 380, 390, 400].map((p) => call("PUT", `/api/admin/services/${id}`, { basePrice: p }, admin())));
    const ok = results.filter((r) => r.status === 200).length;
    const conflicts = results.filter((r) => r.json.code === "VERSION_CONFLICT").length;
    expect(ok + conflicts).toBe(4);
    const after = await prisma.service.findUniqueOrThrow({ where: { id } });
    expect(after.version).toBe(before + ok);
    expect(await prisma.serviceConfigVersion.count({ where: { serviceId: id } })).toBe(after.version);
  });
  test("two editors saving against the same version at the same instant: exactly one wins", async () => {
    if (!dbOk) return;
    const v = (await prisma.service.findUniqueOrThrow({ where: { id } })).version;
    const results = await Promise.all(
      [410, 420, 430].map((p) => call("PUT", `/api/admin/services/${id}`, { basePrice: p, expectedVersion: v }, admin())),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(results.filter((r) => r.json.code === "VERSION_CONFLICT").length).toBe(2);
    expect((await prisma.service.findUniqueOrThrow({ where: { id } })).version).toBe(v + 1);
  });
  test("version history endpoint lists every published version", async () => {
    if (!dbOk) return;
    const r = await call("GET", `/api/admin/services/${id}/versions`, undefined, admin());
    expect(r.status).toBe(200);
    const vs = r.json.data.versions.map((v: { version: number }) => v.version);
    expect(vs[0]).toBe(r.json.data.currentVersion);
    expect(new Set(vs).size).toBe(vs.length);
  });
});

describe.serial("Phase 01 — lifecycle", () => {
  let id = "";
  test("ACTIVE → ARCHIVED directly is refused with the allowed moves", async () => {
    if (!dbOk) return;
    id = (await createService({ slug: tag("life") })).json.data.service.id;
    await approveAndPublish(id);
    const r = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ARCHIVED", reason: "Fixture retired" }, admin());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("INVALID_LIFECYCLE_TRANSITION");
    expect(r.json.allowed).toContain("PAUSED");
  });
  test("paused service disappears from the customer API", async () => {
    if (!dbOk) return;
    expect((await call("GET", `/api/services/${id}`)).status).toBe(200);
    const r = await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "PAUSED", reason: "Fixture paused" }, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.service).toMatchObject({ lifecycleStatus: "PAUSED", isActive: false, isBookable: false });
    expect((await call("GET", `/api/services/${id}`)).status).toBe(404);
    expect((await call("POST", `/api/services/${id}/resolve-selection`, {})).status).toBe(404);
  });
  test("archived is terminal and never exposed; the legacy toggle cannot revive it", async () => {
    if (!dbOk) return;
    expect((await call("POST", `/api/admin/services/${id}/lifecycle`, { to: "ARCHIVED", reason: "Fixture retired" }, admin())).status).toBe(200);
    const revive = await call("PATCH", `/api/admin/services/${id}/status`, { isActive: true }, admin());
    expect(revive.status).toBe(409);
    expect(revive.json.code).toBe("INVALID_LIFECYCLE_TRANSITION");
    const viaPut = await call("PUT", `/api/admin/services/${id}`, { isActive: true }, admin());
    expect(viaPut.json.code).toBe("INVALID_LIFECYCLE_TRANSITION");
    expect((await call("GET", `/api/services/${id}`)).status).toBe(404);
    const list = await call("GET", `/api/services?limit=100&categorySlug=home-cleaning`);
    expect(list.json.data.services.some((s: { id: string }) => s.id === id)).toBe(false);
  });
  test("a live service cannot lose its description (content gate)", async () => {
    if (!dbOk) return;
    const live = (await createService({ slug: tag("content") })).json.data.service.id;
    await approveAndPublish(live);
    const r = await call("PUT", `/api/admin/services/${live}`, { description: "   " }, admin());
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect(r.json.issues?.map((i: { code: string }) => i.code)).toContain("CONTENT_DESCRIPTION_MISSING");
  });
});

describe.serial("Security — who may manage services", () => {
  test("anonymous, customer, partner and a non-catalogue admin role cannot mutate", async () => {
    if (!dbOk) return;
    const path = `/api/admin/services/${ctx.serviceId}`;
    const body = { basePrice: 1 };
    expect([401, 403]).toContain((await call("PUT", path, body, null)).status);
    expect([401, 403]).toContain((await call("PUT", path, body, bearer(ctx.customerA))).status);
    expect([401, 403]).toContain((await call("PUT", path, body, bearer({ id: ctx.vendorUserId, email: `${RUN_ID}@partner.test` }))).status);
    expect((await call("PUT", path, body, bearer(ctx.supportAdmin))).status).toBe(403);
    expect((await call("POST", `${path}/lifecycle`, { to: "PAUSED" }, bearer(ctx.supportAdmin))).status).toBe(403);
    const row = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    expect(row.basePrice).toBe(500);
  });
  test("a partner cannot read admin service data", async () => {
    if (!dbOk) return;
    const r = await call("GET", `/api/admin/services/${ctx.serviceId}`, undefined, bearer({ id: ctx.vendorUserId, email: `${RUN_ID}@partner.test` }));
    expect([401, 403]).toContain(r.status);
  });
  test("customer projection never carries internal identity, notes or matching rules", async () => {
    if (!dbOk) return;
    await prisma.service.update({
      where: { id: ctx.serviceId },
      data: {
        internalServiceCode: `SECRET.${RUN_ID}`,
        operationsNotes: "internal ops note",
        ownerTeam: "ops-team",
        catalogConfig: { matching: { ratingWeight: 0.9 }, providerRequirements: { requiredSkills: ["cleaning"] } },
      },
    });
    const detail = await call("GET", `/api/services/${ctx.serviceId}`);
    const list = await call("GET", `/api/services?limit=100`);
    for (const body of [JSON.stringify(detail.json), JSON.stringify(list.json)]) {
      expect(body).not.toContain(`SECRET.${RUN_ID}`);
      expect(body).not.toContain("internal ops note");
      expect(body).not.toContain("ops-team");
      expect(body).not.toContain("ratingWeight");
      expect(body).not.toContain("requiredSkills");
      expect(body).not.toMatch(/"serviceCode"|"internalServiceCode"|"operationsNotes"/);
    }
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: Prisma.DbNull, internalServiceCode: null, operationsNotes: null, ownerTeam: null } });
  });
});

describe.serial("Phases 03–04 — the backend is the authority (frontend bypass)", () => {
  const CONFIG = {
    materialPolicy: "PROFESSIONAL_PROVIDED",
    equipmentPolicy: "PROFESSIONAL_PROVIDED",
    quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, durationPerUnitMin: 15 },
    variants: [
      { id: "fabric", name: "Fabric", price: 150, durationMin: 30 },
      { id: "leather", name: "Leather", price: 250, durationMin: 45 },
    ],
    variantRequired: true,
    duration: { preparationMin: 10, cleanupMin: 15 },
    addons: [
      { id: "stain-guard", name: "Stain guard", price: 99, durationMin: 10, compatibleVariantIds: ["fabric"] },
      { id: "deodorise", name: "Deodorise", price: 49, durationMin: 5, maxQuantity: 3 },
    ],
  };
  test("admin saves variants and add-ons; rows carry dependencies and quantities", async () => {
    if (!dbOk) return;
    const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", catalogConfig: CONFIG }, admin());
    expect(r.status).toBe(200);
    const rows = await prisma.serviceAddon.findMany({ where: { serviceId: ctx.serviceId }, orderBy: { code: "asc" } });
    expect(rows.map((a) => [a.code, a.maxQuantity, a.compatibleVariantCodes])).toEqual([
      ["deodorise", 3, []],
      ["stain-guard", null, ["fabric"]],
    ]);
  });
  test("resolve-selection reports every issue and add-on availability", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/services/${ctx.serviceId}/resolve-selection`, {
      variantId: "leather",
      quantity: 9,
      addonIds: ["stain-guard", "stain-guard"],
    });
    expect(r.status).toBe(200);
    expect(r.json.data.ok).toBe(false);
    expect(r.json.data.issues.map((i: { code: string }) => i.code).sort()).toEqual(["ADDON_DUPLICATE", "ADDON_INCOMPATIBLE", "QUANTITY_ABOVE_MAX"]);
    const ok = await call("POST", `/api/services/${ctx.serviceId}/resolve-selection`, {
      variantId: "fabric",
      quantity: 3,
      addonIds: ["stain-guard", "deodorise"],
      addonQuantities: { deodorise: 2 },
    });
    expect(ok.json.data.pricing).toMatchObject({ servicePrice: 450, addonTotal: 197, subtotal: 647 });
    expect(ok.json.data.duration).toMatchObject({ serviceMinutes: 60, addonMinutes: 20, preparationMinutes: 10, cleanupMinutes: 15, totalMinutes: 105 });
  });
  test("a client that skips the UI still cannot quote or book an invalid selection", async () => {
    if (!dbOk) return;
    const token = bearer(ctx.customerA);
    const quote = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, variantId: "leather", quantity: 2, addonIds: ["stain-guard"] }, token);
    expect(quote.status).toBe(400);
    expect(quote.json.code).toBe("INVALID_ADDON");
    expect(quote.json.issues?.[0]).toMatchObject({ code: "ADDON_INCOMPATIBLE", id: "stain-guard" });
    const noVariant = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, quantity: 2 }, token);
    expect(noVariant.json.code).toBe("INVALID_VARIANT");
    const nan = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, variantId: "fabric", quantity: 1e9 }, token);
    expect(nan.status).toBe(400);
    const book = await call(
      "POST",
      "/api/bookings",
      { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(80).toISOString(), variantId: "leather", quantity: 2, addonIds: ["stain-guard"] },
      token,
    );
    expect(book.status).toBe(400);
    expect(book.json.code).toBe("INVALID_ADDON");
  });
  test("a stale service version is refused at quote time", async () => {
    if (!dbOk) return;
    const current = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } })).version;
    const r = await call(
      "POST",
      "/api/bookings/price-quote",
      { serviceId: ctx.serviceId, variantId: "fabric", quantity: 1, serviceVersion: current - 1 || 999 },
      bearer(ctx.customerA),
    );
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SERVICE_VERSION_CHANGED");
    expect(r.json.currentVersion).toBe(current);
  });
  test("a valid booking stores the resolved selection; the partner sees the job brief, not the config", async () => {
    if (!dbOk) return;
    const selection = {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      variantId: "fabric",
      quantity: 3,
      addonIds: ["stain-guard", "deodorise"],
      addonQuantities: { deodorise: 2 },
    };
    const quoted = await call("POST", "/api/bookings/price-quote", selection, bearer(ctx.customerA));
    const book = await call(
      "POST",
      "/api/bookings",
      {
        ...selection,
        scheduledDate: futureSlot(90).toISOString(),
        providerId: ctx.providerId,
        quoteToken: quoted.json.data?.quote?.quoteToken,
      },
      bearer(ctx.customerA),
    );
    expect([200, 201]).toContain(book.status);
    const bookingId = book.json.data.booking?.id ?? book.json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.estimatedDuration).toBe(105);
    expect(row.addons).toEqual([
      { id: "stain-guard", name: "Stain guard", price: 99 },
      { id: "deodorise", name: "Deodorise", price: 98, unitPrice: 49, quantity: 2 },
    ]);
    // A later admin edit must not rewrite the stored selection.
    await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, variants: [{ id: "fabric", name: "Fabric v2", price: 999, durationMin: 90 }], variantRequired: true, addons: [] } }, admin());
    const again = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(again.serviceSelection).toEqual(row.serviceSelection);
    expect((again.serviceSelection as { variant: { name: string } }).variant.name).toBe("Fabric");

    const partner = await call("GET", `/api/bookings/${bookingId}`, undefined, bearer({ id: ctx.vendorUserId, email: `${RUN_ID}@partner.test` }));
    // The booking was created with this provider selected, so the partner may read it.
    expect(partner.status).toBe(200);
    const job = partner.json.data.booking?.job ?? partner.json.data.job;
    expect(job).toMatchObject({ variant: "Fabric", quantity: 3, unit: "seats", durationMinutes: 105 });
    expect(job.addons).toEqual([
      { name: "Stain guard", quantity: 1 },
      { name: "Deodorise", quantity: 2 },
    ]);
    expect(JSON.stringify(partner.json)).not.toMatch(/catalogConfig|operationsNotes|matchingWeights/);
  });
});
