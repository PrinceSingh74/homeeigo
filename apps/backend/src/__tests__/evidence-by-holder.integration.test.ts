/**
 * The proof a job is completed on is the proof of the partner who completes it.
 *
 * Re-audit, 2026-10-06: the quality and execution gates counted every evidence row on the booking,
 * so a partner who took over a job could complete it on photos an earlier partner had taken.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, heartbeatFresh, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";
import { pngDataUrl, storedEvidenceKey } from "./helpers/evidence-photo";

const RUN = `evhold-${Date.now().toString(36)}`;
const CHECKLIST = ["Wipe surfaces", "Mop floor"];
let ctx: AdvCtx;
let earlier: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };

type Res = { status: number; json: any };
async function call(method: string, path: string, body: unknown, token: string): Promise<Res> {
  if (method === "POST" && path === BOOKING_CREATE_PATH) body = await withQuoteToken(app, token, body);
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  earlier = await seedAdversarialFixtures(`${RUN}-b`);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  const cfg = {
    materialPolicy: "PROFESSIONAL_PROVIDED",
    equipmentPolicy: "PROFESSIONAL_PROVIDED",
    quality: { checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: true },
    execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", evidence: "PHOTO", sortOrder: 1 }] },
  };
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: cfg }, bearer(ctx.superAdmin));
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
  await cleanupAdversarialFixtures(`${RUN}-b`);
}, 90_000);

describe.serial("an earlier partner's photos do not complete the job for the next one", () => {
  let id = "";
  let earlierEvidenceId = "";

  test("setup: a started job that already holds an earlier partner's before, after and step photos", async () => {
    expect(dbOk).toBe(true);
    const booked = await call("POST", BOOKING_CREATE_PATH, { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(330).toISOString() }, bearer(ctx.customerA));
    expect(booked.status).toBe(201);
    id = booked.json.data.booking?.id ?? booked.json.data.id;
    await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
    await heartbeatFresh(ctx, addr);
    await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
    for (const stage of ["START", "COMPLETION"] as const) {
      const row = await prisma.jobEvidence.create({ data: { bookingId: id, providerId: earlier.providerId, stage, mediaStorageKey: storedEvidenceKey(id, earlier.providerId, stage), mediaMimeType: "image/png", clientUploadId: `${RUN}-earlier-${stage}` } });
      if (stage === "COMPLETION") earlierEvidenceId = row.id;
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_PROGRESS");
  }, 60_000);

  test("a step that needs a photo is not completed by pointing at the earlier partner's photo", async () => {
    expect(dbOk).toBe(true);
    expect((await call("POST", `/api/bookings/${id}/execution/work/start`, {}, partner())).status).toBe(200);
    const r = await call("POST", `/api/bookings/${id}/execution/work/complete`, { evidenceId: earlierEvidenceId }, partner());
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("EVIDENCE_REQUIRED");
  });

  test("the job is not completed on the earlier partner's proof; with the holder's own it is", async () => {
    expect(dbOk).toBe(true);
    const upload = (stage: "START" | "COMPLETION") =>
      call("POST", `/api/bookings/${id}/evidence`, { stage, mediaUrl: pngDataUrl(`${RUN}-own-${stage}`), clientUploadId: `${RUN}-own-${stage}` }, partner());
    const own = await upload("START");
    expect(own.status).toBe(200);
    expect((await call("POST", `/api/bookings/${id}/execution/work/complete`, { evidenceId: own.json.data.evidence.id }, partner())).status).toBe(200);

    // Before-photo is the holder's now; the after-photo on record is still only the earlier partner's.
    const refused = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude, completedChecklist: CHECKLIST }, partner());
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.json.code).toBe("QUALITY_PROOF_REQUIRED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_PROGRESS");

    expect((await upload("COMPLETION")).status).toBe(200);
    const done = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude, completedChecklist: CHECKLIST }, partner());
    expect(done.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  }, 60_000);

  test("once the job is over, no more evidence can be attached to it", async () => {
    expect(dbOk).toBe(true);
    const late = await call("POST", `/api/bookings/${id}/evidence`, { stage: "COMPLETION", mediaUrl: pngDataUrl(`${RUN}-late`), clientUploadId: `${RUN}-late` }, partner());
    expect(late.status).toBe(409);
    expect(late.json.code).toBe("BOOKING_NOT_ACTIVE");
    expect(await prisma.jobEvidence.count({ where: { bookingId: id, clientUploadId: `${RUN}-late` } })).toBe(0);
  });
});
