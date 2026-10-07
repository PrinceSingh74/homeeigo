/**
 * Phase 10 §10 — quality verdict, completion and customer confirmation end to end on the isolated
 * test DB, through the real routes.
 *
 * Service: quality {checklist, proofRequired, beforeAfterPhotos}, a 7-day warranty starting at
 * COMPLETION, one mandatory execution step `work`, and one prohibited safety condition.
 * Drive: book → ACCEPTED / paid / PIN → start → evidence → complete.
 *
 * The pre-existing gates keep their route codes by precedence (QUALITY_PROOF_REQUIRED,
 * QUALITY_CHECKLIST_REQUIRED, SAFETY_HOLD_ACTIVE, EXECUTION_GATE_BLOCKED — the D1 / §8 / §9 suites pin
 * them); every refusal now also leaves a verdict row and answers with its id. The verdict's own code
 * (QUALITY_VERDICT_BLOCKED) is what an admin override to a blocking verdict produces.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { bookingQualityService } from "../services/booking-quality.service";
import { bookingCompletionService } from "../services/booking-completion.service";
import { partnerSafetyService } from "../services/partner-safety.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";
import { pngDataUrl } from "./helpers/evidence-photo";

const RUN = `p10s10-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
let hoursAhead = 120;
const CHECKLIST = ["Wipe surfaces", "Mop floor"];

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

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [] as unknown[],
  quality: { checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: true },
  warranty: { enabled: true, durationDays: 7, startEvent: "COMPLETION" },
  execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", sortOrder: 1 }] },
  safety: { prohibitedConditions: ["Gas smell in the room"] },
};

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}
/** A started job (IN_PROGRESS). */
async function started(): Promise<string> {
  const id = await book();
  await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
  return id;
}
async function proof(id: string, stage: "START" | "COMPLETION") {
  const r = await call("POST", `/api/bookings/${id}/evidence`, { stage, latitude: null, longitude: null, mediaUrl: pngDataUrl(`${RUN}-${id}-${stage}`), clientUploadId: `${RUN}-${id}-${stage}` }, partner());
  if (r.status !== 200 && r.status !== 201) throw new Error(`evidence: ${r.status} ${JSON.stringify(r.json)}`);
}
async function doStep(id: string) {
  const s = await call("POST", `/api/bookings/${id}/execution/work/start`, {}, partner());
  if (s.status !== 200) throw new Error(`step start: ${JSON.stringify(s.json)}`);
  const c = await call("POST", `/api/bookings/${id}/execution/work/complete`, {}, partner());
  if (c.status !== 200) throw new Error(`step complete: ${JSON.stringify(c.json)}`);
}
/** Everything the verdict needs: both proof halves and the mandatory step done. */
async function ready(): Promise<string> {
  const id = await started();
  await proof(id, "START");
  await proof(id, "COMPLETION");
  await doStep(id);
  return id;
}
const complete = (id: string, body: Record<string, unknown> = { completedChecklist: CHECKLIST }, token = partner()) =>
  call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude, ...body }, token);
const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
type VRow = { id: number; sequence: number; verdict: string; reason_codes: string[]; actor_type: string; actor_id: string | null; reason: string | null; supersedes_id: number | null; booking_status: string; evidence: any };
const verdicts = async (id: string) =>
  (await prisma.$queryRaw<Array<Omit<VRow, "id" | "supersedes_id"> & { id: bigint; supersedes_id: bigint | null }>>`
    SELECT id, sequence, verdict, reason_codes, actor_type, actor_id, reason, supersedes_id, booking_status, evidence FROM booking_quality_verdicts WHERE booking_id = ${id} ORDER BY sequence`)
    .map((v) => ({ ...v, id: Number(v.id), supersedes_id: v.supersedes_id == null ? null : Number(v.supersedes_id) })) as VRow[];
type CRow = { state: string; verdict_id: bigint | null; requested_at: Date; confirm_by: Date; resolved_at: Date | null; resolved_by_type: string | null; resolved_by_id: string | null; case_id: string | null; version: number };
const completion = async (id: string) => (await prisma.$queryRaw<CRow[]>`SELECT state, verdict_id, requested_at, confirm_by, resolved_at, resolved_by_type, resolved_by_id, case_id, version FROM booking_completions WHERE booking_id = ${id}`)[0] ?? null;
const audit = async (id: string) => prisma.$queryRaw<Array<{ action: string; from_state: string | null; to_state: string; actor_type: string | null; actor_id: string | null }>>`SELECT action, from_state, to_state, actor_type, actor_id FROM booking_completion_audit WHERE booking_id = ${id} ORDER BY id`;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  if (!(await bookingQualityService.enabled()) || !(await bookingCompletionService.enabled())) throw new Error("§10 tables are not deployed on the test database");
  ctx = await seedAdversarialFixtures(RUN);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.partnerSafetyIncident.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("refusals leave a verdict and keep the booking IN_PROGRESS", () => {
  test("the booking freezes the quality policy, the warranty and the plan", async () => {
    if (!dbOk) return;
    const id = await book();
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as any;
    expect(snap.quality).toMatchObject({ checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: true });
    expect(snap.warranty).toMatchObject({ schema: "warranty.v1", enabled: true, durationDays: 7, startEvent: "COMPLETION" });
    expect(snap.execution.steps.map((s: { code: string }) => s.code)).toEqual(["work"]);
    expect(await verdicts(id)).toEqual([]);
    const c = await call("GET", `/api/bookings/${id}/completion`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data).toMatchObject({ enforced: true, bookingStatus: "ACCEPTED", completion: null, verdict: null, warranty: null });
  });

  test("Q1 — a forged checklistComplete:true does not complete; the verdict says which items are missing", async () => {
    if (!dbOk) return;
    const id = await started();
    await proof(id, "START");
    await proof(id, "COMPLETION");
    await doStep(id);
    const r = await complete(id, { checklistComplete: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    const v = await verdicts(id);
    expect(v.length).toBe(1);
    expect(v[0]).toMatchObject({ sequence: 1, verdict: "REWORK_REQUIRED", reason_codes: ["QUALITY_CHECKLIST_REQUIRED"], actor_type: "PARTNER", actor_id: ctx.providerId, booking_status: "IN_PROGRESS" });
    expect(v[0]!.evidence.missingChecklistItems).toEqual(CHECKLIST);
    expect(r.json.data.verdictId).toBe(v[0]!.id);
    // The partner sees the codes and the missing items; the customer sees plain words only.
    const p = await call("GET", `/api/bookings/${id}/quality`, undefined, partner());
    expect(p.json.data.latest).toMatchObject({ verdict: "REWORK_REQUIRED", reasonCodes: ["QUALITY_CHECKLIST_REQUIRED"] });
    expect(p.json.data.history[0].missingChecklistItems).toEqual(CHECKLIST);
    const c = await call("GET", `/api/bookings/${id}/quality`, undefined, customer());
    expect(c.json.data.latest).toEqual({ verdict: "REWORK_REQUIRED", label: "Some of the work still needs to be finished", reasons: ["The service checklist is not finished yet"], at: expect.any(String) });
    expect(JSON.stringify(c.json)).not.toContain("QUALITY_CHECKLIST_REQUIRED");
    // A partial list is still a refusal; the honest full list then completes it.
    expect((await complete(id, { completedChecklist: ["Wipe surfaces"] })).json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    expect((await complete(id)).status).toBe(200);
    expect(await statusOf(id)).toBe("COMPLETED");
    expect((await verdicts(id)).map((x) => x.verdict)).toEqual(["REWORK_REQUIRED", "REWORK_REQUIRED", "PASS"]);
  });

  test("Q2 — the customer and an unrelated partner cannot complete; no verdict is recorded for them", async () => {
    if (!dbOk) return;
    const id = await ready();
    const byCustomer = await complete(id, undefined, customer());
    expect([401, 403]).toContain(byCustomer.status);
    const byStranger = await complete(id, undefined, bearer(ctx.customerB));
    expect([401, 403, 404]).toContain(byStranger.status);
    await expect(bookingService.complete("another-provider-entirely", id, addr.latitude, addr.longitude, undefined, { completedChecklist: CHECKLIST })).rejects.toThrow(/FORBIDDEN|PROVIDER_NOT_FOUND/);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    expect(await verdicts(id)).toEqual([]);
    expect(await completion(id)).toBeNull();
  });

  test("Q3 — a mandatory step not completed: refused by precedence as EXECUTION_GATE_BLOCKED, verdict REWORK_REQUIRED persisted", async () => {
    if (!dbOk) return;
    const id = await started();
    await proof(id, "START");
    await proof(id, "COMPLETION");
    const r = await complete(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("EXECUTION_GATE_BLOCKED");
    expect(r.json.data.blocking).toEqual([expect.objectContaining({ code: "work", reason: "MANDATORY_STEP_INCOMPLETE" })]);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    const v = await verdicts(id);
    expect(v.length).toBe(1);
    expect(v[0]).toMatchObject({ verdict: "REWORK_REQUIRED", actor_type: "PARTNER" });
    expect(v[0]!.reason_codes).toContain("EXECUTION_STEP_INCOMPLETE");
    expect(v[0]!.evidence.steps).toEqual([{ code: "work", state: "PENDING", mandatory: true }]);
    expect(r.json.data).toMatchObject({ verdictId: v[0]!.id, verdict: "REWORK_REQUIRED" });
    expect(await completion(id)).toBeNull();
  });

  test("Q4 — missing proof: REWORK_REQUIRED with QUALITY_PROOF_REQUIRED; the verdict's own code answers once an admin override blocks", async () => {
    if (!dbOk) return;
    const id = await started();
    await doStep(id);
    const r = await complete(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_PROOF_REQUIRED");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    let v = await verdicts(id);
    expect(v.map((x) => [x.verdict, x.reason_codes])).toEqual([["REWORK_REQUIRED", ["QUALITY_PROOF_REQUIRED"]]]);
    expect(r.json.data.verdictId).toBe(v[0]!.id);

    // Proof arrives; an admin nonetheless sends it back for rework. That override is in force until superseded.
    await proof(id, "START");
    await proof(id, "COMPLETION");
    const over = await call("POST", `/api/admin/bookings/${id}/quality/override`, { verdict: "REWORK_REQUIRED", reason: "grout line needs a second pass" }, admin());
    expect(over.status).toBe(200);
    expect(over.json.data.supersedes).toEqual({ id: v[0]!.id, verdict: "REWORK_REQUIRED" });
    const blocked = await complete(id);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("QUALITY_VERDICT_BLOCKED");
    expect(blocked.json.data.verdict).toBe("REWORK_REQUIRED");
    expect(blocked.json.data.reasonCodes[0]).toBe("ADMIN_OVERRIDE");
    expect(blocked.json.data.blocking).toEqual([{ code: "quality:ADMIN_OVERRIDE", reason: "REWORK_REQUIRED" }]);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    v = await verdicts(id);
    expect(v.map((x) => [x.sequence, x.verdict, x.actor_type])).toEqual([[1, "REWORK_REQUIRED", "PARTNER"], [2, "REWORK_REQUIRED", "ADMIN"], [3, "REWORK_REQUIRED", "PARTNER"]]);
    expect(blocked.json.data.verdictId).toBe(v[2]!.id);
    expect(v[1]).toMatchObject({ reason: "grout line needs a second pass", supersedes_id: v[0]!.id, actor_id: ctx.superAdmin.id });

    const lifted = await call("POST", `/api/admin/bookings/${id}/quality/override`, { verdict: "PASS", reason: "second pass verified on site" }, admin());
    expect(lifted.status).toBe(200);
    expect(lifted.json.data.supersedes.id).toBe(v[2]!.id);
    expect((await complete(id)).status).toBe(200);
    expect(await statusOf(id)).toBe("COMPLETED");
    v = await verdicts(id);
    expect(v.map((x) => [x.sequence, x.verdict, x.actor_type])).toEqual([[1, "REWORK_REQUIRED", "PARTNER"], [2, "REWORK_REQUIRED", "ADMIN"], [3, "REWORK_REQUIRED", "PARTNER"], [4, "PASS", "ADMIN"], [5, "PASS", "PARTNER"]]);
    expect((await completion(id))?.verdict_id).toBe(BigInt(v[4]!.id));
  });

  test("Q5 — an active safety hold: ESCALATED, refused as SAFETY_HOLD_ACTIVE by precedence, still IN_PROGRESS", async () => {
    if (!dbOk) return;
    const id = await ready();
    const raised = await call("POST", `/api/bookings/${id}/safety/prohibited-condition`, { condition: "Gas smell in the room", note: "near the stove" }, partner());
    expect(raised.status).toBe(200);
    const r = await complete(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SAFETY_HOLD_ACTIVE");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    const v = await verdicts(id);
    expect(v.length).toBe(1);
    expect(v[0]!.verdict).toBe("ESCALATED");
    expect(v[0]!.reason_codes).toContain("SAFETY_HOLD_ACTIVE");
    expect(v[0]!.evidence.holdIds.length).toBe(1);
    expect(r.json.data).toMatchObject({ verdictId: v[0]!.id, verdict: "ESCALATED" });
    const c = await call("GET", `/api/bookings/${id}/quality`, undefined, customer());
    expect(c.json.data.latest.label).toBe("Our team is reviewing this job");
    expect(c.json.data.latest.reasons).toEqual(["Work is paused for safety"]);
    expect(JSON.stringify(c.json)).not.toContain("near the stove");
    // Released hold + resolved incident: the next attempt passes.
    const [{ id: holdId }] = await prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM booking_safety_holds WHERE booking_id = ${id}`;
    expect((await call("POST", `/api/admin/bookings/${id}/safety/holds/${holdId}/release`, { reason: "gas board confirmed no leak" }, admin())).status).toBe(200);
    const inc = await prisma.partnerSafetyIncident.findFirstOrThrow({ where: { bookingId: id } });
    await partnerSafetyService.resolve(inc.id, ctx.superAdmin.id, "verified safe");
    expect((await complete(id)).status).toBe(200);
    expect((await verdicts(id)).map((x) => x.verdict)).toEqual(["ESCALATED", "PASS"]);
  });
});

describe.serial("happy path — COMPLETED, PASS, a confirmation window, a warranty, an untouched snapshot", () => {
  let id = "";
  let completedAt: Date;
  test("completion is one transaction: status, verdict PASS, booking_completions PENDING_CUSTOMER (confirm_by = completedAt + 48h), booking_warranties ACTIVE", async () => {
    if (!dbOk) return;
    id = await ready();
    const before = JSON.stringify((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot);
    const r = await complete(id);
    expect(r.status).toBe(200);
    expect(r.json.data.booking.status).toBe("completed");
    const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, completedAt: true, serviceConfigSnapshot: true } });
    expect(b.status).toBe("COMPLETED");
    completedAt = b.completedAt!;
    // §13: the historical snapshot is never rewritten (no legacy `warranty` patch once the table exists).
    expect(JSON.stringify(b.serviceConfigSnapshot)).toBe(before);
    const v = await verdicts(id);
    expect(v.map((x) => [x.verdict, x.reason_codes, x.actor_type])).toEqual([["PASS", [], "PARTNER"]]);
    expect(v[0]!.evidence.evidenceIds.length).toBe(2);
    const c = (await completion(id))!;
    expect(c.state).toBe("PENDING_CUSTOMER");
    expect(Number(c.verdict_id)).toBe(v[0]!.id);
    expect(Math.abs(c.confirm_by.getTime() - (completedAt.getTime() + 48 * 3_600_000))).toBeLessThan(1000);
    expect(Math.abs(c.requested_at.getTime() - completedAt.getTime())).toBeLessThan(1000);
    expect(c.resolved_at).toBeNull();
    const [w] = await prisma.$queryRaw<Array<{ state: string; starts_at: Date; expires_at: Date; policy: any }>>`SELECT state, starts_at, expires_at, policy FROM booking_warranties WHERE booking_id = ${id}`;
    expect(w).toBeDefined();
    expect(w!.state).toBe("ACTIVE");
    expect(Math.abs(w!.starts_at.getTime() - completedAt.getTime())).toBeLessThan(1000);
    expect(Math.abs(w!.expires_at.getTime() - (completedAt.getTime() + 7 * 86_400_000))).toBeLessThan(1000);
    expect(w!.policy).toMatchObject({ schema: "warranty.v1", durationDays: 7 });
    expect(await audit(id)).toEqual([{ action: "REQUESTED", from_state: null, to_state: "PENDING_CUSTOMER", actor_type: "partner", actor_id: ctx.providerId }]);
    expect(await prisma.earning.count({ where: { bookingId: id } })).toBe(1);
  });

  test("the customer's inbox holds ONE completion message, and it asks for confirmation", async () => {
    if (!dbOk) return;
    // `service_started` (from START) is the only other message on this booking; completion writes ONE.
    const rows = await prisma.notification.findMany({ where: { userId: ctx.customerA.id, referenceId: id, type: { not: "service_started" } }, select: { type: true, message: true } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.type).toBe("booking_completed");
    expect(rows[0]!.message).toContain("within 48 hours");
  });

  test("the customer view shows canConfirm; the partner and a stranger cannot confirm", async () => {
    if (!dbOk) return;
    const c = await call("GET", `/api/bookings/${id}/completion`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data).toMatchObject({ enforced: true, bookingStatus: "COMPLETED", completion: { state: "PENDING_CUSTOMER", canConfirm: true }, verdict: { verdict: "PASS", label: "Service completed to standard", reasons: [] }, warranty: { state: "ACTIVE" } });
    expect((await call("GET", `/api/bookings/${id}/completion`, undefined, bearer(ctx.customerB))).status).toBe(404);
    expect((await call("POST", `/api/bookings/${id}/confirm-completion`, {}, partner())).status).toBe(404);
    expect((await call("POST", `/api/bookings/${id}/confirm-completion`, {}, bearer(ctx.customerB))).status).toBe(404);
    expect((await call("POST", `/api/bookings/${id}/confirm-completion`, {}, null)).status).toBe(401);
    expect((await completion(id))!.state).toBe("PENDING_CUSTOMER");
  });

  test("the customer confirms (200); a replay is 200 with the same state and writes nothing new", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/bookings/${id}/confirm-completion`, {}, customer());
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ changed: true, completion: { state: "CONFIRMED", resolvedByType: "CUSTOMER", resolvedById: ctx.customerA.id, version: 2 } });
    const again = await call("POST", `/api/bookings/${id}/confirm-completion`, {}, customer());
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ changed: false, completion: { state: "CONFIRMED", version: 2 } });
    expect(await audit(id)).toEqual([
      { action: "REQUESTED", from_state: null, to_state: "PENDING_CUSTOMER", actor_type: "partner", actor_id: ctx.providerId },
      { action: "CONFIRMED", from_state: "PENDING_CUSTOMER", to_state: "CONFIRMED", actor_type: "customer", actor_id: ctx.customerA.id },
    ]);
    expect(await statusOf(id)).toBe("COMPLETED");
    const [ev] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM event_outbox WHERE event_type = 'homigo.booking.completion_confirmed' AND aggregate_id = ${id}`.catch(() => [{ n: -1 }]);
    if (ev && ev.n >= 0) expect(ev.n).toBe(1);
  });

  test("an admin override on a completed booking needs a reason of 3+ characters and supersedes the latest; history is never edited", async () => {
    if (!dbOk) return;
    const path = `/api/admin/bookings/${id}/quality/override`;
    expect((await call("POST", path, { verdict: "FAILED", reason: "x" }, admin())).status).toBe(400);
    expect((await call("POST", path, { verdict: "FAILED", reason: "not to standard" }, partner())).status).toBe(403);
    expect((await call("POST", path, { verdict: "FAILED", reason: "not to standard" }, customer())).status).toBe(403);
    // Defence in depth: the service refuses a blank reason and an unknown verdict on its own.
    expect(await bookingQualityService.adminOverride(id, ctx.superAdmin.id, { verdict: "FAILED", reason: "  x " })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    const bad = await call("POST", path, { verdict: "MAYBE", reason: "not a verdict" }, admin());
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INVALID_VERDICT");
    const before = await verdicts(id);
    const ok = await call("POST", path, { verdict: "FAILED", reason: "customer photos show the floor was not mopped" }, admin());
    expect(ok.status).toBe(200);
    expect(ok.json.data.supersedes).toEqual({ id: before[0]!.id, verdict: "PASS" });
    const after = await verdicts(id);
    expect(after.length).toBe(2);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toMatchObject({ sequence: 2, verdict: "FAILED", reason_codes: ["ADMIN_OVERRIDE"], actor_type: "ADMIN", actor_id: ctx.superAdmin.id, supersedes_id: before[0]!.id, booking_status: "COMPLETED" });
    // The canonical status does not move; the customer sees plain words and never who overrode.
    expect(await statusOf(id)).toBe("COMPLETED");
    const c = await call("GET", `/api/bookings/${id}/quality`, undefined, customer());
    expect(c.json.data.latest).toMatchObject({ verdict: "FAILED", reasons: ["Reviewed by our team"] });
    expect(JSON.stringify(c.json)).not.toContain(ctx.superAdmin.id);
    expect(JSON.stringify(c.json)).not.toContain("not mopped");
    const view = await call("GET", `/api/admin/bookings/${id}/quality`, undefined, admin());
    expect(view.status).toBe(200);
    expect(view.json.data.history.map((h: { sequence: number; verdict: string }) => [h.sequence, h.verdict])).toEqual([[1, "PASS"], [2, "FAILED"]]);
    expect(view.json.data.completion.state).toBe("CONFIRMED");
    expect(view.json.data.audit.map((a: { action: string }) => a.action)).toEqual(["REQUESTED", "CONFIRMED"]);
    expect(view.json.data.warranty.state).toBe("ACTIVE");
    expect((await call("POST", `/api/admin/bookings/no-such-booking/quality/override`, { verdict: "PASS", reason: "nothing here" }, admin())).status).toBe(404);
  });

  test("below the application: verdicts are append-only, a resolved completion cannot be reopened, the audit is immutable", async () => {
    if (!dbOk) return;
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_quality_verdicts SET verdict = 'PASS' WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
    await expect(Promise.resolve(prisma.$executeRaw`DELETE FROM booking_quality_verdicts WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_completions SET state = 'PENDING_CUSTOMER', resolved_at = NULL, resolved_by_type = NULL, resolved_by_id = NULL WHERE booking_id = ${id}`)).rejects.toThrow(/cannot change state/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_completions SET state = 'AUTO_CONFIRMED' WHERE booking_id = ${id}`)).rejects.toThrow(/cannot change state/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_completion_audit SET to_state = 'X' WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
    await expect(Promise.resolve(prisma.$executeRaw`DELETE FROM booking_completion_audit WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
    // An override without a reason or without a superseded verdict is refused by the table itself.
    await expect(Promise.resolve(prisma.$executeRaw`INSERT INTO booking_quality_verdicts (booking_id, sequence, verdict, actor_type, booking_status) VALUES (${id}, 99, 'PASS', 'ADMIN', 'COMPLETED')`)).rejects.toThrow(/override_check/);
    expect((await verdicts(id)).length).toBe(2);
  });

  test("a booking with no verdict yet has nothing to supersede; a booking not being worked on cannot be overridden", async () => {
    if (!dbOk) return;
    const fresh = await started();
    const none = await call("POST", `/api/admin/bookings/${fresh}/quality/override`, { verdict: "PASS", reason: "nothing to override" }, admin());
    expect(none.status).toBe(409);
    expect(none.json.code).toBe("NOTHING_TO_SUPERSEDE");
    const pending = await book();
    const wrong = await call("POST", `/api/admin/bookings/${pending}/quality/override`, { verdict: "PASS", reason: "not started" }, admin());
    expect(wrong.status).toBe(409);
    expect(wrong.json.code).toBe("INVALID_STATUS");
  });
});

describe.serial("auto-confirmation and concurrency", () => {
  test("autoConfirmDue: a pending completion past confirm_by becomes AUTO_CONFIRMED by SYSTEM; the customer can no longer confirm", async () => {
    if (!dbOk) return;
    const id = await ready();
    expect((await complete(id)).status).toBe(200);
    expect((await completion(id))!.state).toBe("PENDING_CUSTOMER");
    // Nothing is due yet: the sweep touches nothing.
    const early = await bookingCompletionService.autoConfirmDue();
    expect(early.bookingIds).not.toContain(id);
    await prisma.$executeRaw`UPDATE booking_completions SET confirm_by = now() - interval '1 hour' WHERE booking_id = ${id}`;
    const swept = await bookingCompletionService.autoConfirmDue();
    expect(swept.bookingIds).toContain(id);
    const c = (await completion(id))!;
    expect(c).toMatchObject({ state: "AUTO_CONFIRMED", resolved_by_type: "SYSTEM", resolved_by_id: null, version: 2 });
    expect(c.resolved_at).not.toBeNull();
    const a = await audit(id);
    expect(a[1]).toEqual({ action: "AUTO_CONFIRMED", from_state: "PENDING_CUSTOMER", to_state: "AUTO_CONFIRMED", actor_type: "system", actor_id: "completion-auto-confirm" });
    const msgs = await prisma.notification.findMany({ where: { userId: ctx.customerA.id, referenceId: id, type: { not: "service_started" } }, select: { type: true } });
    expect(msgs.map((m) => m.type).sort()).toEqual(["booking_completed", "booking_completion_auto_confirmed"]);
    const late = await call("POST", `/api/bookings/${id}/confirm-completion`, {}, customer());
    expect(late.status).toBe(409);
    expect(late.json.code).toBe("COMPLETION_ALREADY_RESOLVED");
    expect(late.json.data.state).toBe("AUTO_CONFIRMED");
    // A second sweep finds nothing for this booking; the row is history.
    expect((await bookingCompletionService.autoConfirmDue()).bookingIds).not.toContain(id);
    expect(await statusOf(id)).toBe("COMPLETED");
  });

  test("GF14 — two concurrent completes: one earning, one verdict PASS, one completion row, newlyCompleted true exactly once", async () => {
    if (!dbOk) return;
    const id = await ready();
    const before = JSON.stringify((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot);
    const racers = [0, 1].map(() => bookingService.complete(ctx.providerId, id, addr.latitude, addr.longitude, undefined, { completedChecklist: CHECKLIST }));
    const out = await Promise.all(racers);
    expect(out.map((o) => o.newlyCompleted).sort()).toEqual([false, true]);
    expect(out.every((o) => o.booking.status === "COMPLETED")).toBe(true);
    expect(out[0]!.booking.completedAt?.getTime()).toBe(out[1]!.booking.completedAt?.getTime());
    expect(await prisma.earning.count({ where: { bookingId: id } })).toBe(1);
    const v = await verdicts(id);
    expect(v.map((x) => x.verdict)).toEqual(["PASS"]);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_completions WHERE booking_id = ${id}`;
    expect(n).toBe(1);
    expect((await audit(id)).length).toBe(1);
    expect(JSON.stringify((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot)).toBe(before);
    // The replay through the route after the fact is the same no-op.
    const again = await complete(id);
    expect(again.status).toBe(200);
    expect(await prisma.earning.count({ where: { bookingId: id } })).toBe(1);
    expect((await verdicts(id)).length).toBe(1);
  }, 60_000);
});
