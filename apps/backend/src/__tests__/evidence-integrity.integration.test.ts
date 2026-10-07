/**
 * A job photo is one photo, of one moment, of one job — and nobody but the server knows where it is kept.
 *
 * Adversarial audit, 2026-10-07:
 *   - the same bytes served as the "before" and the "after", and as proof of two different jobs;
 *   - the second photo of an upload was stored but not counted, and its storage key was listed in the
 *     first row's metadata; uploads per job were unbounded; a failed write left the object behind;
 *   - a reader was handed `local://job-evidence/<storage key>`;
 *   - `/complete` answered an oversized photo with the "a link is not accepted" sentence.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { jobEvidenceService } from "../services/job-evidence.service";
import { objectStorageService } from "../services/object-storage.service";
import { imageFromDataUrl, isServerStoredEvidence, MAX_EVIDENCE_PHOTO_BYTES, MAX_EVIDENCE_PHOTOS_PER_STAGE, MAX_EVIDENCE_ROWS_PER_BOOKING } from "../lib/job-evidence-media";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, heartbeatFresh, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";
import { pngBytes, pngDataUrl, storedEvidenceKey } from "./helpers/evidence-photo";

const RUN = `evint-${Date.now().toString(36)}`;
const CHECKLIST = ["Wipe surfaces", "Mop floor"];
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };

type Res = { status: number; json: any };
async function call(method: string, urlPath: string, body: unknown, token: string): Promise<Res> {
  if (method === "POST" && urlPath === BOOKING_CREATE_PATH) body = await withQuoteToken(app, token, body);
  const res = await app.handle(new Request(`http://localhost${urlPath}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });
const upload = (id: string, body: Record<string, unknown>) => call("POST", `/api/bookings/${id}/evidence`, body, partner());
const rowsOf = (id: string) => prisma.jobEvidence.findMany({ where: { bookingId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
/** The files the server holds for one stage of one job (local storage in the test runtime). */
function storedFiles(bookingId: string, stage: "ARRIVAL" | "START" | "COMPLETION"): string[] {
  const dir = path.dirname(objectStorageService.resolveLocalPath("job-evidence", storedEvidenceKey(bookingId, ctx.providerId, stage)));
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

async function jobInHand(hoursAhead: number, started: boolean): Promise<string> {
  const booked = await call("POST", BOOKING_CREATE_PATH, { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(hoursAhead).toISOString() }, bearer(ctx.customerA));
  if (booked.status !== 201) throw new Error(`book: ${booked.status} ${JSON.stringify(booked.json)}`);
  const id: string = booked.json.data.booking?.id ?? booked.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  if (started) {
    await heartbeatFresh(ctx, addr);
    await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
  }
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
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  const cfg = { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", quality: { checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: true } };
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: cfg }, bearer(ctx.superAdmin));
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  // The photos this suite stored: every key names one of its bookings.
  const ids = (await prisma.booking.findMany({ where: { userId: ctx.customerA.id }, select: { id: true } })).map((b) => b.id);
  for (const id of ids) {
    const dir = path.dirname(path.dirname(path.dirname(objectStorageService.resolveLocalPath("job-evidence", storedEvidenceKey(id, ctx.providerId, "START")))));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await cleanupAdversarialFixtures(RUN);
}, 90_000);

describe.serial("one photo is evidence of one stage of one job", () => {
  let jobA = "";
  let jobB = "";
  const before = pngDataUrl(`${RUN}-before`);
  let beforeRowId = "";

  test("setup: two jobs in hand for the same partner", async () => {
    expect(dbOk).toBe(true);
    jobA = await jobInHand(340, true);
    jobB = await jobInHand(370, false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: jobA } })).status).toBe("IN_PROGRESS");
  }, 90_000);

  test("an upload records the SHA-256 of the bytes the server stored", async () => {
    expect(dbOk).toBe(true);
    const r = await upload(jobA, { stage: "START", mediaUrl: before, clientUploadId: `${RUN}-before` });
    expect(r.status).toBe(200);
    expect(r.json.data.evidence.photoCount).toBe(1);
    beforeRowId = r.json.data.evidence.id;
    const row = await prisma.jobEvidence.findUniqueOrThrow({ where: { id: beforeRowId } });
    const parsed = imageFromDataUrl(before);
    const expected = parsed.ok ? createHash("sha256").update(parsed.image.bytes).digest("hex") : "";
    expect((row.metadata as { sha256?: string }).sha256).toBe(expected);
    expect(isServerStoredEvidence(row)).toBe(true);
    const onDisk = fs.readFileSync(objectStorageService.resolveLocalPath("job-evidence", row.mediaStorageKey!));
    expect(createHash("sha256").update(onDisk).digest("hex")).toBe(expected);
  });

  test("the before-photo is refused as the after-photo: 409, a plain sentence, no row and no stored file", async () => {
    expect(dbOk).toBe(true);
    const r = await upload(jobA, { stage: "COMPLETION", mediaUrl: before, clientUploadId: `${RUN}-after-fake` });
    expect({ status: r.status, code: r.json.code, error: r.json.error }).toEqual({
      status: 409,
      code: "EVIDENCE_MEDIA_DUPLICATE",
      error: "This is the same photo you already sent for the start of the job. Take a new one.",
    });
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobA, stage: "COMPLETION", mediaStorageKey: { not: null } } })).toBe(0);
    expect(storedFiles(jobA, "COMPLETION")).toEqual([]);
    // Hidden among other photos of the same upload it refuses the whole upload.
    const mixed = await upload(jobA, { stage: "COMPLETION", photos: [pngDataUrl(`${RUN}-fresh`), before] });
    expect(mixed.json.code).toBe("EVIDENCE_MEDIA_DUPLICATE");
    expect(storedFiles(jobA, "COMPLETION")).toEqual([]);
  });

  test("the same photo sent again for the same stage is the same evidence, not a second copy", async () => {
    expect(dbOk).toBe(true);
    const again = await upload(jobA, { stage: "START", mediaUrl: before, clientUploadId: `${RUN}-before-again` });
    expect(again.status).toBe(200);
    expect(again.json.data.evidence.id).toBe(beforeRowId);
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobA, stage: "START", mediaStorageKey: { not: null } } })).toBe(1);
    expect(storedFiles(jobA, "START")).toHaveLength(1);
  });

  test("the same photo is refused on the partner's other job", async () => {
    expect(dbOk).toBe(true);
    const r = await upload(jobB, { stage: "START", mediaUrl: before, clientUploadId: `${RUN}-other-job` });
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "EVIDENCE_MEDIA_DUPLICATE" });
    expect(r.json.error).toContain("another job");
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobB, mediaStorageKey: { not: null } } })).toBe(0);
    expect(storedFiles(jobB, "START")).toEqual([]);
  });

  test("every photo of a multi-photo upload is its own counted row; no key is listed in metadata", async () => {
    expect(dbOk).toBe(true);
    const photos = [pngDataUrl(`${RUN}-m1`), pngDataUrl(`${RUN}-m2`), pngDataUrl(`${RUN}-m1`)]; // the third repeats the first
    const r = await upload(jobA, { stage: "ARRIVAL", photos, clientUploadId: `${RUN}-multi` });
    expect(r.status).toBe(200);
    expect(r.json.data.evidence.photoCount).toBe(2);
    const rows = (await rowsOf(jobA)).filter((x) => x.stage === "ARRIVAL" && x.mediaStorageKey);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => isServerStoredEvidence(x) && x.isCurrent)).toBe(true);
    expect(new Set(rows.map((x) => x.mediaStorageKey)).size).toBe(2);
    expect(rows.map((x) => x.clientUploadId).sort()).toEqual([`${RUN}-multi`, `${RUN}-multi#2`]);
    expect(JSON.stringify(rows.map((x) => x.metadata))).not.toContain("ev1/");
    expect(storedFiles(jobA, "ARRIVAL").sort()).toEqual(rows.map((x) => path.basename(x.mediaStorageKey!)).sort());
    // The same upload id again is the same upload.
    const replay = await upload(jobA, { stage: "ARRIVAL", photos, clientUploadId: `${RUN}-multi` });
    expect(replay.json.data.evidence.id).toBe(r.json.data.evidence.id);
    expect(storedFiles(jobA, "ARRIVAL")).toHaveLength(2);
  });

  test("a reader is handed a route to fetch the photo from — never the storage key or a local:// URL; an admin keeps the key", async () => {
    expect(dbOk).toBe(true);
    for (const token of [partner(), bearer(ctx.customerA)]) {
      const list = await call("GET", `/api/bookings/${jobA}/evidence`, undefined, token);
      expect(list.status).toBe(200);
      const text = JSON.stringify(list.json);
      expect(text).not.toContain("local://");
      expect(text).not.toContain("ev1/");
      expect(text).not.toContain("sha256");
      const withPhoto = list.json.data.evidence.filter((e: { mediaMimeType: string | null }) => e.mediaMimeType);
      expect(withPhoto.length).toBe(3);
      for (const e of withPhoto) expect(e.mediaAccessUrl).toBe(`/api/bookings/${jobA}/evidence/${e.id}/media`);
    }
    const admin = await call("GET", `/api/bookings/${jobA}/evidence`, undefined, bearer(ctx.superAdmin));
    expect(JSON.stringify(admin.json)).toContain("ev1/");
    expect(JSON.stringify(admin.json)).not.toContain("local://");

    const media = (token: string, evidenceId = beforeRowId, bookingId = jobA) =>
      app.handle(new Request(`http://localhost/api/bookings/${bookingId}/evidence/${evidenceId}/media`, { headers: { Authorization: `Bearer ${token}` } }));
    const mine = await media(partner());
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(mine.headers.get("cache-control")).toContain("private");
    const parsed = imageFromDataUrl(before);
    expect(parsed.ok && Buffer.from(await mine.arrayBuffer()).equals(parsed.image.bytes)).toBe(true);
    expect((await media(bearer(ctx.customerA))).status).toBe(200);
    expect((await media(bearer(ctx.superAdmin))).status).toBe(200);
    // Not a party to the job; and a row of this job is not served under another job's id.
    expect((await media(bearer(ctx.customerB))).status).toBeGreaterThanOrEqual(403);
    expect((await media(partner(), beforeRowId, jobB)).status).toBe(404);
    // The system's own position stamp has no photo.
    const stamp = (await rowsOf(jobA)).find((x) => !x.mediaStorageKey);
    if (stamp) expect((await media(partner(), stamp.id)).status).toBe(404);
  });

  test("when the row cannot be written, the stored object is removed", async () => {
    expect(dbOk).toBe(true);
    const parsed = imageFromDataUrl(pngDataUrl(`${RUN}-orphan`));
    if (!parsed.ok) throw new Error("fixture");
    const filesBefore = storedFiles(jobB, "COMPLETION");
    // A NUL inside a JSON string is refused by Postgres at INSERT — after the object was stored.
    const failed = await jobEvidenceService
      .recordStage({ bookingId: jobB, providerId: ctx.providerId, stage: "COMPLETION", images: [parsed.image], metadata: { note: "a\u0000b" }, requireActiveJob: true })
      .then(() => "written", () => "failed");
    expect(failed).toBe("failed");
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobB, stage: "COMPLETION" } })).toBe(0);
    expect(storedFiles(jobB, "COMPLETION")).toEqual(filesBefore);
  });

  test("a stage holds a bounded number of photos; replacing them is still allowed", async () => {
    expect(dbOk).toBe(true);
    for (let batch = 0; batch < MAX_EVIDENCE_PHOTOS_PER_STAGE / 4; batch++) {
      const r = await upload(jobB, { stage: "START", photos: [0, 1, 2, 3].map((i) => pngDataUrl(`${RUN}-cap-${batch}-${i}`)) });
      expect(r.status).toBe(200);
    }
    const full = await upload(jobB, { stage: "START", mediaUrl: pngDataUrl(`${RUN}-cap-over`) });
    expect({ status: full.status, code: full.json.code }).toEqual({ status: 409, code: "EVIDENCE_LIMIT_REACHED" });
    expect(storedFiles(jobB, "START")).toHaveLength(MAX_EVIDENCE_PHOTOS_PER_STAGE);
    const replaced = await upload(jobB, { stage: "START", mediaUrl: pngDataUrl(`${RUN}-cap-replace`), replace: true });
    expect(replaced.status).toBe(200);
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobB, stage: "START", isCurrent: true, mediaStorageKey: { not: null } } })).toBe(1);
  }, 60_000);

  test("a job holds a bounded number of evidence rows, replaced ones included", async () => {
    expect(dbOk).toBe(true);
    const have = await prisma.jobEvidence.count({ where: { bookingId: jobB, providerId: ctx.providerId } });
    await prisma.jobEvidence.createMany({
      data: Array.from({ length: MAX_EVIDENCE_ROWS_PER_BOOKING - have }, (_, i) => ({ bookingId: jobB, providerId: ctx.providerId, stage: "ARRIVAL" as const, isCurrent: false, clientUploadId: `${RUN}-fill-${i}` })),
    });
    const filesBefore = storedFiles(jobB, "COMPLETION");
    for (const body of [{ stage: "COMPLETION", mediaUrl: pngDataUrl(`${RUN}-over-job`) }, { stage: "COMPLETION", mediaUrl: pngDataUrl(`${RUN}-over-job-2`), replace: true }, { stage: "COMPLETION" }]) {
      const r = await upload(jobB, body);
      expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "EVIDENCE_LIMIT_REACHED" });
    }
    expect(storedFiles(jobB, "COMPLETION")).toEqual(filesBefore);
    expect(await prisma.jobEvidence.count({ where: { bookingId: jobB, providerId: ctx.providerId } })).toBe(MAX_EVIDENCE_ROWS_PER_BOOKING);
  });

  test("/complete says what is wrong with a photo: too large is 413 with the size sentence, a link is the link sentence, a reused photo is a duplicate", async () => {
    expect(dbOk).toBe(true);
    const complete = (photos: string[]) => call("POST", `/api/bookings/${jobA}/complete`, { latitude: addr.latitude, longitude: addr.longitude, completedChecklist: CHECKLIST, photos }, partner());

    const huge = `data:image/png;base64,${Buffer.concat([pngBytes(`${RUN}-huge`), Buffer.alloc(MAX_EVIDENCE_PHOTO_BYTES)]).toString("base64")}`;
    const tooLarge = await complete([huge]);
    expect({ status: tooLarge.status, code: tooLarge.json.code }).toEqual({ status: 413, code: "EVIDENCE_MEDIA_TOO_LARGE" });
    expect(tooLarge.json.error).toContain("too large");
    expect(tooLarge.json.error).not.toContain("link");

    const link = await complete(["https://example.test/after.jpg"]);
    expect({ status: link.status, code: link.json.code }).toEqual({ status: 400, code: "EVIDENCE_MEDIA_INVALID" });
    expect(link.json.error).toContain("A link is not accepted");

    const many = await complete([0, 1, 2, 3, 4].map((i) => pngDataUrl(`${RUN}-many-${i}`)));
    expect({ status: many.status, code: many.json.code }).toEqual({ status: 400, code: "EVIDENCE_MEDIA_INVALID" });
    expect(many.json.error).toContain("At most 4 photos");

    const reused = await complete([before]);
    expect({ status: reused.status, code: reused.json.code }).toEqual({ status: 409, code: "EVIDENCE_MEDIA_DUPLICATE" });
    expect(reused.json.error).toBe("This is the same photo you already sent for the start of the job. Take a new one.");

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: jobA } })).status).toBe("IN_PROGRESS");
    expect(storedFiles(jobA, "COMPLETION")).toEqual([]);

    // With a real after-photo the job completes, and that photo is counted.
    const done = await complete([pngDataUrl(`${RUN}-after`)]);
    expect(done.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: jobA } })).status).toBe("COMPLETED");
    expect(storedFiles(jobA, "COMPLETION")).toHaveLength(1);
  }, 90_000);
});
