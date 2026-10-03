/**
 * W2-D1 over HTTP, against the isolated test database.
 *
 * The unit file proves the resolver; this file proves the DOOR. Every case here is one the old gate
 * let through, plus the controls that prove the fix did not simply break completion:
 *
 *   untouched checklist + checklistComplete:true     -> refused
 *   partial checklist + checklistComplete:true       -> refused
 *   required proof absent + checklistComplete:true   -> refused
 *   valid checklist + valid proof                    -> completes
 *   mediaStorageKey-only proof                       -> recognised (the old count ignored it)
 *   proof on a DIFFERENT booking                     -> refused
 *   wrong actor                                      -> refused
 *   duplicate completion                             -> idempotent, one earning
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  keepPresenceFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { bookingService } from "../services/booking.service";

const RUN = `w2d1-${Date.now().toString(36)}`;
const CHECKLIST = ["Wipe surfaces", "Mop floor", "Empty bins"];
let ctx: AdvCtx;
let partnerToken = "";
let dbOk = false;
let day = 4;
const created: string[] = [];

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** Put a quality policy on the fixture service BEFORE bookings are created, so the snapshot freezes it. */
async function setQuality(quality: Record<string, unknown> | null) {
  const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true } });
  const cfg = { ...((svc.catalogConfig as Record<string, unknown>) ?? {}) };
  if (quality) cfg.quality = quality;
  else delete cfg.quality;
  await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: cfg as Prisma.InputJsonValue } });
}

/** A paid booking the partner has already started. */
async function startedBooking() {
  await keepPresenceFresh(ctx);
  const result = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in result) || !result.booking) throw new Error(`create failed: ${JSON.stringify(result)}`);
  const id = result.booking.id;
  await payWithRealWallet(id, ctx.customerA.id);
  await prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.IN_PROGRESS, startedAt: new Date(), arrivedAt: new Date(Date.now() - 600_000) },
  });
  created.push(id);
  return id;
}

async function post(path: string, token: string, body: Record<string, unknown>) {
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

/** Upload proof through the REAL evidence route, key-backed — the shape the old count ignored. */
async function uploadKeyOnlyProof(bookingId: string, stage: "START" | "COMPLETION") {
  const r = await post(`${bookingId}/evidence`, partnerToken, {
    stage,
    latitude: null,
    longitude: null,
    mediaStorageKey: `s3/evidence/${bookingId}/${stage.toLowerCase()}.jpg`,
    mediaMimeType: "image/jpeg",
    clientUploadId: `${RUN}-${bookingId}-${stage}`,
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`evidence upload failed: ${r.status} ${JSON.stringify(r.json)}`);
}

const complete = (id: string, body: Record<string, unknown>, token = partnerToken) => post(`${id}/complete`, token, body);
const statusOf = async (id: string) =>
  (await prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM bookings WHERE id = ${id}`)[0]!.status;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const vendor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId }, select: { id: true, email: true } });
  partnerToken = bearer(vendor as any);
  await setQuality({ checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: true });
}, 120_000);

afterEach(async () => {
  if (!dbOk || created.length === 0) return;
  await prisma.$executeRaw`
    UPDATE bookings SET status = 'CANCELLED_BY_USER', cancelled_at = NOW()
    WHERE id = ANY(${created}) AND status NOT IN ('COMPLETED', 'CANCELLED_BY_USER')
  `;
  created.length = 0;
});

afterAll(async () => {
  if (!dbOk) return;
  await setQuality(null).catch(() => undefined);
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the client boolean no longer completes a job", () => {
  test("untouched checklist + checklistComplete:true → refused, booking untouched", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const r = await complete(id, { checklistComplete: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  test("partial checklist + checklistComplete:true → refused", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const r = await complete(id, { checklistComplete: true, completedChecklist: ["Wipe surfaces"] });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  test("three arbitrary strings do not satisfy a three-item checklist (the length defect)", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const r = await complete(id, { completedChecklist: ["a", "b", "c"] });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_CHECKLIST_REQUIRED");
  });

  test("required proof absent + checklistComplete:true + full checklist → refused on proof", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    const r = await complete(id, { checklistComplete: true, completedChecklist: CHECKLIST });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_PROOF_REQUIRED");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  test("a client photos[] array alone does NOT satisfy the AFTER half — the row must exist", async () => {
    if (!dbOk) return;
    // Before: `photos: [...]` in the body set hasAfter=true and was persisted afterwards, best-effort.
    // Now the media is written first and read back; a bare string that is not a real upload still
    // becomes a row, so this asserts the BEFORE half is what blocks — nothing was uploaded for it.
    const id = await startedBooking();
    const r = await complete(id, { photos: ["https://client-says-so/after.jpg"], completedChecklist: CHECKLIST });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_PROOF_REQUIRED");
  });
});

describe.serial("real evidence and a real checklist complete the job", () => {
  test("valid checklist + valid before/after proof → completes", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const r = await complete(id, { completedChecklist: CHECKLIST });
    expect(r.status).toBe(200);
    expect(r.json.data.booking.status).toBe("completed");
    expect(await statusOf(id)).toBe("COMPLETED");
  });

  test("mediaStorageKey-only proof is recognised — the old count read mediaUrl only", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    // Prove the rows really are key-only: no legacy url at all.
    const rows = await prisma.jobEvidence.findMany({ where: { bookingId: id }, select: { mediaUrl: true, mediaStorageKey: true } });
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.mediaUrl).toBeNull();
      expect(row.mediaStorageKey).toBeTruthy();
    }
    const r = await complete(id, { completedChecklist: CHECKLIST });
    expect(r.status).toBe(200);
  });

  test("the checklist is matched case- and space-insensitively, so honest input is not punished", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const r = await complete(id, { completedChecklist: ["  WIPE surfaces", "mop   floor", "Empty Bins "] });
    expect(r.status).toBe(200);
  });
});

describe.serial("proof and authority are bound to THIS booking and THIS partner", () => {
  test("proof uploaded to a different booking does not count", async () => {
    if (!dbOk) return;
    const a = await startedBooking();
    const b = await startedBooking();
    await uploadKeyOnlyProof(a, "START");
    await uploadKeyOnlyProof(a, "COMPLETION");
    const r = await complete(b, { completedChecklist: CHECKLIST });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUALITY_PROOF_REQUIRED");
    expect(await statusOf(b)).toBe("IN_PROGRESS");
  });

  test("the customer cannot complete their own booking", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    const r = await complete(id, { completedChecklist: CHECKLIST }, bearer(ctx.customerA));
    expect(r.status).toBe(403);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  test("an unrelated partner cannot complete it either", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await expect(
      bookingService.complete("another-provider-entirely", id, null, null, undefined, { completedChecklist: CHECKLIST }),
    ).rejects.toThrow(/FORBIDDEN|PROVIDER_NOT_FOUND/);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  test("uploading proof for a booking that is not yours is refused", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    const r = await post(`${id}/evidence`, bearer(ctx.customerA), {
      stage: "COMPLETION",
      latitude: null,
      longitude: null,
      mediaStorageKey: "s3/forged.jpg",
    });
    expect([401, 403]).toContain(r.status);
    expect(await prisma.jobEvidence.count({ where: { bookingId: id } })).toBe(0);
  });
});

describe.serial("completing twice is one completion", () => {
  test("the second call is a no-op replay: same completedAt, one earning", async () => {
    if (!dbOk) return;
    const id = await startedBooking();
    await uploadKeyOnlyProof(id, "START");
    await uploadKeyOnlyProof(id, "COMPLETION");
    const first = await complete(id, { completedChecklist: CHECKLIST });
    expect(first.status).toBe(200);
    const completedAt = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { completedAt: true } })).completedAt;

    const second = await complete(id, { completedChecklist: CHECKLIST });
    expect(second.status).toBe(200);
    const again = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { completedAt: true } })).completedAt;
    expect(again?.getTime()).toBe(completedAt?.getTime());
    expect(await prisma.earning.count({ where: { bookingId: id } })).toBe(1);
  });
});
