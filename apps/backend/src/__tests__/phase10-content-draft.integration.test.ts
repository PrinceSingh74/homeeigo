/**
 * Phase 10 — one DRAFT service's content (sofa-deep-cleaning) applied to a fixture service through the
 * canonical admin write, then booked through the real routes on the isolated test DB. Proves the draft
 * is what a booking would freeze: `execution` (execution.v1, the draft's steps) and `safety` (safety.v1,
 * the draft's prohibited conditions), rendered by GET /api/bookings/:id/execution and /:id/safety.
 * The merge uses the apply plan's own buildNextConfig, so the exact config the plan would write is tested.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { DRAFT } from "../../scripts/data/phase-10-execution-safety-content-draft";
import { buildNextConfig, diffManaged, untouchedKeysPreserved } from "../../scripts/phase10-content-apply-plan";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `p10draft-${Date.now().toString(36)}`;
const SLUG = "sofa-deep-cleaning";
const draft = DRAFT[SLUG]!;
let ctx: AdvCtx;
let dbOk = false;
let hoursAhead = 100;
let appliedConfig: Record<string, unknown> = {};

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

/** The fixture's own commercial config (the seed leaves catalogConfig empty) — nothing execution/safety/quality here. */
const BASE = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [] as unknown[],
  quality: { warrantyDays: 7 },
};

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  // 1. Give the fixture its commercial config through the admin route (what a real service already has).
  const base = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: BASE, changeReason: "phase10 draft test: base" }, admin());
  if (base.status !== 200) throw new Error(`service base: ${JSON.stringify(base.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("phase 10 draft (sofa-deep-cleaning) through the canonical write and the real booking routes", () => {
  let id = "";

  test("the draft merges onto the fixture's existing catalogConfig and the admin write accepts it (version bump, only managed keys changed)", async () => {
    if (!dbOk) return;
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    const next = buildNextConfig(before.catalogConfig, draft);
    expect(untouchedKeysPreserved(before.catalogConfig, next)).toBe(true);
    expect(diffManaged(before.catalogConfig, next).map((x) => x.key)).toEqual(["execution", "safety", "quality"]);
    expect((next.quality as { warrantyDays?: number }).warrantyDays).toBe(7); // quality sub-key the draft does not define is kept
    const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: next, expectedVersion: before.version, changeReason: `phase10 draft ${SLUG}` }, admin());
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const after = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true, catalogConfig: true } });
    expect(after.version).toBe(before.version + 1);
    appliedConfig = after.catalogConfig as Record<string, unknown>;
    expect((appliedConfig.execution as { steps: unknown[] }).steps).toHaveLength(draft.execution!.steps.length);
    expect((appliedConfig.safety as { prohibitedConditions: string[] }).prohibitedConditions).toEqual(draft.safety!.prohibitedConditions!);
    expect(diffManaged(appliedConfig, buildNextConfig(appliedConfig, draft))).toEqual([]); // re-planning is SKIP_IDENTICAL
    // The typed mirror the admin write syncs (service_execution_steps) carries the draft's step codes.
    const mirrored = await prisma.$queryRaw<{ code: string }[]>`SELECT code FROM service_execution_steps WHERE service_id = ${ctx.serviceId} ORDER BY sort_order`;
    expect(mirrored.map((m) => m.code)).toEqual(draft.execution!.steps.map((s) => s.id));
  });

  test("a booking freezes execution.v1 with the draft's steps and safety.v1 with the draft's prohibited conditions", async () => {
    if (!dbOk) return;
    id = await book();
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as {
      execution: { schema: string; serviceVersion: number; steps: Array<{ code: string; title: string; kind: string; mandatory: boolean; evidence: string }> };
      safety: { schema: string; prohibitedConditions: string[]; warnings: string[]; emergencyProtocol: string };
    };
    expect(snap.execution.schema).toBe("execution.v1");
    expect(snap.execution.steps).toHaveLength(draft.execution!.steps.length);
    expect(snap.execution.steps.map((s) => s.code)).toEqual(draft.execution!.steps.map((s) => s.id));
    expect(snap.execution.steps.map((s) => s.kind)).toEqual(draft.execution!.steps.map((s) => s.kind));
    expect(snap.execution.steps.every((s) => s.mandatory)).toBe(true);
    expect(snap.execution.steps.find((s) => s.code === "shampoo")?.evidence).toBe("BEFORE_AFTER_PHOTOS");
    expect(snap.safety.schema).toBe("safety.v1");
    expect(snap.safety.prohibitedConditions).toEqual(draft.safety!.prohibitedConditions!);
    expect(snap.safety.warnings).toEqual(draft.safety!.warnings!);
    expect(snap.safety.emergencyProtocol).toBe(draft.safety!.emergencyProtocol!);
  });

  test("GET /api/bookings/:id/execution renders the draft's steps for the partner and the customer", async () => {
    if (!dbOk) return;
    const p = await call("GET", `/api/bookings/${id}/execution`, undefined, partner());
    expect(p.status).toBe(200);
    expect(p.json.data.steps.map((s: { code: string }) => s.code)).toEqual(draft.execution!.steps.map((s) => s.id));
    expect(p.json.data.steps.map((s: { title: string }) => s.title)).toEqual(draft.execution!.steps.map((s) => s.title));
    expect(new Set(p.json.data.steps.map((s: { state: string }) => s.state))).toEqual(new Set(["BLOCKED"])); // job not started yet
    const c = await call("GET", `/api/bookings/${id}/execution`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.steps).toHaveLength(draft.execution!.steps.length);
    expect(c.json.data.steps.map((s: { title: string }) => s.title)).toEqual(draft.execution!.steps.map((s) => s.title));
    expect((await call("GET", `/api/bookings/${id}/execution`, undefined, bearer(ctx.customerB))).status).toBe(404);
  });

  test("GET /api/bookings/:id/safety renders the draft's prohibited conditions (partner can report exactly those) and customer-facing safety text", async () => {
    if (!dbOk) return;
    const p = await call("GET", `/api/bookings/${id}/safety`, undefined, partner());
    expect(p.status).toBe(200);
    expect(p.json.data.canReport).toEqual(draft.safety!.prohibitedConditions!);
    expect(p.json.data.gate.ok).toBe(true);
    expect(p.json.data.holds).toEqual([]);
    const c = await call("GET", `/api/bookings/${id}/safety`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.safety).toMatchObject({ emergencyProtocol: draft.safety!.emergencyProtocol, warnings: draft.safety!.warnings });
    expect(c.json.data.safety.customerRequirements).toEqual(draft.safety!.customerRequirements!);
    for (const line of draft.safety!.providerRequirements!) expect(JSON.stringify(c.json)).not.toContain(line); // partner-only text stays partner-only
    expect((await call("GET", `/api/bookings/${id}/safety`, undefined, bearer(ctx.customerB))).status).toBe(404);
  });

  test("the partner can raise one of the draft's prohibited conditions and it becomes an ACTIVE hold; an unlisted one is refused", async () => {
    if (!dbOk) return;
    const listed = draft.safety!.prohibitedConditions![0]!;
    const bad = await call("POST", `/api/bookings/${id}/safety/prohibited-condition`, { condition: "Something not in the draft" }, partner());
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("CONDITION_NOT_CONFIGURED");
    const ok = await call("POST", `/api/bookings/${id}/safety/prohibited-condition`, { condition: listed }, partner());
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const holds = await prisma.$queryRaw<{ state: string; condition: string }[]>`SELECT state, condition FROM booking_safety_holds WHERE booking_id = ${id}`;
    expect(holds).toEqual([{ state: "ACTIVE", condition: listed }]);
    await prisma.partnerSafetyIncident.deleteMany({ where: { bookingId: id } }).catch(() => {});
  });
});
