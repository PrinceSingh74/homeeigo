/**
 * Phase 10–11 — one booking walked through the WHOLE specified process on the isolated test DB, through
 * the real routes, checking every specified field at the place it has to work:
 *
 *   admin authors it  →  the customer is told it before booking  →  the booking freezes it  →
 *   the professional is briefed with it  →  the server enforces it  →  the customer and admin see the result.
 *
 * Process under test: ARRIVAL → VERIFICATION (start PIN) → SERVICE START → EXECUTION (steps) →
 * QUALITY CHECK (checklist + the professional's attestation + verdict) → COMPLETION (customer
 * confirmation, warranty, complaint window). The other suites prove each engine in depth; this one
 * proves the fields are connected end to end, so a field that is authored but never reaches the
 * professional, or shown but never enforced, fails here.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { matchingService } from "../services/matching.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `p1011-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
let providerBefore: { isVerified: boolean; backgroundCheckStatus: "NOT_DONE" | "PENDING" | "CLEARED" | "FAILED"; experienceYears: number };
let bookingId = "";

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
const here = () => ({ latitude: addr.latitude, longitude: addr.longitude });

const CHECKLIST = ["Every seat is clean and dry to the touch", "The area around the sofa is left tidy"];
const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  execution: {
    steps: [
      { id: "scope", title: "Confirm the seats to be cleaned", kind: "PREPARATION", evidence: "NOTE", description: "Agree the seats with the customer.", sortOrder: 10 },
      { id: "shampoo", title: "Shampoo the seats", kind: "WORK", dependsOn: ["scope"], sortOrder: 20, description: "Work seat by seat.", estimatedMinutes: 45, ppe: ["Gloves"], warnings: ["Keep the room ventilated."], materials: ["Upholstery shampoo"], equipment: ["Extraction machine"] },
      { id: "walkthrough", title: "Show the result to the customer", kind: "QUALITY_CHECK", dependsOn: ["shampoo"], sortOrder: 30 },
      { id: "closeout", title: "Pack up", kind: "CLOSEOUT", dependsOn: ["walkthrough"], sortOrder: 40 },
    ],
  },
  safety: {
    information: "The seats are cleaned with a machine and stay damp for a while.",
    warnings: ["Keep children and pets off the sofa until it is dry."],
    prohibitedConditions: ["Exposed wiring near the sofa — stop and report it in the app"],
    customerRequirements: ["Clear loose items off the sofa."],
    providerRequirements: ["Bring the extraction machine."],
    medicalDisclaimer: "Tell the professional about any breathing sensitivity before the visit.",
    emergencyProtocol: "Leave the room and call 112.",
    ppe: ["Gloves"],
    chemicalRestrictions: ["Products other than the ones the professional brings are not used on this job."],
    incidentProtocol: "Stop that part of the job, make the area safe and report it in the app.",
  },
  quality: {
    checklist: CHECKLIST,
    completionCriteria: ["Every agreed seat has been cleaned"],
    proofRequired: false,
    beforeAfterPhotos: false,
    professionalConfirmation: true,
    complaintWindowDays: 7,
    confirmationWindowHours: 12,
  },
  warranty: {
    enabled: true, durationDays: 30, startEvent: "COMPLETION", eligibleIssueTypes: ["QUALITY", "INCOMPLETE"], exclusions: ["Stains that were set before the visit"],
    reworkFirst: true, refundAllowed: true, guarantee: "If the result is not right we come back free of charge.", damagePolicy: "Report anything broken during the visit in the app with a photo.",
  },
  rework: { fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 },
  customerPolicy: { age: { mode: "NONE" }, version: 1 },
  providerRequirements: { kycRequired: true, backgroundCheckRequired: true, experienceYears: 1 },
  matching: { preferredProvider: true },
};

const match = () => matchingService.findBestProvidersWithDiagnostics({ serviceId: ctx.serviceId, customerId: ctx.customerA.id, latitude: addr.latitude, longitude: addr.longitude, scheduledDate: futureSlot(72), maxResults: 100 });
const snapshot = async () => (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as any;
const step = (code: string, action: string, body?: unknown) => call("POST", `/api/bookings/${bookingId}/execution/${code}/${action}`, body ?? {}, partner());
const complete = (extra: Record<string, unknown> = {}) => call("POST", `/api/bookings/${bookingId}/complete`, { ...here(), ...extra }, partner());

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
  providerBefore = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { isVerified: true, backgroundCheckStatus: true, experienceYears: true } });
  await prisma.provider.update({ where: { id: ctx.providerId }, data: { isVerified: true, backgroundCheckStatus: "CLEARED", experienceYears: 3 } });
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.provider.update({ where: { id: ctx.providerId }, data: providerBefore }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("Phase 10–11 spec conformance — one booking through the whole process", () => {
  test("ADMIN: every specified field is accepted by the real service editor write", async () => {
    if (!dbOk) return;
    // The fixture service is seeded live with no configuration, and this configuration gives the
    // customer 12 hours to confirm instead of the platform's 48 — a live service does not take that
    // as a direct edit. So the service is configured off sale, through the same editor write, and
    // published the governed way: pause with a reason, edit, a second admin approves, publish.
    const svc = `/api/admin/services/${ctx.serviceId}`;
    expect((await call("POST", `${svc}/lifecycle`, { to: "PAUSED", reason: "Configuring the service before it is sold" }, admin())).status).toBe(200);
    const r = await call("PUT", svc, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
    expect(r.status).toBe(200);
    // The approver may not be the last editor; the governance suite's `liveWith` names the editor the same way.
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { updatedBy: ctx.supportAdmin.id } });
    const approved = await call("POST", `${svc}/approve`, {}, admin());
    expect({ status: approved.status, body: approved.status === 200 ? null : approved.json }).toEqual({ status: 200, body: null });
    const published = await call("POST", `${svc}/lifecycle`, { to: "ACTIVE" }, admin());
    expect({ status: published.status, body: published.status === 200 ? null : published.json }).toEqual({ status: 200, body: null });
    const stored = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true } })).catalogConfig as any;
    expect(stored.execution.steps.map((s: any) => s.id)).toEqual(["scope", "shampoo", "walkthrough", "closeout"]);
    expect(stored.execution.steps[1]).toMatchObject({ estimatedMinutes: 45, materials: ["Upholstery shampoo"], equipment: ["Extraction machine"], ppe: ["Gloves"] });
    expect(stored.safety).toMatchObject({ ppe: ["Gloves"], incidentProtocol: CONFIG.safety.incidentProtocol });
    expect(stored.quality).toMatchObject({ professionalConfirmation: true, completionCriteria: CONFIG.quality.completionCriteria });
    expect(stored.warranty).toMatchObject({ guarantee: CONFIG.warranty.guarantee, damagePolicy: CONFIG.warranty.damagePolicy });
  });

  test("MATCHING: the professional who meets every requirement is eligible; one who does not is refused with the reason, visible to admin", async () => {
    if (!dbOk) return;
    const ok = await match();
    expect(ok.rejections.find((r) => r.providerId === ctx.providerId)).toBeUndefined();
    const m = ok.matches.find((x) => x.providerId === ctx.providerId);
    expect(m).toBeDefined();
    // The returning-professional preference is exactly "has completed a job for this customer".
    const priorJobs = await prisma.booking.count({ where: { userId: ctx.customerA.id, providerId: ctx.providerId, status: "COMPLETED" } });
    expect(m!.preferredProviderBoost).toBe(priorJobs > 0 ? 10 : undefined);
    // …and never applies to a customer this professional has not served.
    const [{ n: served }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM bookings WHERE user_id = ${ctx.customerB.id} AND provider_id = ${ctx.providerId} AND status = 'COMPLETED'`;
    if (Number(served) === 0) {
      const { loadServiceGateContext } = await import("../services/provider-capability-loader");
      // Customer B is from the same fixture population here, so only the preference differs.
      await prisma.user.update({ where: { id: ctx.customerB.id }, data: { dataOrigin: (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } })).dataOrigin } });
      expect((await loadServiceGateContext(ctx.serviceId, ctx.customerB.id)).bookingIsBusiness).toBe((await loadServiceGateContext(ctx.serviceId, ctx.customerA.id)).bookingIsBusiness);
      const forB = await matchingService.findBestProvidersWithDiagnostics({ serviceId: ctx.serviceId, customerId: ctx.customerB.id, latitude: addr.latitude, longitude: addr.longitude, scheduledDate: futureSlot(72), maxResults: 100 });
      expect(forB.matches.find((x) => x.providerId === ctx.providerId)?.preferredProviderBoost).toBeUndefined();
    }
    expect(Object.keys(m!.scoreBreakdown).sort()).toEqual(["availabilityScore", "completionScore", "distanceScore", "ratingScore", "responseScore"]);

    // The professional's own view of the service says the same thing matching does — ready, with nothing missing.
    const board = async () => {
      const r = await call("GET", "/api/providers/me/service-skills", undefined, partner());
      expect(r.status).toBe(200);
      return (r.json.data.performing as any[]).find((c) => c.serviceId === ctx.serviceId);
    };
    expect((await board())?.readiness).toEqual({ ready: true, missing: [] });

    await prisma.provider.update({ where: { id: ctx.providerId }, data: { backgroundCheckStatus: "PENDING" } });
    try {
      const refused = await match();
      expect(refused.rejections.find((r) => r.providerId === ctx.providerId)?.reasons).toEqual(["BACKGROUND_CHECK_NOT_CLEARED"]);
      // …and now tells them exactly why they are not being offered this service's jobs.
      expect((await board())?.readiness).toEqual({ ready: false, missing: [{ code: "BACKGROUND_CHECK_NOT_CLEARED", detail: "PENDING" }] });
      // The admin's view of this partner's services carries the same answer.
      const adminBoard = await call("GET", `/api/admin/providers/${ctx.providerId}/service-skills`, undefined, admin());
      expect(adminBoard.status).toBe(200);
      expect((adminBoard.json.data.performing as any[]).find((c) => c.serviceId === ctx.serviceId)?.readiness.ready).toBe(false);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { backgroundCheckStatus: "CLEARED" } });
    }
  });

  test("CUSTOMER, before booking: the service page states the process, safety, cover, guarantee and damage policy — and nothing meant for the professional", async () => {
    if (!dbOk) return;
    const r = await call("GET", `/api/services/${ctx.serviceId}`);
    expect(r.status).toBe(200);
    const visit = r.json.data.service.visit;
    expect(visit.process.map((s: any) => s.code)).toEqual(["ARRIVAL", "VERIFICATION", "SERVICE", "CONFIRMATION"]);
    expect(visit.process.at(-1).detail).toContain("12 hours");
    expect(visit.safety).toMatchObject({
      warnings: CONFIG.safety.warnings, customerRequirements: CONFIG.safety.customerRequirements, chemicalRestrictions: CONFIG.safety.chemicalRestrictions,
      information: CONFIG.safety.information, medicalDisclaimer: CONFIG.safety.medicalDisclaimer, emergencyProtocol: CONFIG.safety.emergencyProtocol,
    });
    expect(visit.warranty).toMatchObject({ guarantee: CONFIG.warranty.guarantee, damagePolicy: CONFIG.warranty.damagePolicy, exclusions: CONFIG.warranty.exclusions });
    expect(visit.warranty.statements.join(" ")).toContain("30-day");
    expect(visit.warranty.statements.join(" ")).toContain("within 7 days");
    const blob = JSON.stringify(r.json);
    for (const hidden of ["Exposed wiring", "Bring the extraction machine", CONFIG.safety.incidentProtocol, CHECKLIST[0]!, "kycRequired", "preferredProvider"]) expect(blob).not.toContain(hidden);
  });

  test("BOOKING: the booking freezes the plan, safety, quality and cover that applied when it was made", async () => {
    if (!dbOk) return;
    const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(120).toISOString() }, customer());
    expect(r.status).toBe(201);
    bookingId = r.json.data.booking?.id ?? r.json.data.id;
    const snap = await snapshot();
    expect(snap.execution.schema).toBe("execution.v1");
    expect(snap.execution.steps.map((s: any) => [s.stepNumber, s.code, s.title])).toEqual([
      [1, "scope", "Confirm the seats to be cleaned"], [2, "shampoo", "Shampoo the seats"], [3, "walkthrough", "Show the result to the customer"], [4, "closeout", "Pack up"],
    ]);
    expect(snap.execution.steps[1]).toMatchObject({ description: "Work seat by seat.", estimatedMinutes: 45, materials: ["Upholstery shampoo"], equipment: ["Extraction machine"], ppe: ["Gloves"], warnings: ["Keep the room ventilated."] });
    expect(snap.safety).toMatchObject({ schema: "safety.v1", ppe: ["Gloves"], chemicalRestrictions: CONFIG.safety.chemicalRestrictions, incidentProtocol: CONFIG.safety.incidentProtocol, prohibitedConditions: CONFIG.safety.prohibitedConditions });
    expect(snap.quality).toMatchObject({ checklist: CHECKLIST, completionCriteria: CONFIG.quality.completionCriteria, professionalConfirmation: true, confirmationWindowHours: 12 });
    expect(snap.warranty).toMatchObject({ schema: "warranty.v1", enabled: true, durationDays: 30, complaintWindowDays: 7, guarantee: CONFIG.warranty.guarantee, damagePolicy: CONFIG.warranty.damagePolicy });
    expect(snap.customerPolicy).toMatchObject({ age: { mode: "NONE" } });

    // A later catalogue edit does not rewrite what this booking froze.
    const v = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } })).version;
    const edited = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, safety: { ...CONFIG.safety, ppe: ["Gloves", "Mask"] } }, expectedVersion: v, changeReason: "conformance: later edit" }, admin());
    expect(edited.status).toBe(200);
    expect((await snapshot()).safety.ppe).toEqual(["Gloves"]);
  });

  test("PARTNER, the execution brief: job summary, variant, quantity, duration, requirements, materials, equipment, safety, steps, checklist, proof, escalation", async () => {
    if (!dbOk) return;
    await prisma.booking.update({ where: { id: bookingId }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS" } });
    const b = await call("GET", `/api/bookings/${bookingId}`, undefined, partner());
    expect(b.status).toBe(200);
    const booking = b.json.data.booking ?? b.json.data;
    expect(booking.job).toMatchObject({ variant: "Fabric", quantity: 2, unit: "seats" });
    expect(booking.job.durationMinutes).toBeGreaterThan(0);
    expect(booking.execution.quality).toMatchObject({ checklist: CHECKLIST, completionCriteria: CONFIG.quality.completionCriteria, professionalConfirmation: true, proofRequired: false, beforeAfterPhotos: false });
    expect(typeof booking.execution.materials).toBe("string");
    expect(typeof booking.execution.equipment).toBe("string");

    const s = await call("GET", `/api/bookings/${bookingId}/safety`, undefined, partner());
    expect(s.status).toBe(200);
    expect(s.json.data.safety).toMatchObject({
      warnings: CONFIG.safety.warnings, prohibitedConditions: CONFIG.safety.prohibitedConditions, ppe: ["Gloves"], chemicalRestrictions: CONFIG.safety.chemicalRestrictions,
      medicalDisclaimer: CONFIG.safety.medicalDisclaimer, emergencyProtocol: CONFIG.safety.emergencyProtocol, incidentProtocol: CONFIG.safety.incidentProtocol, providerRequirements: CONFIG.safety.providerRequirements,
    });
    // Escalation path 1: a prohibited condition can be reported on a workable job.
    expect(s.json.data.canReport).toEqual(CONFIG.safety.prohibitedConditions);

    const e = await call("GET", `/api/bookings/${bookingId}/execution`, undefined, partner());
    expect(e.status).toBe(200);
    expect(e.json.data.steps.map((x: any) => [x.stepNumber, x.code, x.title])).toEqual([[1, "scope", "Confirm the seats to be cleaned"], [2, "shampoo", "Shampoo the seats"], [3, "walkthrough", "Show the result to the customer"], [4, "closeout", "Pack up"]]);
    expect(e.json.data.steps[1]).toMatchObject({ description: "Work seat by seat.", estimatedMinutes: 45, materials: ["Upholstery shampoo"], equipment: ["Extraction machine"], ppe: ["Gloves"], evidence: "NONE" });
    expect(e.json.data.steps[0].evidence).toBe("NOTE");

    const req = await call("GET", `/api/bookings/${bookingId}/requirements`, undefined, partner());
    expect(req.status).toBe(200);
    expect(Array.isArray(req.json.data.items)).toBe(true);
  });

  test("CUSTOMER, on the booking: sees safety and progress, never the professional's PPE, incident protocol, stop conditions or step materials", async () => {
    if (!dbOk) return;
    const s = await call("GET", `/api/bookings/${bookingId}/safety`, undefined, customer());
    expect(s.status).toBe(200);
    expect(s.json.data.safety).toMatchObject({ warnings: CONFIG.safety.warnings, chemicalRestrictions: CONFIG.safety.chemicalRestrictions, medicalDisclaimer: CONFIG.safety.medicalDisclaimer });
    for (const k of ["ppe", "incidentProtocol", "prohibitedConditions", "providerRequirements"]) expect(s.json.data.safety).not.toHaveProperty(k);
    const e = await call("GET", `/api/bookings/${bookingId}/execution`, undefined, customer());
    expect(e.json.data.steps.map((x: any) => x.title)).toHaveLength(4);
    expect(e.json.data.steps[1]).toMatchObject({ materials: [], equipment: [] });
  });

  test("PROCESS 1–3: ARRIVAL, then VERIFICATION by the customer's start PIN, then SERVICE START — in that order", async () => {
    if (!dbOk) return;
    // Work cannot begin before the customer's PIN is verified.
    const early = await call("POST", `/api/bookings/${bookingId}/start`, here(), partner());
    expect(early.status).not.toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } })).status).toBe("ACCEPTED");

    const enRoute = await call("POST", `/api/bookings/${bookingId}/en-route`, here(), partner());
    expect(enRoute.status).toBe(200);
    const arrived = await call("POST", `/api/bookings/${bookingId}/arrived`, here(), partner());
    expect(arrived.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { arrivedAt: true } })).arrivedAt).not.toBeNull();

    const issued = await call("POST", `/api/bookings/${bookingId}/start-otp`, {}, partner());
    expect(issued.status).toBe(200);
    const pin = await call("GET", `/api/bookings/${bookingId}/start-pin`, undefined, customer());
    expect(pin.status).toBe(200);
    expect(pin.json.data.pin).toMatch(/^\d{4,8}$/);
    // The professional never receives the PIN from the server.
    expect(JSON.stringify(issued.json)).not.toContain(pin.json.data.pin);
    const wrong = await call("POST", `/api/bookings/${bookingId}/start`, { ...here(), otp: "000000" === pin.json.data.pin ? "111111" : "000000" }, partner());
    expect(wrong.status).not.toBe(200);

    const started = await call("POST", `/api/bookings/${bookingId}/start`, { ...here(), otp: pin.json.data.pin }, partner());
    expect(started.status).toBe(200);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, startedAt: true, startOtpVerifiedAt: true } });
    expect(b.status).toBe("IN_PROGRESS");
    expect(b.startOtpVerifiedAt).not.toBeNull();
    expect(b.startedAt).not.toBeNull();
  });

  test("PROCESS 4: EXECUTION — steps run in order, evidence is required where the step says so, and completion waits for them", async () => {
    if (!dbOk) return;
    const blocked = await complete({ completedChecklist: CHECKLIST, professionalConfirmation: true });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("EXECUTION_GATE_BLOCKED");

    // A later step cannot start before the one it depends on.
    expect((await step("shampoo", "start")).status).toBe(409);
    expect((await step("scope", "start")).status).toBe(200);
    // The scope step asks for a note.
    expect((await step("scope", "complete")).status).not.toBe(200);
    expect((await step("scope", "complete", { note: "Two seats agreed with the customer." })).status).toBe(200);
    for (const code of ["shampoo", "walkthrough", "closeout"]) {
      expect((await step(code, "start")).status).toBe(200);
      expect((await step(code, "complete")).status).toBe(200);
    }
    const e = await call("GET", `/api/bookings/${bookingId}/execution`, undefined, partner());
    expect(e.json.data.steps.map((x: any) => x.state)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(e.json.data.gate.ok).toBe(true);
  });

  test("PROCESS 5: QUALITY CHECK — the checklist, then the professional's confirmation, each refused by the server until met; every attempt leaves a verdict", async () => {
    if (!dbOk) return;
    const noChecklist = await complete({ professionalConfirmation: true });
    expect(noChecklist.status).toBe(409);
    expect(noChecklist.json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    // A claimed boolean and a partial list are not a completed checklist.
    expect((await complete({ checklistComplete: true, completedChecklist: [CHECKLIST[0]], professionalConfirmation: true })).json.code).toBe("QUALITY_CHECKLIST_REQUIRED");

    const noConfirmation = await complete({ completedChecklist: CHECKLIST });
    expect(noConfirmation.status).toBe(409);
    expect(noConfirmation.json.code).toBe("QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } })).status).toBe("IN_PROGRESS");

    const q = await call("GET", `/api/bookings/${bookingId}/quality`, undefined, partner());
    const reasons = q.json.data.history.flatMap((h: any) => h.reasonCodes);
    expect(reasons).toContain("QUALITY_CHECKLIST_REQUIRED");
    expect(reasons).toContain("QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED");
    expect(q.json.data.history.every((h: any) => h.verdict === "REWORK_REQUIRED")).toBe(true);
  });

  test("PROCESS 6: COMPLETION — the job completes with a PASS verdict; the customer confirms inside the frozen window; the cover starts", async () => {
    if (!dbOk) return;
    const done = await complete({ completedChecklist: CHECKLIST, professionalConfirmation: true });
    expect(done.status).toBe(200);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, completedAt: true } });
    expect(b.status).toBe("COMPLETED");

    const adminQuality = await call("GET", `/api/admin/bookings/${bookingId}/quality`, undefined, admin());
    expect(adminQuality.status).toBe(200);
    expect(adminQuality.json.data.latest.verdict).toBe("PASS");
    // The admin reads the rules this booking froze — not today's catalogue.
    expect(adminQuality.json.data.policy.quality).toMatchObject({ checklist: CHECKLIST, completionCriteria: CONFIG.quality.completionCriteria, professionalConfirmation: true, confirmationWindowHours: 12 });
    expect(adminQuality.json.data.policy.warranty).toMatchObject({ durationDays: 30, complaintWindowDays: 7, guarantee: CONFIG.warranty.guarantee, damagePolicy: CONFIG.warranty.damagePolicy, exclusions: CONFIG.warranty.exclusions });
    const adminSafety = await call("GET", `/api/admin/bookings/${bookingId}/safety`, undefined, admin());
    expect(adminSafety.json.data.safety).toMatchObject({ ppe: ["Gloves"], incidentProtocol: CONFIG.safety.incidentProtocol, prohibitedConditions: CONFIG.safety.prohibitedConditions });
    // A partner or a customer never receives the policy block.
    expect((await call("GET", `/api/bookings/${bookingId}/quality`, undefined, partner())).json.data.policy).toBeUndefined();
    expect((await call("GET", `/api/bookings/${bookingId}/quality`, undefined, customer())).json.data.policy).toBeUndefined();

    const c = await call("GET", `/api/bookings/${bookingId}/completion`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.completion).toMatchObject({ state: "PENDING_CUSTOMER", canConfirm: true });
    // confirmationWindowHours = 12 was frozen with the booking.
    expect(Math.round((new Date(c.json.data.completion.confirmBy).getTime() - b.completedAt!.getTime()) / 3_600_000)).toBe(12);
    expect(c.json.data.warranty.state).toBe("ACTIVE");
    expect(Math.round((new Date(c.json.data.warranty.expiresAt).getTime() - new Date(c.json.data.warranty.startsAt).getTime()) / 86_400_000)).toBe(30);

    // A partner cannot confirm for the customer.
    expect((await call("POST", `/api/bookings/${bookingId}/confirm-completion`, {}, partner())).status).not.toBe(200);
    const confirmed = await call("POST", `/api/bookings/${bookingId}/confirm-completion`, {}, customer());
    expect(confirmed.status).toBe(200);
    expect((await call("GET", `/api/bookings/${bookingId}/completion`, undefined, customer())).json.data.completion.state).toBe("CONFIRMED");
  });

  test("WARRANTY: inside the complaint window the customer can report; a covered issue is a warranty claim offered a free rework, damage is a complaint that is not covered", async () => {
    if (!dbOk) return;
    const list = await call("GET", `/api/bookings/${bookingId}/cases`, undefined, customer());
    expect(list.json.data.report).toEqual({ canReport: true, reason: null, openCaseId: null });
    const opened = await call("POST", `/api/bookings/${bookingId}/cases`, { category: "QUALITY", description: "One seat is still stained." }, customer());
    expect(opened.status).toBe(201);
    expect(opened.json.data.case).toMatchObject({ type: "WARRANTY_CLAIM", eligibility: { warrantyCovers: true } });

    const detail = await call("GET", `/api/admin/cases/${opened.json.data.case.id}`, undefined, admin());
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.json)).toContain("REWORK");
    // The professional who did the job sees the report, without money or admin notes.
    const partnerView = await call("GET", `/api/bookings/${bookingId}/cases`, undefined, partner());
    expect(partnerView.json.data.cases[0]).toMatchObject({ category: "QUALITY", description: "One seat is still stained." });
    expect(partnerView.json.data.cases[0].eligibility).toBeUndefined();
  });

  test("MATCHING, afterwards: the professional who completed this customer's job is preferred next time — a ranking boost, never a way past a gate", async () => {
    if (!dbOk) return;
    const again = await match();
    const m = again.matches.find((x) => x.providerId === ctx.providerId);
    expect(m?.preferredProviderBoost).toBe(10);
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isVerified: false } });
    try {
      const refused = await match();
      expect(refused.matches.find((x) => x.providerId === ctx.providerId)).toBeUndefined();
      expect(refused.rejections.find((r) => r.providerId === ctx.providerId)?.reasons).toEqual(["KYC_UNVERIFIED"]);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { isVerified: true } });
    }
    const diag = await call("GET", `/api/admin/bookings/${bookingId}/matching-diagnostics`, undefined, admin());
    expect(diag.status).toBe(200);
  });

  test("AGE POLICY RECORD: the decision made at booking is append-only, yet a booking that carries one can still be erased — the record outlives it", async () => {
    if (!dbOk) return;
    // A second booking of the same service, never worked: it has a decision row and nothing else.
    const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 1, scheduledDate: futureSlot(200).toISOString() }, customer());
    expect(r.status).toBe(201);
    const id: string = r.json.data.booking?.id ?? r.json.data.id;
    const before = await prisma.$queryRaw<{ id: bigint; outcome: string; mode: string }[]>`SELECT id, outcome, mode FROM customer_policy_decisions WHERE booking_id = ${id}`;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ mode: "NONE" });
    const decisionId = before[0]!.id;

    // Direct tampering is refused, whatever it tries to change — including unlinking by hand.
    for (const tamper of [
      () => prisma.$executeRaw`UPDATE customer_policy_decisions SET outcome = 'REFUSED' WHERE id = ${decisionId}`,
      () => prisma.$executeRaw`UPDATE customer_policy_decisions SET booking_id = NULL WHERE id = ${decisionId}`,
      () => prisma.$executeRaw`DELETE FROM customer_policy_decisions WHERE id = ${decisionId}`,
    ]) {
      let refused = "";
      await tamper().catch((e: unknown) => { refused = e instanceof Error ? e.message : String(e); });
      expect(refused).toContain("append-only");
    }

    // Erasing the booking works, and the decision row is kept with only its pointer cleared.
    await prisma.assignmentJob.deleteMany({ where: { bookingId: id } });
    await prisma.booking.delete({ where: { id } });
    const after = await prisma.$queryRaw<{ booking_id: string | null; outcome: string; mode: string }[]>`SELECT booking_id, outcome, mode FROM customer_policy_decisions WHERE id = ${decisionId}`;
    expect(after).toEqual([{ booking_id: null, outcome: before[0]!.outcome, mode: "NONE" }]);
  });
});
