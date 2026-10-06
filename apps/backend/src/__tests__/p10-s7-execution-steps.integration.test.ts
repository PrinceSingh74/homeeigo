/**
 * Phase 10 §7/§8 — execution plan and steps end to end on the isolated test DB, through the real routes.
 *
 * Service: requirements (a REQUIRED_AT_START partner check `shutoff`, a booking attestation `water`)
 * and a plan: prep (mandatory) → apply (mandatory, PHOTO evidence, depends on prep, safety-linked to
 * `shutoff`) → tidy (optional, skippable) + leather-oil (mandatory, only for the leather variant).
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { bookingRequirementService } from "../services/booking-requirement.service";
import { bookingExecutionService } from "../services/booking-execution.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `p10s7-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
const itemIds: string[] = [];
let hoursAhead = 90;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  // Booking create requires a price quote (QUOTE_REQUIRED otherwise) — quote first, as a client does.
  if (method === "POST" && path === BOOKING_CREATE_PATH) body = await withQuoteToken(app, token, body);
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });
const codeOf = (c: string) => `${RUN}-${c}`;

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }, { id: "leather", name: "Leather", price: 400 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [] as unknown[],
};
const REQUIREMENTS = () => [
  { id: "shutoff", itemCode: codeOf("shutoff"), responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", sortOrder: 1 },
  { id: "water", itemCode: codeOf("water"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", sortOrder: 2 },
];
const PLAN = [
  { id: "prep", title: "Protect the floor", kind: "PREPARATION", sortOrder: 1, ppe: ["gloves"] },
  { id: "apply", title: "Shampoo the seats", kind: "WORK", evidence: "PHOTO", dependsOn: ["prep"], safetyRequirement: "shutoff", sortOrder: 2 },
  { id: "leather-oil", title: "Condition the leather", kind: "WORK", when: { variantIds: ["leather"] }, sortOrder: 3 },
  { id: "tidy", title: "Tidy up", kind: "CLOSEOUT", mandatory: false, skipPolicy: "SKIP_WITH_REASON", sortOrder: 4 },
];
const version = async () => (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } })).version;
const save = (steps: unknown[]) =>
  version().then((v) => call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, requirements: REQUIREMENTS(), execution: { steps } }, expectedVersion: v, changeReason: "§7 test" }, admin()));

async function book(variantId = "fabric"): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId, quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString(), requirementAttestations: ["water"] }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}
const step = (id: string, code: string, action: string, body?: unknown) => call("POST", `/api/bookings/${id}/execution/${code}/${action}`, body ?? {}, partner());
const stateOf = async (id: string, code: string) => (await prisma.$queryRaw<{ state: string }[]>`SELECT state FROM booking_execution_steps WHERE booking_id = ${id} AND code = ${code}`)[0]?.state;
async function startJob(id: string) {
  await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "shutoff", outcome: "SATISFIED", latitude: addr.latitude, longitude: addr.longitude });
  await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
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
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  for (const d of [
    { code: codeOf("shutoff"), kind: "CUSTOMER_PRECONDITION", name: "Water shut-off access", customerLabel: "Access to the water shut-off valve" },
    { code: codeOf("water"), kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water" },
  ]) {
    const r = await call("POST", "/api/admin/requirement-items", d, admin());
    if (r.status !== 200) throw new Error(`item: ${JSON.stringify(r.json)}`);
    itemIds.push(r.json.data.item.id);
  }
  const base = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (base.status !== 200) throw new Error(`service: ${JSON.stringify(base.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.serviceRequirement.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
  await prisma.serviceRequirementItem.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
}, 60_000);

describe.serial("§7 plan versioning", () => {
  test("a broken plan is refused at publish and the service stays as it was", async () => {
    if (!dbOk) return;
    const before = await version();
    const cycle = await save([{ id: "a", title: "A", kind: "WORK", dependsOn: ["b"] }, { id: "b", title: "B", kind: "WORK", dependsOn: ["a"] }]);
    expect(cycle.status).toBe(400);
    expect(JSON.stringify(cycle.json)).toContain("EXECUTION_DEPENDENCY_CYCLE");
    const skippable = await save([{ id: "a", title: "A", kind: "WORK", mandatory: true, skipPolicy: "SKIP_WITH_REASON" }]);
    expect(skippable.status).toBe(400);
    expect(await version()).toBe(before);
  });

  test("a valid plan saves, bumps the service version and is mirrored typed", async () => {
    if (!dbOk) return;
    const before = await version();
    const r = await save(PLAN);
    expect(r.status).toBe(200);
    expect(await version()).toBe(before + 1);
    const rows = await prisma.$queryRaw<{ code: string; is_mandatory: boolean; skip_policy: string; depends_on: string[] }[]>`
      SELECT code, is_mandatory, skip_policy, depends_on FROM service_execution_steps WHERE service_id = ${ctx.serviceId} ORDER BY sort_order`;
    expect(rows.map((x) => x.code)).toEqual(["prep", "apply", "leather-oil", "tidy"]);
    expect(rows[1]!.depends_on).toEqual(["prep"]);
  });
});

describe.serial("§8 steps through the real routes", () => {
  let id = "";
  test("the booking freezes the steps of ITS selection and gets one state row per step", async () => {
    if (!dbOk) return;
    id = await book("fabric");
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true, serviceConfigVersion: true } }));
    const ex = (snap.serviceConfigSnapshot as { execution: { schema: string; serviceVersion: number; steps: Array<{ code: string }> } }).execution;
    expect(ex.schema).toBe("execution.v1");
    expect(ex.serviceVersion).toBe(snap.serviceConfigVersion ?? -1);
    expect(ex.steps.map((s) => s.code)).toEqual(["prep", "apply", "tidy"]);
    const rows = await prisma.$queryRaw<{ code: string; state: string }[]>`SELECT code, state FROM booking_execution_steps WHERE booking_id = ${id} ORDER BY step_number`;
    expect(rows).toEqual([{ code: "prep", state: "PENDING" }, { code: "apply", state: "PENDING" }, { code: "tidy", state: "PENDING" }]);
  });

  test("before the job starts, steps are BLOCKED and cannot be started", async () => {
    if (!dbOk) return;
    const v = await call("GET", `/api/bookings/${id}/execution`, undefined, partner());
    expect(v.json.data.steps.map((s: { state: string }) => s.state)).toEqual(["BLOCKED", "BLOCKED", "BLOCKED"]);
    const r = await step(id, "prep", "start");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("BOOKING_NOT_IN_PROGRESS");
  });

  test("completion is refused while mandatory steps are open — structured EXECUTION_GATE_BLOCKED", async () => {
    if (!dbOk) return;
    await startJob(id);
    const r = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("EXECUTION_GATE_BLOCKED");
    expect(r.json.data.blocking.map((b: { code: string; reason: string }) => [b.code, b.reason])).toEqual([["prep", "MANDATORY_STEP_INCOMPLETE"], ["apply", "MANDATORY_STEP_INCOMPLETE"]]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("IN_PROGRESS");
  });

  test("dependencies are enforced by the server; a customer cannot act on steps", async () => {
    if (!dbOk) return;
    const early = await step(id, "apply", "start");
    expect(early.status).toBe(409);
    expect(early.json.code).toBe("DEPENDENCY_INCOMPLETE");
    const byCustomer = await call("POST", `/api/bookings/${id}/execution/prep/start`, {}, customer());
    expect([401, 403]).toContain(byCustomer.status);
    expect(await stateOf(id, "prep")).toBe("PENDING");
  });

  test("a client cannot declare completion: COMPLETE needs START first; replay is a no-op", async () => {
    if (!dbOk) return;
    expect((await step(id, "prep", "complete")).json.code).toBe("STEP_NOT_IN_PROGRESS");
    expect((await step(id, "prep", "start")).json.data.state).toBe("IN_PROGRESS");
    const done = await step(id, "prep", "complete");
    expect(done.json.data).toMatchObject({ state: "COMPLETED", changed: true });
    const again = await step(id, "prep", "complete");
    expect(again.status).toBe(200);
    expect(again.json.data.changed).toBe(false);
    const audits = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_execution_audit WHERE booking_id = ${id} AND code = 'prep' AND to_state = 'COMPLETED'`;
    expect(audits[0]!.n).toBe(1);
  });

  test("PHOTO evidence must exist in job_evidence for THIS booking — a missing or foreign id is refused", async () => {
    if (!dbOk) return;
    expect((await step(id, "apply", "start")).json.data.state).toBe("IN_PROGRESS");
    const none = await step(id, "apply", "complete");
    expect(none.status).toBe(400);
    expect(none.json.code).toBe("EVIDENCE_REQUIRED");
    const other = await book("fabric");
    const foreign = await prisma.jobEvidence.create({ data: { bookingId: other, providerId: ctx.providerId, stage: "START", mediaStorageKey: `evidence/${RUN}/x.jpg` } as never });
    expect((await step(id, "apply", "complete", { evidenceId: foreign.id })).json.code).toBe("EVIDENCE_REQUIRED");
    const medialess = await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "START" } as never });
    expect((await step(id, "apply", "complete", { evidenceId: medialess.id })).json.code).toBe("EVIDENCE_REQUIRED");
    const real = await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "START", mediaStorageKey: `evidence/${RUN}/seats.jpg` } as never });
    const ok = await step(id, "apply", "complete", { evidenceId: real.id });
    expect(ok.json.data.state).toBe("COMPLETED");
    const [{ evidence_ref }] = await prisma.$queryRaw<{ evidence_ref: string }[]>`SELECT evidence_ref FROM booking_execution_steps WHERE booking_id = ${id} AND code = 'apply'`;
    expect(evidence_ref).toBe(real.id);
  });

  test("a mandatory step cannot be skipped; an optional one needs a reason", async () => {
    if (!dbOk) return;
    const other = await book("fabric");
    await startJob(other);
    expect((await step(other, "prep", "skip", { reason: "no floor" })).json.code).toBe("STEP_NOT_SKIPPABLE");
    expect((await step(id, "tidy", "skip")).json.code).toBe("REASON_REQUIRED");
    expect((await step(id, "tidy", "skip", { reason: "customer asked to leave as is" })).json.data.state).toBe("SKIPPED_WITH_REASON");
  });

  test("the customer sees titles and states, never the partner's notes or reasons; outsiders get 404", async () => {
    if (!dbOk) return;
    const c = await call("GET", `/api/bookings/${id}/execution`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.steps.map((s: { title: string; state: string }) => [s.title, s.state])).toEqual([["Protect the floor", "COMPLETED"], ["Shampoo the seats", "COMPLETED"], ["Tidy up", "SKIPPED_WITH_REASON"]]);
    expect(JSON.stringify(c.json)).not.toContain("customer asked to leave as is");
    expect((await call("GET", `/api/bookings/${id}/execution`, undefined, bearer(ctx.customerB))).status).toBe(404);
  });

  test("with the plan done the job completes", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(r.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("COMPLETED");
  });
});

describe.serial("exceptions, admin, immutability, concurrency", () => {
  test("a FAILED step blocks completion; only an admin reset (with reason) reopens it; there is no admin complete", async () => {
    if (!dbOk) return;
    const id = await book("fabric");
    await startJob(id);
    await step(id, "prep", "start");
    expect((await step(id, "prep", "fail")).json.code).toBe("REASON_REQUIRED");
    expect((await step(id, "prep", "fail", { reason: "floor too wet to protect" })).json.data.state).toBe("FAILED");
    const blocked = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(blocked.json.data.blocking[0]).toMatchObject({ code: "prep", reason: "STEP_FAILED" });
    expect((await call("POST", `/api/admin/bookings/${id}/execution/prep/reset`, { reason: "retry" }, customer())).status).toBe(403);
    const reset = await call("POST", `/api/admin/bookings/${id}/execution/prep/reset`, { reason: "floor dried, retry" }, admin());
    expect(reset.json.data.state).toBe("PENDING");
    expect((await call("POST", `/api/admin/bookings/${id}/execution/prep/complete`, { reason: "x" }, admin())).status).toBe(404);
    const view = await call("GET", `/api/admin/bookings/${id}/execution`, undefined, admin());
    const last = view.json.data.audit.at(-1);
    expect(last).toMatchObject({ code: "prep", action: "RESET", from_state: "FAILED", to_state: "PENDING", actor_type: "admin" });
  });

  test("the conditional step exists only for the selection that needs it, and gates that booking", async () => {
    if (!dbOk) return;
    const id = await book("leather");
    const rows = await prisma.$queryRaw<{ code: string }[]>`SELECT code FROM booking_execution_steps WHERE booking_id = ${id} ORDER BY step_number`;
    expect(rows.map((r) => r.code)).toEqual(["prep", "apply", "leather-oil", "tidy"]);
  });

  test("an admin edit to the plan never reaches an existing booking", async () => {
    if (!dbOk) return;
    const id = await book("fabric");
    const before = await prisma.$queryRaw<{ code: string; is_mandatory: boolean }[]>`SELECT code, is_mandatory FROM booking_execution_steps WHERE booking_id = ${id} ORDER BY step_number`;
    expect((await save(PLAN.filter((s) => s.id !== "prep").map((s) => ({ ...s, dependsOn: undefined })))).status).toBe(200);
    const after = await prisma.$queryRaw<{ code: string; is_mandatory: boolean }[]>`SELECT code, is_mandatory FROM booking_execution_steps WHERE booking_id = ${id} ORDER BY step_number`;
    expect(after).toEqual(before);
    const v = await call("GET", `/api/bookings/${id}/execution`, undefined, partner());
    expect(v.json.data.steps.map((s: { code: string }) => s.code)).toEqual(["prep", "apply", "tidy"]);
    expect((await save(PLAN)).status).toBe(200);
  });

  test("deterministic race: two COMPLETEs of one step, forced to wait on the step row lock — one writes, one replays", async () => {
    if (!dbOk) return;
    const id = await book("fabric");
    await startJob(id);
    await step(id, "prep", "start");
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let acquired!: () => void;
    const acq = new Promise<void>((r) => (acquired = r));
    const holder = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM booking_execution_steps WHERE booking_id = ${id} FOR UPDATE`;
      acquired();
      await released;
    }, { timeout: 60_000 });
    await acq;
    const racers = [0, 1].map(() => bookingExecutionService.transition({ bookingId: id, code: "prep", action: "COMPLETE", actor: { role: "PARTNER", providerId: ctx.providerId, userId: ctx.vendorUserId } }));
    for (let t0 = Date.now(); ; ) {
      const [{ c }] = await prisma.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%booking_execution_steps%FOR UPDATE%'`;
      if (c >= 2) break;
      if (Date.now() - t0 > 20_000) throw new Error("barrier not reached");
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    const out = await Promise.all(racers);
    expect(out.map((o) => o.ok && o.state)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(out.filter((o) => o.ok && o.changed).length).toBe(1);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_execution_audit WHERE booking_id = ${id} AND code = 'prep' AND to_state = 'COMPLETED'`;
    expect(n).toBe(1);
  }, 60_000);

  test("mandatory-skip and the audit are protected below the application", async () => {
    if (!dbOk) return;
    const id = await book("fabric");
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_execution_steps SET state = 'SKIPPED_WITH_REASON', reason = 'raw', actor_role = 'PARTNER', finished_at = now() WHERE booking_id = ${id} AND code = 'prep'`)).rejects.toThrow(/mandatory_skip/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_execution_audit SET to_state = 'COMPLETED' WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
  });
});
