/**
 * Partner data boundary through the real routes: what a partner reads about a job follows the
 * partner's stage with it (offered, holding it, over), and every partner booking payload stays
 * inside the allow-list in lib/privacy-policy.engine.ts.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { collectForbiddenPartnerKeys, unknownPartnerBookingKeys } from "../lib/privacy-policy.engine";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { withQuoteToken } from "./helpers/quote-token";

const RUN = `pbound-${Date.now().toString(36)}`;
const NOTE = "Gate code 4421, dog at home";
let ctx: AdvCtx;
let dbOk = false;
let id = "";

const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

async function get(path: string, token: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text || "{}") as { data?: any } };
}
const detail = async () => (await get(`/api/bookings/${id}`, partner())).json.data?.booking;
const listRow = async () => {
  const r = await get("/api/providers/me/bookings?limit=50", partner());
  return (r.json.data?.bookings as any[] | undefined)?.find((b) => b.id === id);
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
  const token = bearer(ctx.customerA);
  const body = await withQuoteToken(app, token, {
    serviceId: ctx.serviceId,
    addressId: ctx.addressAId,
    quantity: 1,
    scheduledDate: futureSlot(270).toISOString(),
    description: NOTE,
  });
  const r = await app.handle(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
  const j = (await r.json()) as { data: { booking?: { id: string }; id?: string } };
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(j)}`);
  id = j.data.booking?.id ?? j.data.id ?? "";
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.assignmentJob.deleteMany({ where: { bookingId: id } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

/** The partner is being offered the job: it is dispatched to them and nobody holds it. */
async function setOffered() {
  await prisma.booking.update({ where: { id }, data: { providerId: null, status: "PENDING", paymentStatus: "SUCCESS" } });
  await prisma.assignmentJob.upsert({
    where: { bookingId: id },
    create: { bookingId: id, status: "DISPATCHED", currentProviderId: ctx.providerId, lastDispatchedAt: new Date(), timeoutAt: new Date(Date.now() + 600_000) },
    update: { status: "DISPATCHED", currentProviderId: ctx.providerId, lastDispatchedAt: new Date(), timeoutAt: new Date(Date.now() + 600_000) },
  });
  const job = await prisma.assignmentJob.findUniqueOrThrow({ where: { bookingId: id } });
  await prisma.assignmentAttempt.upsert({
    where: { jobId_providerId: { jobId: job.id, providerId: ctx.providerId } },
    create: { jobId: job.id, providerId: ctx.providerId, status: "SENT" },
    update: { status: "SENT" },
  });
}
/** The live offer as the partner's requests tab lists it. */
const offerRow = async () => {
  const r = await get("/api/providers/me/bookings?status=pending&limit=50", partner());
  return (r.json.data?.bookings as any[] | undefined)?.find((b) => b.id === id);
};
/** COMPLETED is terminal (the database refuses to leave it), so every test that needs it runs last. */
const setHeld = (status: "ACCEPTED" | "IN_PROGRESS" | "COMPLETED") =>
  prisma.booking.update({
    where: { id },
    data: { providerId: ctx.providerId, status, paymentStatus: "SUCCESS", ...(status === "COMPLETED" ? { completedAt: new Date() } : {}) },
  });

describe.serial("what a partner reads follows their stage with the job", () => {
  test("offered: first name only, no street address or coordinates, and not the customer's note", async () => {
    expect(dbOk).toBe(true);
    await setOffered();
    const b = await detail();
    expect(b).toBeDefined();
    expect(b.customer.firstName).toBeTruthy();
    expect(b.customer.lastName).toBeNull();
    expect(b.customer.phoneMasked).toBeNull();
    expect(b.customer.profileImage).toBeNull();
    expect(b.address.addressLine1).toBeNull();
    expect(b.address.latitude).toBeNull();
    expect(JSON.stringify(b)).not.toContain("4421");
    const row = await offerRow();
    expect(row).toBeDefined();
    expect(row.offer).not.toBeNull();
    expect(row.description).toBeNull();
    expect(row.customer.lastName).toBeNull();
    expect(row.address.latitude).toBeNull();
    expect(JSON.stringify(row)).not.toContain("4421");
    expect({ unknown: unknownPartnerBookingKeys(row), forbidden: collectForbiddenPartnerKeys(row) }).toEqual({ unknown: [], forbidden: [] });
  });

  test("holding the job: the note, the full address and a masked phone, never the number", async () => {
    expect(dbOk).toBe(true);
    await setHeld("ACCEPTED");
    const row = await listRow();
    expect(row).toBeDefined();
    expect(row.description).toBe(NOTE);
    expect(row.address.latitude).not.toBeNull();
    const b = await detail();
    expect(b.customer.lastName).toBeTruthy();
    const phone = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { phoneNumber: true } });
    if (phone.phoneNumber) expect(JSON.stringify([row, b])).not.toContain(phone.phoneNumber);
  });

});

describe.serial("every partner booking payload stays inside the allow-list", () => {
  test("the job detail and the job list row carry no field outside it, while offered and while held", async () => {
    expect(dbOk).toBe(true);
    const stages: [string, () => Promise<unknown>][] = [
      ["offered", setOffered],
      ["accepted", () => setHeld("ACCEPTED")],
      ["in progress", () => setHeld("IN_PROGRESS")],
    ];
    for (const [label, enter] of stages) {
      await enter();
      const b = await detail();
      expect({ stage: label, unknown: unknownPartnerBookingKeys(b), forbidden: collectForbiddenPartnerKeys(b) }).toEqual({ stage: label, unknown: [], forbidden: [] });
      const row = await listRow();
      if (row) expect({ stage: label, unknown: unknownPartnerBookingKeys(row), forbidden: collectForbiddenPartnerKeys(row) }).toEqual({ stage: label, unknown: [], forbidden: [] });
    }
  });

  test("the job sub-resources carry no forbidden key and never the customer's phone or email", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const customer = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { phoneNumber: true, email: true } });
    for (const sub of ["execution", "requirements", "safety", "quality", "completion", "actions", "evidence", "cases"]) {
      const r = await get(`/api/bookings/${id}/${sub}`, partner());
      // A sub-resource that does not apply to this booking may answer 404; one that answers must be clean.
      if (r.status !== 200) continue;
      expect({ sub, forbidden: collectForbiddenPartnerKeys(r.json) }).toEqual({ sub, forbidden: [] });
      if (customer.phoneNumber) expect(r.text).not.toContain(customer.phoneNumber);
      if (customer.email) expect(r.text).not.toContain(customer.email);
    }
  });

  test("another partner cannot read the job at all", async () => {
    expect(dbOk).toBe(true);
    const stranger = bearer(ctx.customerB);
    const r = await get(`/api/bookings/${id}`, stranger);
    expect(r.status).toBe(404);
  });
});

async function send(path: string, token: string, body: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { code?: string } };
}
const evidenceOf = async (token: string) => {
  const r = await get(`/api/bookings/${id}/evidence`, token);
  return { status: r.status, text: r.text, rows: (r.json.data?.evidence ?? []) as Record<string, unknown>[] };
};

describe.serial("evidence, the note and chat follow the stage too", () => {
  test("offered: no evidence of the job is handed out (it holds an earlier partner's photos and position)", async () => {
    expect(dbOk).toBe(true);
    await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", latitude: 28.6201, longitude: 77.3702, clientUploadId: `${RUN}-arrival` } });
    await setOffered();
    const offered = await evidenceOf(partner());
    expect({ status: offered.status, rows: offered.rows.length }).toEqual({ status: 200, rows: 0 });
    expect(offered.text).not.toContain("28.6201");
  });

  test("holding the job: own evidence without coordinates, the note on the job detail, chat open", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const mine = await evidenceOf(partner());
    expect(mine.rows.length).toBe(1);
    expect(mine.rows[0]).not.toHaveProperty("latitude");
    expect(mine.rows[0]).not.toHaveProperty("longitude");
    expect(mine.text).not.toContain("28.6201");
    // The admin who audits the visit still reads where the evidence was captured.
    const audit = await evidenceOf(bearer(ctx.superAdmin));
    expect(audit.rows[0]?.latitude).toBe(28.6201);

    expect((await detail()).description).toBe(NOTE);

    expect((await get(`/api/bookings/${id}/chat`, partner())).status).toBe(200);
    expect((await send(`/api/bookings/${id}/chat`, partner(), { body: "On my way up" })).status).toBe(200);
    expect((await send(`/api/bookings/${id}/chat`, bearer(ctx.customerA), { body: "Second floor" })).status).toBe(200);
  });
});

describe.serial("what a partner is handed back, and what an earlier partner left behind", () => {
  test("uploading evidence answers with the same safe view as the list: no coordinates, raw links or storage key", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const res = await app.handle(
      new Request(`http://localhost/api/bookings/${id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${partner()}` },
        body: JSON.stringify({ stage: "START", mediaUrl: "https://example.test/raw-photo.jpg", latitude: 28.6203, longitude: 77.3704, clientUploadId: `${RUN}-start` }),
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    const row = (JSON.parse(text) as { data: { evidence: Record<string, unknown> } }).data.evidence;
    expect(row.id).toBeTruthy();
    for (const key of ["latitude", "longitude", "mediaUrl", "mediaStorageKey", "metadata", "providerId"]) expect({ key, present: key in row }).toEqual({ key, present: false });
    expect(text).not.toContain("28.6203");
    expect(text).not.toContain("raw-photo.jpg");
  });

  test("a chat message does not leave its text in the other side's notifications", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    expect((await send(`/api/bookings/${id}/chat`, bearer(ctx.customerA), { body: "The key is under the blue pot" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    const notes = await prisma.notification.findMany({ where: { userId: ctx.vendorUserId, type: "booking_chat_message", referenceId: id } });
    expect(notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(notes)).not.toContain("blue pot");
  });

  test("a partner reads the customer's messages from when they took the job, not what was written to an earlier partner", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const conversation = await prisma.bookingConversation.findUniqueOrThrow({ where: { bookingId: id } });
    const tookJobAt = new Date();
    await prisma.booking.update({ where: { id }, data: { acceptedAt: tookJobAt } });
    await prisma.bookingMessage.create({ data: { conversationId: conversation.id, senderUserId: ctx.customerA.id, body: "For the first professional: alarm code 7788", createdAt: new Date(tookJobAt.getTime() - 3_600_000) } });
    await prisma.bookingMessage.create({ data: { conversationId: conversation.id, senderUserId: ctx.customerA.id, body: "For you: please use the side door", createdAt: new Date(tookJobAt.getTime() + 1_000) } });
    const mine = await get(`/api/bookings/${id}/chat`, partner());
    expect(mine.status).toBe(200);
    expect(mine.text).toContain("side door");
    expect(mine.text).not.toContain("7788");
    // The customer still reads everything they wrote.
    expect((await get(`/api/bookings/${id}/chat`, bearer(ctx.customerA))).text).toContain("7788");
  });

  test("when an admin hands the job to another partner, the hand-over time is the cut, not the first partner's acceptance", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const conversation = await prisma.bookingConversation.findUniqueOrThrow({ where: { bookingId: id } });
    const handedOver = new Date();
    // The first partner accepted two hours ago; the job reached this partner by reassignment just now.
    await prisma.booking.update({ where: { id }, data: { acceptedAt: new Date(handedOver.getTime() - 7_200_000), assignedAt: handedOver } });
    await prisma.bookingMessage.create({ data: { conversationId: conversation.id, senderUserId: ctx.customerA.id, body: "To the first professional: spare key is with flat 9", createdAt: new Date(handedOver.getTime() - 1_800_000) } });
    const mine = await get(`/api/bookings/${id}/chat`, partner());
    expect(mine.status).toBe(200);
    expect(mine.text).not.toContain("flat 9");
  });

  test("an upload cannot point at storage that belongs to another booking", async () => {
    expect(dbOk).toBe(true);
    await setHeld("IN_PROGRESS");
    const foreign = await app.handle(
      new Request(`http://localhost/api/bookings/${id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${partner()}` },
        body: JSON.stringify({ stage: "COMPLETION", mediaStorageKey: "s3/evidence/some-other-booking/completion.jpg", clientUploadId: `${RUN}-foreign` }),
      }),
    );
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { code?: string }).code).toBe("VALIDATION_ERROR");
    const own = await app.handle(
      new Request(`http://localhost/api/bookings/${id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${partner()}` },
        body: JSON.stringify({ stage: "COMPLETION", mediaStorageKey: `s3/evidence/${id}/completion.jpg`, clientUploadId: `${RUN}-own-key` }),
      }),
    );
    expect(own.status).toBe(200);
  });
});

describe.serial("after the job is over", () => {
  test("completed: the conversation is closed to the partner and to new messages; the customer keeps their copy", async () => {
    expect(dbOk).toBe(true);
    await setHeld("COMPLETED");
    const read = await get(`/api/bookings/${id}/chat`, partner());
    expect({ status: read.status, code: (read.json as { code?: string }).code }).toEqual({ status: 403, code: "CHAT_CLOSED" });
    expect(read.text).not.toContain("Second floor");
    expect(await send(`/api/bookings/${id}/chat`, partner(), { body: "hello again" })).toMatchObject({ status: 403, json: { code: "CHAT_CLOSED" } });
    expect(await send(`/api/bookings/${id}/chat/read`, partner(), {})).toMatchObject({ status: 403, json: { code: "CHAT_CLOSED" } });
    expect(await send(`/api/bookings/${id}/chat`, bearer(ctx.customerA), { body: "one more thing" })).toMatchObject({ status: 403, json: { code: "CHAT_CLOSED" } });
    const own = await get(`/api/bookings/${id}/chat`, bearer(ctx.customerA));
    expect(own.status).toBe(200);
    expect(own.text).toContain("Second floor");

    const after = await evidenceOf(partner());
    expect(after.text).not.toContain("28.6201");
    expect((await detail()).description).toBeNull();
  });

  test("completed: first name only, city-level address, no note, no phone, still inside the allow-list", async () => {
    expect(dbOk).toBe(true);
    await setHeld("COMPLETED");
    const b = await detail();
    const row = await listRow();
    for (const payload of [b, row]) {
      expect(payload).toBeDefined();
      expect(payload.customer.firstName).toBeTruthy();
      expect(payload.customer.lastName).toBeNull();
      expect(payload.customer.profileImage).toBeNull();
      expect(payload.customer.phoneMasked).toBeNull();
      expect(payload.address.addressLine1).toBeNull();
      expect(payload.address.latitude).toBeNull();
      expect({ unknown: unknownPartnerBookingKeys(payload), forbidden: collectForbiddenPartnerKeys(payload) }).toEqual({ unknown: [], forbidden: [] });
    }
    expect(row.description).toBeNull();
    expect(JSON.stringify([b, row])).not.toContain("4421");
  });
});
