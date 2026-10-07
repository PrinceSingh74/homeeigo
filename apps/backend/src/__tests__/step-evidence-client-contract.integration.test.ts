/**
 * Phase 10 §8 — the evidence contract the partner apps rely on to finish NOTE and BEFORE_AFTER_PHOTOS
 * steps, through the real routes on the isolated test DB.
 *
 * Found 2026-09-29, after the 25 contents went live: 15 live services carry a mandatory
 * BEFORE_AFTER_PHOTOS step and 13 a mandatory NOTE step, but neither partner app could record a
 * before (ARRIVAL/START) + after (COMPLETION) photo for a step, and partner web had no note field —
 * so those jobs could never pass the completion gate. The server rule was right; the clients now make
 * exactly the calls below (upload the before photo, upload the after photo, complete with the after
 * photo's id; complete a NOTE step with its note). This test pins that sequence.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";
import { pngDataUrl } from "./helpers/evidence-photo";

const RUN = `stepev-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
// A different photo per upload: the server refuses the same bytes as both the before and the after.
const PNG = (tag: string) => pngDataUrl(`${RUN}-${tag}`);

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
const step = (id: string, code: string, action: string, body?: unknown) => call("POST", `/api/bookings/${id}/execution/${code}/${action}`, body ?? {}, partner());
const upload = (id: string, stage: "START" | "COMPLETION", tag: string) =>
  call("POST", `/api/bookings/${id}/evidence`, { stage, mediaUrl: PNG(tag), clientUploadId: `${RUN}-${tag}` }, partner());

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
  requirements: [] as unknown[],
  execution: {
    steps: [
      { id: "walkthrough", title: "Agree the scope with the customer", kind: "PREPARATION", evidence: "NOTE", sortOrder: 1 },
      { id: "clean", title: "Clean the kitchen surfaces", kind: "WORK", evidence: "BEFORE_AFTER_PHOTOS", dependsOn: ["walkthrough"], sortOrder: 2 },
    ],
  },
};

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
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG, changeReason: "step evidence contract" }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the step-evidence calls the partner apps make", () => {
  let id = "";

  test("setup: a booking of the service, started", async () => {
    if (!dbOk) return;
    const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(150).toISOString() }, customer());
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    id = r.json.data.booking?.id ?? r.json.data.id;
    await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
    await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("IN_PROGRESS");
  });

  test("a NOTE step is refused without its note and completes with it", async () => {
    if (!dbOk) return;
    expect((await step(id, "walkthrough", "start")).status).toBe(200);
    const bare = await step(id, "walkthrough", "complete", {});
    expect(bare.json.code).toBe("EVIDENCE_REQUIRED");
    const done = await step(id, "walkthrough", "complete", { note: "Customer asked for the hob and sink only" });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
  });

  test("a BEFORE_AFTER_PHOTOS step: before photo alone is refused (AFTER missing); before + after completes against the after photo", async () => {
    if (!dbOk) return;
    expect((await step(id, "clean", "start")).status).toBe(200);
    expect((await step(id, "clean", "complete", {})).json.code).toBe("EVIDENCE_REQUIRED");
    const before = await upload(id, "START", "before");
    expect(before.status).toBe(200);
    const onlyBefore = await step(id, "clean", "complete", { evidenceId: before.json.data.evidence.id });
    expect(onlyBefore.json.code).toBe("EVIDENCE_REQUIRED");
    expect(onlyBefore.json.data?.detail ?? onlyBefore.json.detail).toEqual(["AFTER"]);
    const after = await upload(id, "COMPLETION", "after");
    expect(after.status).toBe(200);
    const done = await step(id, "clean", "complete", { evidenceId: after.json.data.evidence.id });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    const [row] = await prisma.$queryRaw<{ state: string; evidence_ref: string | null }[]>`SELECT state, evidence_ref FROM booking_execution_steps WHERE booking_id = ${id} AND code = 'clean'`;
    expect(row).toEqual({ state: "COMPLETED", evidence_ref: after.json.data.evidence.id });
  });

  test("with every mandatory step done, the execution gate is open for completion", async () => {
    if (!dbOk) return;
    const ex = await call("GET", `/api/bookings/${id}/execution`, undefined, partner());
    expect(ex.json.data.gate.ok).toBe(true);
  });
});
