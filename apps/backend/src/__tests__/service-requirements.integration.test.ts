/**
 * Phase 06 end to end on the ISOLATED test database: the admin catalogue and assignment path,
 * publish gate, quote projection, backend-enforced attestation, the immutable booking snapshot,
 * role-safe projections and RBAC. Nothing here fabricates a requirement for a real service —
 * every item is created by the test and belongs to the fixture service.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { sumCounter, sumCounterWhere } from "../lib/metrics";

const RUN = `req-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const itemIds: string[] = [];

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);
const support = () => bearer(ctx.supportAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }, { id: "leather", name: "Leather", price: 400 }],
  variantRequired: true,
  addons: [{ id: "stain-guard", name: "Stain guard", price: 99, compatibleVariantIds: ["fabric"] }, { id: "deodorise", name: "Deodorise", price: 49 }],
  faqs: [{ q: "Unrelated question?", a: "Unrelated answer kept across requirement edits." }],
};
const codeOf = (c: string) => `${RUN}-${c}`;
const REQUIREMENTS = [
  { id: "steam-cleaner", itemCode: codeOf("steam-cleaner"), responsibility: "PROFESSIONAL", charge: "INCLUDED", partnerInstructions: "Portable unit; check the hose seal.", internalNote: "Rental contract #A12", sortOrder: 2 },
  { id: "shampoo", itemCode: codeOf("shampoo"), responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 0.25, unit: "litre", quantityBasis: "PER_SELECTED_UNIT", sortOrder: 1 },
  { id: "socket", itemCode: codeOf("socket"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote: "A standard 3-pin socket within 5 m of the sofa.", sortOrder: 3 },
  { id: "water", itemCode: codeOf("water"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", sortOrder: 4 },
  { id: "spray", itemCode: codeOf("spray"), responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["stain-guard"] }, sortOrder: 5 },
];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (r.status !== 200) throw new Error(`setup: ${JSON.stringify(r.json)}`);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.serviceRequirement.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
  await prisma.serviceRequirementItem.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
}, 60_000);

const version = async () => (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } })).version;
const saveRequirements = (requirements: unknown[], extra: Record<string, unknown> = {}) =>
  version().then((v) => call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, requirements }, expectedVersion: v, changeReason: "Phase 06 test", ...extra }, admin()));

describe.serial("Phase 06 — requirements end to end", () => {
  test("catalogue: admin creates items; codes are validated; duplicates 409; support admin cannot create; customer cannot read", async () => {
    if (!dbOk) return;
    const defs = [
      { code: codeOf("steam-cleaner"), kind: "EQUIPMENT", name: "Steam cleaner" },
      { code: codeOf("shampoo"), kind: "MATERIAL", name: "Upholstery shampoo", customerLabel: "Cleaning shampoo" },
      { code: codeOf("socket"), kind: "CUSTOMER_PRECONDITION", name: "Working power socket within 5 m", customerLabel: "A working power socket near the sofa" },
      { code: codeOf("water"), kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water" },
      { code: codeOf("spray"), kind: "MATERIAL", name: "Stain guard spray" },
      { code: codeOf("retired"), kind: "EQUIPMENT", name: "Retired ladder" },
    ];
    for (const d of defs) {
      const r = await call("POST", "/api/admin/requirement-items", d, admin());
      expect(r.status, d.code).toBe(200);
      itemIds.push(r.json.data.item.id);
    }
    expect((await call("POST", "/api/admin/requirement-items", defs[0], admin())).status).toBe(409);
    expect((await call("POST", "/api/admin/requirement-items", { code: "Bad Code", kind: "MATERIAL", name: "x" }, admin())).status).toBe(400);
    expect((await call("POST", "/api/admin/requirement-items", { code: codeOf("nope"), kind: "MATERIAL", name: "x" }, support())).status).toBe(403);
    expect((await call("POST", "/api/admin/requirement-items", { code: codeOf("nope"), kind: "MATERIAL", name: "x" }, customer())).status).toBe(403);
    expect((await call("GET", "/api/admin/requirement-items", undefined, customer())).status).toBe(403);
    const list = await call("GET", `/api/admin/requirement-items?includeInactive=true`, undefined, admin());
    expect(list.json.data.items.filter((i: { code: string }) => i.code.startsWith(RUN)).length).toBe(6);
  });

  test("catalogue: compare-and-set update; a stale editor gets 409", async () => {
    if (!dbOk) return;
    const id = itemIds[5]!;
    const ok = await call("PUT", `/api/admin/requirement-items/${id}`, { expectedVersion: 1, name: "Retired ladder (v2)" }, admin());
    expect(ok.status).toBe(200);
    expect(ok.json.data.item.version).toBe(2);
    expect((await call("PUT", `/api/admin/requirement-items/${id}`, { expectedVersion: 1, name: "stale" }, admin())).status).toBe(409);
    expect((await call("PUT", `/api/admin/requirement-items/${id}`, { expectedVersion: 2, isActive: false }, admin())).status).toBe(200);
  });

  test("publish gate: inactive item, unknown item, undecided responsibility and conflicts are refused; the service stays as it was", async () => {
    if (!dbOk) return;
    const cases: Array<[string, unknown[], string]> = [
      ["inactive item", [{ id: "ladder", itemCode: codeOf("retired"), responsibility: "PROFESSIONAL", charge: "INCLUDED" }], "REQUIREMENT_ITEM_INACTIVE"],
      ["unknown item", [{ id: "ghost", itemCode: codeOf("does-not-exist"), responsibility: "PROFESSIONAL", charge: "INCLUDED" }], "REQUIREMENT_ITEM_UNKNOWN"],
      ["undecided", [{ id: "steam", itemCode: codeOf("steam-cleaner"), responsibility: "UNKNOWN", charge: "INCLUDED" }], "REQUIREMENT_RESPONSIBILITY_UNKNOWN"],
      ["conflict", [REQUIREMENTS[0], { id: "steam-customer", itemCode: codeOf("steam-cleaner"), responsibility: "CUSTOMER" }], "REQUIREMENT_CONFLICT"],
    ];
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    const conflictsBefore = sumCounterWhere("configuration_validation_failure_total", "REQUIREMENT_CONFLICT");
    for (const [name, reqs, code] of cases) {
      const r = await saveRequirements(reqs);
      expect(r.status, name).toBe(400);
      expect((r.json.issues ?? []).map((i: { code: string }) => i.code), name).toContain(code);
    }
    // Shape rules are refused by the config schema before the gate.
    const shape = await saveRequirements([{ id: "x", itemCode: codeOf("shampoo"), responsibility: "CUSTOMER", charge: "INCLUDED" }]);
    expect(shape.status).toBe(400);
    expect(shape.json.code).toBe("INVALID_CONFIG");
    const after = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    expect(after).toEqual(before);
    expect(sumCounterWhere("configuration_validation_failure_total", "REQUIREMENT_CONFLICT")).toBe(conflictsBefore + 1);
    expect(await prisma.serviceRequirement.count({ where: { serviceId: ctx.serviceId } })).toBe(0);
  });

  test("a consistent configuration saves: rows synced in the same version, unrelated config preserved, audited", async () => {
    if (!dbOk) return;
    const v = await version();
    const r = await saveRequirements(REQUIREMENTS);
    expect(r.status).toBe(200);
    expect(r.json.data.service.version).toBe(v + 1);
    const rows = await prisma.serviceRequirement.findMany({ where: { serviceId: ctx.serviceId }, orderBy: { sortOrder: "asc" }, include: { item: true } });
    expect(rows.map((x) => [x.code, x.item.kind, x.responsibility, x.charge])).toEqual([
      ["shampoo", "MATERIAL", "PROFESSIONAL", "INCLUDED"],
      ["steam-cleaner", "EQUIPMENT", "PROFESSIONAL", "INCLUDED"],
      ["socket", "CUSTOMER_PRECONDITION", "CUSTOMER", "NOT_APPLICABLE"],
      ["water", "CUSTOMER_PRECONDITION", "CUSTOMER", "NOT_APPLICABLE"],
      ["spray", "MATERIAL", "PROFESSIONAL", "CHARGEABLE"],
    ]);
    expect(Number(rows[0]!.quantity)).toBe(0.25);
    expect(rows[4]!.whenAddonCodes).toEqual(["stain-guard"]);
    const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const cfg = svc.catalogConfig as { faqs?: unknown[]; requirementItems?: unknown; requirements?: unknown[] };
    expect(cfg.faqs).toEqual(CONFIG.faqs);
    expect(cfg.requirementItems).toBeUndefined(); // server facts never persist into the JSON
    // Admin view carries the full assignment incl. internal notes.
    const adminView = await call("GET", `/api/admin/services/${ctx.serviceId}`, undefined, admin());
    const adminReq = adminView.json.data.service.catalogConfig.requirements.find((x: { id: string }) => x.id === "steam-cleaner");
    expect(adminReq.internalNote).toBe("Rental contract #A12");
    expect(adminView.json.data.service.catalogConfig.requirementItems[codeOf("steam-cleaner")].kind).toBe("EQUIPMENT");
    const audit = await prisma.activityLog.findFirst({ where: { action: "ADMIN_ACTION", userId: ctx.superAdmin.id, description: { contains: "SERVICE_CONFIG_VERSIONED" } }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
  });

  test("admin surfaces see the catalogue facts: list + save response are not publish-blocked; pause → publish works", async () => {
    if (!dbOk) return;
    // Regression (found in the browser): the admin LIST and the save/lifecycle responses validated a
    // config parsed without catalogue facts → REQUIREMENT_ITEMS_UNRESOLVED → the editor disabled Save
    // for every service with requirements, and publishing through the lifecycle endpoint was refused.
    const saved = await saveRequirements(REQUIREMENTS);
    expect(saved.status).toBe(200);
    expect(saved.json.data.service.publishBlocked).toEqual([]);
    const slug = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { slug: true } })).slug;
    const list = await call("GET", `/api/admin/services?search=${encodeURIComponent(slug)}&limit=20`, undefined, admin());
    expect(list.status).toBe(200);
    const row = (list.json.data.services as Array<{ id: string; publishBlocked: Array<{ code: string }> }>).find((s) => s.id === ctx.serviceId);
    expect(row).toBeDefined();
    expect(row!.publishBlocked).toEqual([]);
    const paused = await call("POST", `/api/admin/services/${ctx.serviceId}/lifecycle`, { to: "PAUSED", reason: "Fixture paused" }, admin());
    expect(paused.status).toBe(200);
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { updatedBy: ctx.supportAdmin.id } });
    expect((await call("POST", `/api/admin/services/${ctx.serviceId}/approve`, {}, admin())).status).toBe(200);
    const live = await call("POST", `/api/admin/services/${ctx.serviceId}/lifecycle`, { to: "ACTIVE" }, admin());
    expect(live.status, JSON.stringify(live.json).slice(0, 300)).toBe(200);
    expect(live.json.data.service.publishBlocked).toEqual([]);
  });

  test("saving one service never touches another service's requirement rows or configuration", async () => {
    if (!dbOk) return;
    const sibling = await prisma.service.create({
      data: { name: `Adv Sibling ${RUN}`, slug: `adv-service-adv-${RUN}-sibling`, description: "Phase 06 isolation fixture", category: "cleaning", basePrice: 250, estimatedDuration: 60, availableCities: ["Noida"], tags: ["adv"] },
    });
    const own = await call("PUT", `/api/admin/services/${sibling.id}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: { ...CONFIG, requirements: [REQUIREMENTS[1]] } }, admin());
    expect(own.status).toBe(200);
    const before = await prisma.service.findUniqueOrThrow({ where: { id: sibling.id }, select: { version: true, catalogConfig: true } });
    expect(await prisma.serviceRequirement.count({ where: { serviceId: sibling.id } })).toBe(1);
    expect((await saveRequirements(REQUIREMENTS)).status).toBe(200);
    expect(await prisma.serviceRequirement.count({ where: { serviceId: sibling.id } })).toBe(1);
    expect(await prisma.service.findUniqueOrThrow({ where: { id: sibling.id }, select: { version: true, catalogConfig: true } })).toEqual(before);
  });

  test("a client cannot assert catalogue facts: requirementItems in the payload is ignored", async () => {
    if (!dbOk) return;
    const r = await saveRequirements([{ id: "ladder", itemCode: codeOf("retired"), responsibility: "PROFESSIONAL", charge: "INCLUDED" }], {
      catalogConfig: { ...CONFIG, requirements: [{ id: "ladder", itemCode: codeOf("retired"), responsibility: "PROFESSIONAL", charge: "INCLUDED" }], requirementItems: { [codeOf("retired")]: { code: codeOf("retired"), kind: "EQUIPMENT", name: "x", isActive: true } } },
    });
    expect(r.status).toBe(400);
    expect((r.json.issues ?? []).map((i: { code: string }) => i.code)).toContain("REQUIREMENT_ITEM_INACTIVE");
  });

  test("customer: detail and quote carry the customer view only; the selection changes the requirements", async () => {
    if (!dbOk) return;
    const detail = await call("GET", `/api/services/${ctx.serviceId}`);
    expect(detail.status).toBe(200);
    const prep = detail.json.data.service.preparation;
    expect(prep.weBring.map((x: { label: string }) => x.label)).toEqual(["Cleaning shampoo", "Steam cleaner"]);
    expect(prep.weBring[0].quantity).toBe("0.75 litre"); // default 3 seats × 0.25
    expect(prep.beforeBooking[0]).toMatchObject({ label: "Access to running water", mustConfirm: true });
    const body = JSON.stringify(detail.json);
    for (const leak of ["Portable unit", "Rental contract", "partnerInstructions", "internalNote", "itemCode", "REQUIRED_BEFORE_BOOKING", "PARTNER_CHECK"]) expect(body, leak).not.toContain(leak);
    expect(JSON.stringify(prep)).not.toMatch(/PROFESSIONAL|CUSTOMER|INCLUDED|CHARGEABLE/);
    expect(detail.json.data.service.catalogConfig.requirements).toBeUndefined();

    const resolvedBefore = sumCounter("service_requirement_resolution_total");
    const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, addonIds: ["stain-guard"] }, customer());
    expect(q.status).toBe(200);
    expect(sumCounter("service_requirement_resolution_total")).toBe(resolvedBefore + 1);
    const reqs = q.json.data.quote.requirements;
    expect(reqs.weBring.map((x: { label: string; quantity: string | null; chargeText: string | null }) => [x.label, x.quantity, x.chargeText])).toEqual([
      ["Cleaning shampoo", "0.5 litre", "Included in the price"],
      ["Steam cleaner", null, "Included in the price"],
      ["Stain guard spray", null, "Charged with Stain guard"],
    ]);
    const qbody = JSON.stringify(q.json);
    for (const leak of ["Portable unit", "Rental contract", "partnerInstructions", "internalNote"]) expect(qbody, leak).not.toContain(leak);
  });

  let bookingId = "";
  test("booking: a REQUIRED_BEFORE_BOOKING requirement is enforced by the backend; confirmation books and the snapshot is written", async () => {
    if (!dbOk) return;
    const selection = { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, addonIds: ["stain-guard"] };
    const quoted = await call("POST", "/api/bookings/price-quote", selection, customer());
    const sel = { ...selection, scheduledDate: futureSlot(150).toISOString(), quoteToken: quoted.json.data?.quote?.quoteToken };
    const before = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
    const missingBefore = sumCounter("requirement_attestation_missing_total");
    const refused = await call("POST", "/api/bookings", sel, customer());
    expect(refused.status).toBe(400);
    expect(sumCounter("requirement_attestation_missing_total")).toBe(missingBefore + 1);
    expect(refused.json.code).toBe("REQUIREMENTS_NOT_CONFIRMED");
    expect(refused.json.requirements).toEqual([{ code: "water", label: "Access to running water" }]);
    const wrong = await call("POST", "/api/bookings", { ...sel, requirementAttestations: ["socket"] }, customer());
    expect(wrong.json.code).toBe("REQUIREMENTS_NOT_CONFIRMED");
    expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(before);

    const snapshotsBefore = sumCounterWhere("requirement_snapshot_created_total", "blocking=true,empty=false");
    const ok = await call("POST", "/api/bookings", { ...sel, requirementAttestations: ["water"] }, customer());
    expect(ok.status).toBe(201);
    expect(sumCounterWhere("requirement_snapshot_created_total", "blocking=true,empty=false")).toBe(snapshotsBefore + 1);
    bookingId = ok.json.data.booking?.id ?? ok.json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const snap = (row.serviceConfigSnapshot as { requirements: any }).requirements;
    expect(snap.schema).toBe("requirements.v1");
    expect(snap.serviceVersion).toBe(row.serviceConfigVersion);
    expect(snap.blocking).toEqual(["water"]);
    expect(snap.items.find((i: { code: string }) => i.code === "water").attested).toBe(true);
    expect(snap.items.map((i: { code: string }) => i.code)).toEqual(["shampoo", "steam-cleaner", "socket", "water", "spray"]);
    expect(JSON.stringify(snap)).not.toContain("Rental contract");
    expect(snap.professionalNeeds.map((n: { itemCode: string }) => n.itemCode)).toEqual([codeOf("shampoo"), codeOf("steam-cleaner"), codeOf("spray")]);
  });

  test("projections: partner gets the execution brief from the snapshot; customer gets what they were told; neither sees the other's notes", async () => {
    if (!dbOk) return;
    await prisma.booking.update({ where: { id: bookingId }, data: { providerId: ctx.providerId, status: "ACCEPTED" } });
    const p = await call("GET", `/api/bookings/${bookingId}`, undefined, partner());
    expect(p.status).toBe(200);
    const brief = p.json.data.booking.requirements;
    expect(brief.bringEquipment[0]).toMatchObject({ label: "Steam cleaner", instructions: "Portable unit; check the hose seal." });
    expect(brief.bringMaterials.map((m: { label: string; quantity: string | null; chargeable: boolean }) => [m.label, m.quantity, m.chargeable])).toEqual([["Upholstery shampoo", "0.5 litre", false], ["Stain guard spray", null, true]]);
    expect(brief.preconditions.map((x: { label: string; check: string }) => [x.label, x.check])).toEqual([["Working power socket within 5 m", "VERIFY_ON_ARRIVAL"], ["Running water access", "CONFIRMED_BY_CUSTOMER"]]);
    expect(JSON.stringify(p.json)).not.toContain("Rental contract");
    // The partner web job page reads bookings from the LIST — it must carry the same snapshot brief.
    const list = await call("GET", "/api/providers/me/bookings?limit=50", undefined, partner());
    expect(list.status).toBe(200);
    const row = (list.json.data.bookings as Array<{ id: string; requirements: unknown }>).find((x) => x.id === bookingId);
    expect(row?.requirements).toEqual(brief);
    expect(JSON.stringify(list.json)).not.toContain("Rental contract");

    const c = await call("GET", `/api/bookings/${bookingId}`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.booking.requirements.beforeBooking[0].label).toBe("Access to running water");
    expect(JSON.stringify(c.json)).not.toContain("Portable unit");
    expect(JSON.stringify(c.json)).not.toContain("Rental contract");
    // Another customer: the booking is not theirs.
    const other = await call("GET", `/api/bookings/${bookingId}`, undefined, bearer(ctx.customerB));
    expect([403, 404]).toContain(other.status);
  });

  test("versioning: changing the requirements bumps the service version; the booking keeps its snapshot", async () => {
    if (!dbOk) return;
    const v = await version();
    const changed = REQUIREMENTS.map((r) => (r.id === "steam-cleaner" ? { id: "steam-cleaner", itemCode: codeOf("steam-cleaner"), responsibility: "CUSTOMER", sortOrder: 2 } : r));
    const r = await saveRequirements(changed);
    expect(r.status).toBe(200);
    expect(r.json.data.service.version).toBe(v + 1);
    const detail = await call("GET", `/api/services/${ctx.serviceId}`);
    expect(detail.json.data.service.preparation.youProvide.map((x: { label: string }) => x.label)).toEqual(["Steam cleaner"]);
    // Historical booking: still "professional brings the steam cleaner".
    const p = await call("GET", `/api/bookings/${bookingId}`, undefined, partner());
    expect(p.json.data.booking.requirements.bringEquipment.map((x: { label: string }) => x.label)).toEqual(["Steam cleaner"]);
    expect(p.json.data.booking.requirements.customerProvides).toEqual([]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect((row.serviceConfigSnapshot as any).requirements.serviceVersion).toBe(v);
  });

  test("a stale admin editor gets 409 and changes nothing", async () => {
    if (!dbOk) return;
    const v = await version();
    const stale = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, requirements: [] }, expectedVersion: v - 1 }, admin());
    expect(stale.status).toBe(409);
    expect(await prisma.serviceRequirement.count({ where: { serviceId: ctx.serviceId } })).toBe(5);
  });

  test("an inactive assignment and an archived item are never exposed; archiving an item in active use is refused", async () => {
    if (!dbOk) return;
    const off = REQUIREMENTS.map((r) => (r.id === "socket" ? { ...r, active: false } : r));
    expect((await saveRequirements(off)).status).toBe(200);
    const detail = await call("GET", `/api/services/${ctx.serviceId}`);
    expect(JSON.stringify(detail.json.data.service.preparation)).not.toContain("power socket");
    const inUse = itemIds[0]!; // steam cleaner
    const r = await call("PUT", `/api/admin/requirement-items/${inUse}`, { expectedVersion: 1, isActive: false }, admin());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("IN_USE");
  });

  test("partner cannot edit the service or the catalogue; a service with no requirements still books", async () => {
    if (!dbOk) return;
    expect((await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: CONFIG }, partner())).status).toBe(403);
    expect((await call("PUT", `/api/admin/requirement-items/${itemIds[0]}`, { expectedVersion: 1, name: "x" }, partner())).status).toBe(403);
    expect((await saveRequirements([])).status).toBe(200);
    const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 1 }, customer());
    expect(q.json.data.quote.requirements).toMatchObject({ empty: true, weBring: [], beforeBooking: [] });
    const bare = { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 1 };
    const bareQuote = await call("POST", "/api/bookings/price-quote", bare, customer());
    const b = await call("POST", "/api/bookings", { ...bare, scheduledDate: futureSlot(170).toISOString(), quoteToken: bareQuote.json.data?.quote?.quoteToken }, customer());
    expect(b.status).toBe(201);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.json.data.booking?.id ?? b.json.data.id } });
    expect((row.serviceConfigSnapshot as any).requirements.items).toEqual([]);
  });
});
