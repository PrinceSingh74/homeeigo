/**
 * Phase 10 §11 — complaint / warranty cases, rework follow-ups and case-scoped refunds, end to end on
 * the isolated test DB through the real routes. A COMPLETED booking is reached by driving the real
 * flow (book → accepted / paid / PIN → start → complete).
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingCaseService } from "../services/booking-case.service";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";
import { assertBookingPaymentReadyForDispatch, isNoPaymentFollowUp, PAYMENT_GATE_REASON } from "../services/booking-payment-gate";
import { nextBookingNumber } from "../lib/booking-number";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `p10s11-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
let hoursAhead = 80;
let seq = 0;

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
const outsider = () => bearer(ctx.customerB);
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
  quality: { complaintWindowDays: 7 },
  warranty: { enabled: true, durationDays: 30, startEvent: "COMPLETION", eligibleIssueTypes: ["QUALITY", "INCOMPLETE"], reworkFirst: true, refundAllowed: true },
  rework: { fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 },
};

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data.booking?.id ?? r.json.data.id;
}

/** A gateway (dev-mock order) payment: the only path that writes a payments row a refund_requests row can point at. */
async function payAtGateway(bookingId: string) {
  const order = (await paymentService.createOrder(ctx.customerA.id, bookingId)) as { razorpayOrderId?: string; error?: string };
  if (!order?.razorpayOrderId) throw new Error(`order: ${JSON.stringify(order)}`);
  const pid = `pay_${RUN}_${++seq}`;
  const v = await paymentService.verify(ctx.customerA.id, { razorpayOrderId: order.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId, pid) } as never);
  if (v && typeof v === "object" && "error" in (v as object)) throw new Error(`verify: ${JSON.stringify(v)}`);
}

/** Drive the real flow to COMPLETED: accepted + paid + PIN verified, then the partner starts and completes. */
async function completedBooking(opts: { gatewayPaid?: boolean } = {}): Promise<string> {
  const id = await book();
  if (opts.gatewayPaid) await payAtGateway(id);
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  const s = await call("POST", `/api/bookings/${id}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
  if (s.status !== 200) throw new Error(`start: ${s.status} ${JSON.stringify(s.json)}`);
  const c = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
  if (c.status !== 200) throw new Error(`complete: ${c.status} ${JSON.stringify(c.json)}`);
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, completedAt: true } });
  if (b.status !== "COMPLETED" || !b.completedAt) throw new Error(`not completed: ${b.status}`);
  return id;
}

const open = (id: string, body: Record<string, unknown> = {}, token = customer()) => call("POST", `/api/bookings/${id}/cases`, { category: "QUALITY", description: "the seats still smell", ...body }, token);
const transition = (caseId: string, to: string, extra: Record<string, unknown> = {}) => call("POST", `/api/admin/cases/${caseId}/transition`, { to, reason: `test: to ${to}`, ...extra }, admin());
const resolve = (caseId: string, body: Record<string, unknown>) => call("POST", `/api/admin/cases/${caseId}/resolve`, { reason: "test decision", ...body }, admin());
const bookingFacts = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, serviceConfigSnapshot: true, totalAmount: true, finalAmount: true, baseAmount: true, totalAmountPaise: true, paymentStatus: true, refundStatus: true, refundAmount: true, completedAt: true } });
const casesFor = (id: string) => prisma.$queryRaw<{ id: string; state: string; type: string }[]>`SELECT id, state, type FROM booking_cases WHERE booking_id = ${id}`;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('booking_cases') IS NOT NULL AS present`;
  if (!present) throw new Error("booking_cases is not deployed on the test DB — run the migration first");
  ctx = await seedAdversarialFixtures(RUN);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  // Follow-ups reference their parent; delete them first so the fixture sweep never trips the FK.
  await prisma.$executeRaw`DELETE FROM bookings WHERE parent_booking_id IN (SELECT id FROM bookings WHERE user_id = ${ctx.customerA.id})`.catch(() => {});
  await prisma.$executeRaw`DELETE FROM refund_requests WHERE case_id IN (SELECT id FROM booking_cases WHERE customer_id = ${ctx.customerA.id})`.catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("§11 cases through the real routes", () => {
  let parentId = "";
  let caseId = "";
  let before: Awaited<ReturnType<typeof bookingFacts>>;

  test("a live booking cannot have a case; once COMPLETED the customer opens a WARRANTY_CLAIM and the completion axis flips to ISSUE_REPORTED", async () => {
    if (!dbOk) return;
    const live = await book();
    const early = await open(live);
    expect(early.status).toBe(409);
    expect(early.json.code).toBe("BOOKING_NOT_COMPLETED");
    expect(await casesFor(live)).toEqual([]);

    parentId = await completedBooking();
    before = await bookingFacts(parentId);
    expect((before.serviceConfigSnapshot as { warranty: { schema: string } }).warranty.schema).toBe("warranty.v1");
    const w = await prisma.$queryRaw<{ state: string }[]>`SELECT state FROM booking_warranties WHERE booking_id = ${parentId}`;
    expect(w).toEqual([{ state: "ACTIVE" }]);
    const [{ state: completionBefore }] = await prisma.$queryRaw<{ state: string }[]>`SELECT state FROM booking_completions WHERE booking_id = ${parentId}`;
    expect(completionBefore).toBe("PENDING_CUSTOMER");

    expect((await open(parentId, { category: "NOPE" })).json.code).toBe("INVALID_CATEGORY");
    const r = await open(parentId, { evidence: [{ kind: "NOTE", note: "smell came back after a day" }] });
    expect(r.status).toBe(201);
    expect(r.json.data.replayed).toBe(false);
    caseId = r.json.data.case.id;
    expect(r.json.data.case).toMatchObject({ type: "WARRANTY_CLAIM", category: "QUALITY", state: "CASE_CREATED", eligibility: { warrantyCovers: true } });
    expect(r.json.data.case.evidence).toHaveLength(1);
    const completion = await prisma.$queryRaw<{ state: string; case_id: string | null }[]>`SELECT state, case_id FROM booking_completions WHERE booking_id = ${parentId}`;
    expect(completion).toEqual([{ state: "ISSUE_REPORTED", case_id: caseId }]);
    const events = await prisma.$queryRaw<{ action: string; actor_type: string }[]>`SELECT action, actor_type FROM booking_case_events WHERE case_id = ${caseId} ORDER BY id`;
    expect(events).toEqual([{ action: "CREATED", actor_type: "CUSTOMER" }]);
    // The same report again is the same case.
    const again = await open(parentId);
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ replayed: true, case: { id: caseId } });
    expect(await casesFor(parentId)).toHaveLength(1);
  });

  test("ownership: an outsider customer gets 404 on open, list and evidence; the assigned partner lists the case without money or admin detail", async () => {
    if (!dbOk) return;
    expect((await open(parentId, {}, outsider())).status).toBe(404);
    expect((await call("GET", `/api/bookings/${parentId}/cases`, undefined, outsider())).status).toBe(404);
    expect((await call("POST", `/api/bookings/${parentId}/cases/${caseId}/evidence`, { evidence: [{ kind: "NOTE", note: "x" }] }, outsider())).status).toBe(404);
    const mine = await call("GET", `/api/bookings/${parentId}/cases`, undefined, customer());
    expect(mine.status).toBe(200);
    expect(mine.json.data.cases.map((c: { id: string }) => c.id)).toEqual([caseId]);
    const p = await call("GET", `/api/bookings/${parentId}/cases`, undefined, partner());
    expect(p.status).toBe(200);
    expect(p.json.data.cases[0]).toMatchObject({ id: caseId, type: "WARRANTY_CLAIM", state: "CASE_CREATED" });
    expect(p.json.data.cases[0].eligibility).toBeUndefined();
    expect(p.json.data.cases[0].timeline).toBeUndefined();
    // A customer cannot read the admin queue.
    expect((await call("GET", "/api/admin/cases", undefined, customer())).status).toBe(403);
    expect((await call("POST", `/api/admin/cases/${caseId}/transition`, { to: "TRIAGE", reason: "nope" }, partner())).status).toBe(403);
  });

  test("evidence: only this booking's job evidence counts; a note is added while the case is open; the customer never sees admin reasons", async () => {
    if (!dbOk) return;
    const foreign = await call("POST", `/api/bookings/${parentId}/cases/${caseId}/evidence`, { evidence: [{ kind: "JOB_EVIDENCE", jobEvidenceId: "not-a-real-evidence-id" }] }, customer());
    expect(foreign.status).toBe(400);
    expect(foreign.json.code).toBe("EVIDENCE_INVALID");
    const badUrl = await call("POST", `/api/bookings/${parentId}/cases/${caseId}/evidence`, { evidence: [{ kind: "CUSTOMER_MEDIA", mediaUrl: "http://insecure/x.jpg" }] }, customer());
    expect(badUrl.json.code).toBe("EVIDENCE_INVALID");
    const ok = await call("POST", `/api/bookings/${parentId}/cases/${caseId}/evidence`, { evidence: [{ kind: "CUSTOMER_MEDIA", mediaUrl: "https://cdn.example.test/after.jpg" }] }, customer());
    expect(ok.status).toBe(200);
    expect(ok.json.data.case.evidence).toHaveLength(2);
    expect((await call("GET", `/api/bookings/${parentId}/cases/nope/evidence`, undefined, customer())).status).toBe(404);
  });

  test("the customer is told whether an issue can be reported, and a photo attached to their case is private to the case's parties", async () => {
    if (!dbOk) return;
    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a2e5b5a00000000049454e44ae426082",
      "hex",
    );
    const upload = async (bookingId: string, id: string, bytes: Buffer, token: string) => {
      const form = new FormData();
      form.append("file", new File([bytes], "photo", { type: "image/png" }));
      const res = await app.handle(new Request(`http://localhost/api/bookings/${bookingId}/cases/${id}/evidence/photo`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }));
      return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };
    const media = (path: string, token: string) => app.handle(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }));

    // A completed booking with no case yet: reporting is open. The partner view carries no such block.
    const bookingId = await completedBooking();
    const fresh = await call("GET", `/api/bookings/${bookingId}/cases`, undefined, customer());
    expect(fresh.json.data.report).toEqual({ canReport: true, reason: null, openCaseId: null });
    expect((await call("GET", `/api/bookings/${bookingId}/cases`, undefined, partner())).json.data.report).toBeUndefined();
    const opened = await open(bookingId);
    expect(opened.status).toBe(201);
    const id: string = opened.json.data.case.id;
    // With a case open a second cannot be opened; the customer is pointed at the open one.
    expect((await call("GET", `/api/bookings/${bookingId}/cases`, undefined, customer())).json.data.report).toEqual({ canReport: false, reason: null, openCaseId: id });

    // The bytes decide the type, and only the case's own customer may attach.
    expect(await upload(bookingId, id, Buffer.from("<html><script>alert(1)</script></html>"), customer())).toMatchObject({ status: 400, json: { code: "VALIDATION_ERROR" } });
    expect((await upload(bookingId, id, PNG, outsider())).status).toBe(404);
    expect((await upload(bookingId, id, PNG, partner())).status).toBe(404);
    const ok = await upload(bookingId, id, PNG, customer());
    expect(ok.status).toBe(201);
    const photo = ok.json.data.case.evidence.at(-1);
    expect(photo).toMatchObject({ kind: "CUSTOMER_MEDIA", hasStoredMedia: true, mediaUrl: null });
    expect(photo.mediaStorageKey).toBeUndefined();
    const [stored] = await prisma.$queryRaw<{ media_storage_key: string }[]>`SELECT media_storage_key FROM booking_case_evidence WHERE id = ${photo.id}`;
    expect(stored.media_storage_key.startsWith(`${id}/`)).toBe(true);

    try {
      // Customer, assigned partner and admin can read it; an outsider cannot, and a customer cannot use the admin route.
      const mine = await media(`/api/bookings/${bookingId}/cases/${id}/evidence/${photo.id}/media`, customer());
      expect(mine.status).toBe(200);
      expect(mine.headers.get("content-type")).toBe("image/png");
      expect(mine.headers.get("cache-control")).toContain("private");
      expect(Buffer.from(await mine.arrayBuffer()).equals(PNG)).toBe(true);
      expect((await media(`/api/bookings/${bookingId}/cases/${id}/evidence/${photo.id}/media`, partner())).status).toBe(200);
      expect((await media(`/api/admin/cases/${id}/evidence/${photo.id}/media`, admin())).status).toBe(200);
      expect((await media(`/api/bookings/${bookingId}/cases/${id}/evidence/${photo.id}/media`, outsider())).status).toBe(404);
      expect((await media(`/api/admin/cases/${id}/evidence/${photo.id}/media`, customer())).status).toBe(403);
      // The photo belongs to this case only: another case id in the path does not serve it.
      expect((await media(`/api/bookings/${parentId}/cases/${caseId}/evidence/${photo.id}/media`, customer())).status).toBe(404);

      // A storage key a client supplied is recorded but never read back: it cannot be used to fetch another object.
      const forged = await call("POST", `/api/bookings/${bookingId}/cases/${id}/evidence`, { evidence: [{ kind: "CUSTOMER_MEDIA", mediaStorageKey: stored.media_storage_key.replace(`${id}/`, `${caseId}/`) }] }, customer());
      expect(forged.status).toBe(200);
      const forgedItem = forged.json.data.case.evidence.at(-1);
      expect((await media(`/api/bookings/${bookingId}/cases/${id}/evidence/${forgedItem.id}/media`, customer())).status).toBe(404);
      expect((await media(`/api/admin/cases/${id}/evidence/${forgedItem.id}/media`, admin())).status).toBe(404);
    } finally {
      const { objectStorageService } = await import("../services/object-storage.service");
      await objectStorageService.deleteObject("case-evidence", stored.media_storage_key).catch(() => undefined);
    }
  });

  // Adversarial audit, 2026-10-07: any JOB_EVIDENCE or CUSTOMER_MEDIA row was "proof" — a position
  // stamp with no photo, a pasted https link, a key typed by the client.
  test("proof for a case is a photo the server stored: a link, a typed key and a photo-less job row are claims; an uploaded photo counts", async () => {
    if (!dbOk) return;
    const bookingId = await completedBooking();
    const stamp = await prisma.jobEvidence.findFirstOrThrow({ where: { bookingId, mediaStorageKey: null }, select: { id: true } });
    // Opening a case with a link and a photo-less job row still works: they are recorded and shown.
    const opened = await open(bookingId, { evidence: [{ kind: "CUSTOMER_MEDIA", mediaUrl: "https://cdn.example.test/after.jpg" }, { kind: "JOB_EVIDENCE", jobEvidenceId: stamp.id }] });
    expect(opened.status).toBe(201);
    const id: string = opened.json.data.case.id;
    expect(opened.json.data.case.evidence).toHaveLength(2);
    expect(opened.json.data.case.evidence[0]).toMatchObject({ kind: "CUSTOMER_MEDIA", mediaUrl: "https://cdn.example.test/after.jpg", hasStoredMedia: false });

    // This case's warranty asks for proof (set on the case's own frozen policy; the suite's service does not).
    await prisma.$executeRaw`UPDATE booking_cases SET warranty_snapshot = jsonb_set(warranty_snapshot, '{proofRequired}', 'true'::jsonb) WHERE id = ${id}`;
    const proofMissing = async () => (await call("GET", `/api/admin/cases/${id}`, undefined, admin())).json.data.eligibilityNow.proofMissing;
    expect(await proofMissing()).toBe(true);

    // A key of exactly the shape the server writes for this case, typed by the client: no such object.
    const typed = await call("POST", `/api/bookings/${bookingId}/cases/${id}/evidence`, { evidence: [{ kind: "CUSTOMER_MEDIA", mediaStorageKey: `${id}/0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d.png` }] }, customer());
    expect(typed.status).toBe(200);
    expect(await proofMissing()).toBe(true);

    // The photo itself, uploaded to the case.
    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a2e5b5a00000000049454e44ae426082",
      "hex",
    );
    const form = new FormData();
    form.append("file", new File([PNG], "photo", { type: "image/png" }));
    const up = await app.handle(new Request(`http://localhost/api/bookings/${bookingId}/cases/${id}/evidence/photo`, { method: "POST", headers: { Authorization: `Bearer ${customer()}` }, body: form }));
    expect(up.status).toBe(201);
    try {
      expect(await proofMissing()).toBe(false);
    } finally {
      const [stored] = await prisma.$queryRaw<{ media_storage_key: string }[]>`SELECT media_storage_key FROM booking_case_evidence WHERE case_id = ${id} AND media_storage_key LIKE ${id + "/%"} ORDER BY id DESC LIMIT 1`;
      const { objectStorageService } = await import("../services/object-storage.service");
      if (stored) await objectStorageService.deleteObject("case-evidence", stored.media_storage_key).catch(() => undefined);
    }
  });

  test("admin transitions follow the map with CAS: CASE_CREATED→ACTION 409, →TRIAGE ok, stale version 409, blank reason 400, unknown state 400", async () => {
    if (!dbOk) return;
    const forbidden = await transition(caseId, "ACTION");
    expect(forbidden.status).toBe(409);
    expect(forbidden.json.code).toBe("CASE_TRANSITION_FORBIDDEN");
    expect((await transition(caseId, "BOGUS")).status).toBe(400);
    const blank = await transition(caseId, "TRIAGE", { reason: " " });
    expect(blank.status).toBe(400);
    expect(blank.json.code).toBe("REASON_REQUIRED");
    const detail = await call("GET", `/api/admin/cases/${caseId}`, undefined, admin());
    expect(detail.status).toBe(200);
    const version: number = detail.json.data.case.version;
    expect(detail.json.data.eligibilityNow.allowedActions).toEqual(["REWORK", "INSPECTION", "REJECT", "REFUND"]);
    const ok = await transition(caseId, "TRIAGE", { expectedVersion: version, reason: "ADMIN-ONLY-NOTE-7f3a" });
    expect(ok.status).toBe(200);
    expect(ok.json.data.case.state).toBe("TRIAGE");
    expect(ok.json.data.case.version).toBe(version + 1);
    const stale = await transition(caseId, "INVESTIGATION", { expectedVersion: version });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("CASE_VERSION_CONFLICT");
    // Neither the customer nor the partner sees the admin's reason.
    const c = await call("GET", `/api/bookings/${parentId}/cases`, undefined, customer());
    expect(JSON.stringify(c.json)).not.toContain("ADMIN-ONLY-NOTE-7f3a");
    expect(c.json.data.cases[0].timeline.map((t: { state: string }) => t.state)).toEqual(["CASE_CREATED", "TRIAGE"]);
    const p = await call("GET", `/api/bookings/${parentId}/cases`, undefined, partner());
    expect(JSON.stringify(p.json)).not.toContain("ADMIN-ONLY-NOTE-7f3a");
    const q = await call("GET", `/api/admin/cases?bookingId=${parentId}&state=TRIAGE`, undefined, admin());
    expect(q.json.data.cases.map((x: { id: string }) => x.id)).toEqual([caseId]);
    expect((await call("GET", "/api/admin/cases?state=NOPE", undefined, admin())).status).toBe(400);
  });

  test("Q8: two concurrent REWORK resolves create exactly one follow-up booking — zero amount, no payment row, parent's frozen plan, dispatch gate satisfied", async () => {
    if (!dbOk) return;
    hoursAhead += 24;
    const scheduledDate = futureSlot(hoursAhead).toISOString();
    expect((await resolve(caseId, { action: "REWORK" })).json.code).toBe("SCHEDULE_INVALID");
    expect((await resolve(caseId, { action: "BOGUS", scheduledDate })).status).toBe(400);
    const [a, b] = await Promise.all([resolve(caseId, { action: "REWORK", scheduledDate }), resolve(caseId, { action: "REWORK", scheduledDate })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.json.data.resolution.followUpBookingId).toBe(b.json.data.resolution.followUpBookingId);
    expect([a.json.data.replayed, b.json.data.replayed].filter(Boolean)).toHaveLength(1);
    const followUps = await prisma.$queryRaw<{ id: string; booking_kind: string; parent_booking_id: string; case_id: string; total_amount: number; final_amount: number; status: string }[]>`
      SELECT id, booking_kind, parent_booking_id, case_id, total_amount, final_amount, status FROM bookings WHERE case_id = ${caseId}`;
    expect(followUps).toHaveLength(1);
    const fu = followUps[0];
    expect(fu).toMatchObject({ booking_kind: "REWORK", parent_booking_id: parentId, case_id: caseId, total_amount: 0, final_amount: 0 });
    expect(await prisma.payment.findUnique({ where: { bookingId: fu.id } })).toBeNull();
    // Snapshot copied from the parent: execution, safety and warranty keys are the parent's, and the follow-up carries no priced lines.
    const parentSnap = before.serviceConfigSnapshot as Record<string, unknown>;
    const fuSnap = (await prisma.booking.findUniqueOrThrow({ where: { id: fu.id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as Record<string, unknown>;
    for (const k of ["execution", "safety", "warranty", "requirements", "quality"]) expect(fuSnap[k]).toEqual(parentSnap[k]);
    expect(fuSnap.followUp).toMatchObject({ kind: "REWORK", parentBookingId: parentId, caseId });
    expect(fuSnap.pricing).toMatchObject({ version: "follow-up.v1", finalAmountPaise: 0, lines: [], fee: "WAIVED" });
    // Dispatch gate: a waived-fee follow-up is settled with no payment; a STANDARD zero-amount booking is not.
    expect(await isNoPaymentFollowUp(fu.id)).toBe(true);
    expect(await assertBookingPaymentReadyForDispatch(fu.id)).toMatchObject({ allowed: true, reason: PAYMENT_GATE_REASON.NO_PAYMENT_REQUIRED });
    hoursAhead += 24;
    const standard = await prisma.booking.create({
      data: { bookingNumber: await nextBookingNumber(), userId: ctx.customerA.id, serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(hoursAhead), baseAmount: 0, finalAmount: 0, totalAmount: 0, taxes: 0 },
      select: { id: true },
    });
    expect(await isNoPaymentFollowUp(standard.id)).toBe(false);
    expect(await assertBookingPaymentReadyForDispatch(standard.id)).toMatchObject({ allowed: false, reason: PAYMENT_GATE_REASON.NOT_SETTLED });
    // The case is RESOLVED with the follow-up recorded; the original booking is untouched.
    const [c] = await casesFor(parentId);
    expect(c.state).toBe("RESOLVED");
    const after = await bookingFacts(parentId);
    expect(after).toEqual(before);
    const cust = await call("GET", `/api/bookings/${parentId}/cases`, undefined, customer());
    expect(cust.json.data.cases[0].resolution).toMatchObject({ action: "REWORK", followUpBookingId: fu.id });
    // Asking the same decision again is answered, never redone; a different decision on a closed case is refused.
    const replay = await resolve(caseId, { action: "REWORK", scheduledDate });
    expect(replay.status).toBe(200);
    expect(replay.json.data.replayed).toBe(true);
    const other = await resolve(caseId, { action: "REFUND", refundPaise: 100 });
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("CASE_CLOSED");
    expect((await transition(caseId, "ESCALATED")).json.code).toBe("CASE_CLOSED");
    expect(await prisma.$queryRaw`SELECT 1 FROM bookings WHERE case_id = ${caseId}`).toHaveLength(1);
  });

  test("X-50: the partner can work the waived-fee follow-up — /actions applies the server's payment exemption, and the booking list marks it as a rework of the parent", async () => {
    if (!dbOk) return;
    const [fu] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE case_id = ${caseId}`;
    const parent = await prisma.booking.findUniqueOrThrow({ where: { id: parentId }, select: { bookingNumber: true } });
    // Test setup only: the assignment itself is covered by the dispatch suites.
    await prisma.booking.update({ where: { id: fu.id }, data: { providerId: ctx.providerId, status: "ACCEPTED" } });
    const acts = await call("GET", `/api/bookings/${fu.id}/actions`, undefined, partner());
    expect(acts.status).toBe(200);
    expect(acts.json.data.availableActions).toContain("START_NAVIGATION");
    expect(acts.json.data.disabledReasons.START_NAVIGATION).toBeUndefined();
    expect(acts.json.data.requiredGates).not.toContain("PAYMENT_SETTLED");
    const list = await call("GET", `/api/providers/me/bookings?limit=100`, undefined, partner());
    const row = (list.json.data.bookings as Array<{ id: string; followUp: unknown; paymentExempt: boolean }>).find((b) => b.id === fu.id);
    expect(row?.followUp).toEqual({ kind: "REWORK", parentBookingNumber: parent.bookingNumber, caseNumber: expect.any(String) });
    expect(row?.paymentExempt).toBe(true);
    expect(acts.json.data.paymentExempt).toBe(true);
    // The job screen prefers the detail row (found on the device: the card vanished when only the list had it).
    const detail = await call("GET", `/api/bookings/${fu.id}`, undefined, partner());
    expect(detail.status).toBe(200);
    expect(detail.json.data.booking.followUp).toEqual({ kind: "REWORK", parentBookingNumber: parent.bookingNumber, caseNumber: expect.any(String) });
    expect(detail.json.data.booking.paymentExempt).toBe(true);
    // Control: an ordinary unpaid booking held by the same partner still waits for its money.
    hoursAhead += 24;
    const unpaid = await prisma.booking.create({
      data: { bookingNumber: await nextBookingNumber(), userId: ctx.customerA.id, serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(hoursAhead), baseAmount: 0, finalAmount: 0, totalAmount: 0, taxes: 0, providerId: ctx.providerId, status: "ACCEPTED" },
      select: { id: true },
    });
    const control = await call("GET", `/api/bookings/${unpaid.id}/actions`, undefined, partner());
    expect(control.json.data.disabledReasons.START_NAVIGATION).toBe("Payment confirmation pending");
    expect(control.json.data.requiredGates).toContain("PAYMENT_SETTLED");
    const controlRow = ((await call("GET", `/api/providers/me/bookings?limit=100`, undefined, partner())).json.data.bookings as Array<{ id: string; followUp: unknown; paymentExempt: boolean }>).find((b) => b.id === unpaid.id);
    expect(controlRow?.followUp).toBeNull();
    expect(controlRow?.paymentExempt).toBe(false);
    expect(control.json.data.paymentExempt).toBe(false);
    const controlDetail = await call("GET", `/api/bookings/${unpaid.id}`, undefined, partner());
    expect(controlDetail.json.data.booking.followUp).toBeNull();
    expect(controlDetail.json.data.booking.paymentExempt).toBe(false);
  });

  test("the database refuses UPDATE on a RESOLVED case and any UPDATE / DELETE of case events and evidence", async () => {
    if (!dbOk) return;
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_cases SET description = 'tampered' WHERE id = ${caseId}`)).rejects.toThrow(/immutable/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_case_events SET reason = 'tampered' WHERE case_id = ${caseId}`)).rejects.toThrow(/append-only/);
    await expect(Promise.resolve(prisma.$executeRaw`DELETE FROM booking_case_events WHERE case_id = ${caseId}`)).rejects.toThrow(/append-only/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_case_evidence SET note = 'tampered' WHERE case_id = ${caseId}`)).rejects.toThrow(/append-only/);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM booking_case_events WHERE case_id = ${caseId}`;
    expect(Number(n)).toBeGreaterThanOrEqual(3);
  });

  test("Q7: ten concurrent opens on one booking create exactly one case; the rest are replays of it", async () => {
    if (!dbOk) return;
    const id = await completedBooking();
    const results = await Promise.all(Array.from({ length: 10 }, () => open(id)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.json.data.case.id)).size).toBe(1);
    expect(await casesFor(id)).toHaveLength(1);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM booking_case_events WHERE case_id = ${results[0].json.data.case.id} AND action = 'CREATED'`;
    expect(Number(n)).toBe(1);
    const completion = await prisma.$queryRaw<{ state: string }[]>`SELECT state FROM booking_completions WHERE booking_id = ${id}`;
    expect(completion).toEqual([{ state: "ISSUE_REPORTED" }]);
  });

  test("Q6: an expired warranty yields a COMPLAINT with no REFUND / REWORK; REFUND without an override is 409 and moves no money; REJECT closes it", async () => {
    if (!dbOk) return;
    const id = await completedBooking();
    await prisma.$executeRaw`UPDATE booking_warranties SET starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE booking_id = ${id}`;
    const swept = await bookingCaseService.expireWarranties();
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(await prisma.$queryRaw`SELECT 1 FROM booking_warranties WHERE booking_id = ${id} AND state = 'EXPIRED'`).toHaveLength(1);
    const r = await open(id);
    expect(r.status).toBe(201);
    expect(r.json.data.case).toMatchObject({ type: "COMPLAINT", eligibility: { warrantyCovers: false } });
    expect(r.json.data.case.eligibility.reasonCodes).toContain("WARRANTY_EXPIRED");
    const cid: string = r.json.data.case.id;
    const detail = await call("GET", `/api/admin/cases/${cid}`, undefined, admin());
    expect(detail.json.data.eligibilityNow.allowedActions).toEqual(["INSPECTION", "REJECT"]);
    expect(detail.json.data.warranty.state).toBe("EXPIRED");
    // Not triaged yet: no decision at all.
    expect((await resolve(cid, { action: "REFUND", refundPaise: 100 })).json.code).toBe("CASE_NOT_TRIAGED");
    expect((await transition(cid, "TRIAGE")).status).toBe(200);
    const refund = await resolve(cid, { action: "REFUND", refundPaise: 100 });
    expect(refund.status).toBe(409);
    expect(refund.json.code).toBe("ACTION_NOT_ALLOWED");
    expect(refund.json.details.allowedActions).toEqual(["INSPECTION", "REJECT", "NONE"]);
    const rework = await resolve(cid, { action: "REWORK", scheduledDate: futureSlot(hoursAhead + 48).toISOString() });
    expect(rework.json.code).toBe("ACTION_NOT_ALLOWED");
    expect(await prisma.$queryRaw`SELECT 1 FROM refund_requests WHERE case_id = ${cid}`).toHaveLength(0);
    expect(await prisma.$queryRaw`SELECT 1 FROM bookings WHERE case_id = ${cid}`).toHaveLength(0);
    expect((await casesFor(id))[0].state).toBe("TRIAGE");
    expect((await bookingFacts(id)).refundStatus).toBeNull();
    const rejected = await resolve(cid, { action: "REJECT", reason: "outside warranty, no fault found" });
    expect(rejected.status).toBe(200);
    expect(rejected.json.data.state).toBe("REJECTED");
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_cases SET state = 'TRIAGE', open_key = 'x', closed_at = NULL WHERE id = ${cid}`)).rejects.toThrow(/immutable/);
  });

  test("complaint window closed: 409 and no case row; a second issue on a booking whose case closed opens a new case", async () => {
    if (!dbOk) return;
    const id = await completedBooking();
    // Fixture-only: age the completion past the 7-day window frozen in the snapshot.
    await prisma.$executeRaw`UPDATE bookings SET completed_at = now() - interval '8 days' WHERE id = ${id}`;
    const r = await open(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("COMPLAINT_WINDOW_CLOSED");
    expect(await casesFor(id)).toEqual([]);
    const completion = await prisma.$queryRaw<{ state: string }[]>`SELECT state FROM booking_completions WHERE booking_id = ${id}`;
    expect(completion).toEqual([{ state: "PENDING_CUSTOMER" }]);
  });

  test("Q19: a case refunds once through the refund path with a case-scoped key; a second REFUND is the same answer, one refund_requests row carries case_id", async () => {
    if (!dbOk) return;
    const id = await completedBooking({ gatewayPaid: true });
    const paid = await bookingFacts(id);
    expect(paid.paymentStatus).toBe("SUCCESS");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } });
    const r = await open(id);
    expect(r.status).toBe(201);
    const cid: string = r.json.data.case.id;
    expect((await transition(cid, "TRIAGE")).status).toBe(200);
    expect((await resolve(cid, { action: "REFUND" })).json.code).toBe("REFUND_AMOUNT_INVALID");
    const tooMuch = await resolve(cid, { action: "REFUND", refundPaise: Math.round(paid.finalAmount * 100) + 1 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.json.code).toBe("REFUND_EXCEEDS_REFUNDABLE");
    expect(await prisma.$queryRaw`SELECT 1 FROM refund_requests WHERE case_id = ${cid}`).toHaveLength(0);

    const first = await resolve(cid, { action: "REFUND", refundPaise: 10_000 });
    expect(first.status).toBe(200);
    expect(first.json.data.state).toBe("RESOLVED");
    expect(first.json.data.resolution).toMatchObject({ action: "REFUND", status: "COMPLETED", refundPaise: 10_000, refundedPaise: 10_000, idempotencyKey: `case-refund:${cid}` });
    const rows = await prisma.$queryRaw<{ amount: number; idempotency_key: string; payment_id: string }[]>`SELECT amount, idempotency_key, payment_id FROM refund_requests WHERE case_id = ${cid}`;
    expect(rows).toEqual([{ amount: 100, idempotency_key: `case-refund:${cid}`, payment_id: payment.id }]);

    const second = await resolve(cid, { action: "REFUND", refundPaise: 10_000 });
    expect(second.status).toBe(200);
    expect(second.json.data.replayed).toBe(true);
    const different = await resolve(cid, { action: "REFUND", refundPaise: 5_000 });
    expect(different.json.data.replayed).toBe(true);
    expect(different.json.data.resolution.refundedPaise).toBe(10_000);
    expect(await prisma.$queryRaw`SELECT 1 FROM refund_requests WHERE case_id = ${cid}`).toHaveLength(1);
    expect(await prisma.refundRequest.count({ where: { paymentId: payment.id } })).toBe(1);
    const after = await bookingFacts(id);
    expect(after.status).toBe("COMPLETED");
    expect(after.serviceConfigSnapshot).toEqual(paid.serviceConfigSnapshot);
    expect(after.totalAmount).toBe(paid.totalAmount);
    expect(after.finalAmount).toBe(paid.finalAmount);
    const detail = await call("GET", `/api/admin/cases/${cid}`, undefined, admin());
    expect(detail.json.data.refunds).toHaveLength(1);
    expect(detail.json.data.case.state).toBe("RESOLVED");
    // A new report on the same booking after the case closed starts a fresh case; the closed one keeps its refund.
    const again = await open(id, { category: "INCOMPLETE" });
    expect(again.status).toBe(201);
    expect(again.json.data.case.id).not.toBe(cid);
    expect(await casesFor(id)).toHaveLength(2);
  });
});
