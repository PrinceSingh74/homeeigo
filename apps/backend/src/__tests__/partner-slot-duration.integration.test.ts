/**
 * Owner decision D1 (2026-09-21), option B — the partner calendar reserves the appointment:
 *   [start − 30 min, start + slot_duration_minutes + 30 min)
 * slot_duration_minutes is frozen on the booking at creation; NULL (every booking made before the
 * change) is the legacy fixed 60-minute block and is never re-slotted. Services whose duration is a
 * turnaround time (partner_slot_policy = FIXED, e.g. laundry) keep the fixed block.
 *
 * The legacy behaviour for NULL rows stays pinned by scheduling-contract.characterization.test.ts.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { reservedWindow, slotDurationFor } from "../services/booking-validation.service";

const RUN = `slotd1-${Date.now().toString(36)}`;
const MIN = 60_000;
let ctx: AdvCtx;
/** A second, unrelated partner (own fixture set) — partners never block each other. */
let ctx2: AdvCtx;
let dbOk = false;
let seq = 0;
const BASE = new Date(Date.UTC(2032, 2, 10, 4, 0, 0));
const at = (m: number) => new Date(BASE.getTime() + m * MIN);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  ctx2 = await seedAdversarialFixtures(`${RUN}-p2`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });
  await cleanupAdversarialFixtures(`${RUN}-p2`);
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function insert(startMin: number, slotMinutes: number | null, user: "A" | "B" = "A", providerId?: string) {
  const id = `${RUN}-b-${++seq}`;
  const u = user === "B" ? ctx.customerB : ctx.customerA;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                             estimated_duration, slot_duration_minutes, base_amount, final_amount, total_amount, status, updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 240, $8, 100, 100, 100, 'ACCEPTED'::"BookingStatus", NOW(), NOW())`,
      id,
      `${id}-BN`,
      u.id,
      providerId ?? ctx.providerId,
      ctx.serviceId,
      user === "B" ? ctx.addressBId : ctx.addressAId,
      at(startMin),
      slotMinutes,
    );
    return { ok: true as const, id };
  } catch (e) {
    const sqlState = (e as { meta?: { code?: string } }).meta?.code;
    return { ok: false as const, code: /23P01|exclusion/i.test(String(e)) ? "23P01" : sqlState ?? String(e).slice(-160) };
  }
}
const slot = async (id: string) =>
  (await prisma.$queryRaw<{ s: Date; e: Date }[]>`SELECT provider_slot_start AS s, provider_slot_end AS e FROM bookings WHERE id = ${id}`)[0]!;
const clear = () => prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });

describe("reserved window rule (pure)", () => {
  test("DURATION reserves the appointment + 30 min each side; FIXED and legacy keep 60 minutes", () => {
    const s = new Date("2032-01-01T10:00:00Z");
    expect(reservedWindow(s, 240)).toEqual({ start: new Date("2032-01-01T09:30:00Z"), end: new Date("2032-01-01T14:30:00Z") });
    expect(reservedWindow(s, null)).toEqual({ start: new Date("2032-01-01T09:30:00Z"), end: new Date("2032-01-01T10:30:00Z") });
    expect(slotDurationFor("FIXED", 2400)).toBe(0);
    expect(slotDurationFor("DURATION", 180)).toBe(180);
  });
});

describe.serial("database contract (trigger + exclusion)", () => {
  test("a 4-hour booking reserves 5 hours: [start − 30, start + 4 h + 30)", async () => {
    if (!dbOk) return;
    await clear();
    const r = await insert(0, 240);
    expect(r.ok).toBe(true);
    const w = await slot((r as { id: string }).id);
    expect(w.s.getTime()).toBe(at(-30).getTime());
    expect(w.e.getTime()).toBe(at(270).getTime());
  });
  test("hours 2–4 of a long job are no longer bookable for the same partner (the D1 defect)", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 240)).ok).toBe(true);
    expect(await insert(60, 60, "B")).toMatchObject({ ok: false, code: "23P01" });
    expect(await insert(180, 60, "B")).toMatchObject({ ok: false, code: "23P01" });
  });
  test("the next job may start once the reserved window ends (half-open touch)", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 240)).ok).toBe(true);
    // old window ends at +270; new window starts at 300 − 30 = 270 → touch, allowed.
    expect((await insert(300, 60, "B")).ok).toBe(true);
    expect(await insert(299, 60, "B")).toMatchObject({ ok: false, code: "23P01" });
  });
  test("NULL (pre-change bookings) keeps the legacy 60-minute window, even after status updates", async () => {
    if (!dbOk) return;
    await clear();
    const r = await insert(0, null);
    const id = (r as { id: string }).id;
    await prisma.$executeRawUnsafe(`UPDATE bookings SET status = 'IN_PROGRESS'::"BookingStatus" WHERE id = $1`, id);
    const w = await slot(id);
    expect((w.e.getTime() - w.s.getTime()) / MIN).toBe(60);
  });
  test("reschedule moves the window and keeps its length", async () => {
    if (!dbOk) return;
    await clear();
    const r = await insert(0, 120);
    const id = (r as { id: string }).id;
    await prisma.$executeRawUnsafe(`UPDATE bookings SET scheduled_date = $2 WHERE id = $1`, id, at(600));
    const w = await slot(id);
    expect(w.s.getTime()).toBe(at(570).getTime());
    expect(w.e.getTime()).toBe(at(750).getTime());
  });
  test("a 120-minute appointment: exact half-open boundaries on both sides", async () => {
    if (!dbOk) return;
    await clear();
    // window [−30, 150). A 60-min probe at s reserves [s − 30, s + 90).
    expect((await insert(0, 120)).ok).toBe(true);
    expect((await insert(180, 60, "B")).ok).toBe(true); // starts exactly at 150 → touch
    expect(await insert(179, 60, "B")).toMatchObject({ ok: false, code: "23P01" }); // 1 minute into the window
    await clear();
    expect((await insert(0, 120)).ok).toBe(true);
    expect((await insert(-120, 60, "B")).ok).toBe(true); // ends exactly at −30 → touch
    expect(await insert(-119, 60, "B")).toMatchObject({ ok: false, code: "23P01" });
  });
  test("a FIXED (0-minute occupancy) booking keeps the 60-minute block, boundaries exact", async () => {
    if (!dbOk) return;
    await clear();
    // window [−30, 30). The next FIXED booking at s reserves [s − 30, s + 30).
    expect((await insert(0, 0)).ok).toBe(true);
    expect((await insert(60, 0, "B")).ok).toBe(true);
    expect(await insert(59, 0, "B")).toMatchObject({ ok: false, code: "23P01" });
    // …and the block does not stretch to the row's long estimated_duration (240 on every inserted row).
    const fixed = await insert(600, 0);
    expect(fixed.ok).toBe(true);
    const w = await slot((fixed as { id: string }).id);
    expect((w.e.getTime() - w.s.getTime()) / MIN).toBe(60);
  });
  test("different partners never block each other at the same time", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 240, "A")).ok).toBe(true);
    expect((await insert(0, 240, "B", ctx2.providerId)).ok).toBe(true);
    expect((await insert(60, 60, "B", ctx2.providerId)).ok).toBe(false); // …but the second partner blocks itself
  });
  test("cancelled, rejected and completed bookings release the partner's window", async () => {
    if (!dbOk) return;
    for (const status of ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "COMPLETED"] as const) {
      await clear();
      const r = await insert(0, 240);
      const id = (r as { id: string }).id;
      expect(await insert(60, 60, "B")).toMatchObject({ ok: false, code: "23P01" });
      // booking_completed_requires_timestamp: a COMPLETED row must carry completed_at.
      await prisma.$executeRawUnsafe(
        `UPDATE bookings SET status = $2::"BookingStatus",
                completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
          WHERE id = $1`,
        id,
        status,
      );
      const w = await slot(id);
      expect(w.s).toBeNull();
      expect(w.e).toBeNull();
      expect((await insert(60, 60, "B")).ok).toBe(true);
    }
  });
  test("concurrent overlapping inserts for one partner: exactly one wins, every round", async () => {
    if (!dbOk) return;
    await clear();
    for (let round = 0; round < 5; round++) {
      const t = 3000 + round * 600;
      const results = await Promise.all([insert(t, 120, "A"), insert(t + 30, 120, "B")]);
      // Raw SQL bypasses the app's per-provider advisory lock, so the loser is either the exclusion
      // violation (23P01) or Postgres breaking the two pending exclusion checks' wait cycle (40P01).
      // Either way it is refused: two winners is the only failure.
      const outcomes = results.map((x) => (x.ok ? "ok" : x.code));
      expect(outcomes.filter((o) => o === "ok").length).toBe(1);
      expect(outcomes.filter((o) => o !== "ok").every((o) => o === "23P01" || o === "40P01")).toBe(true);
    }
  });
  test("slot minutes are bounded", async () => {
    if (!dbOk) return;
    expect((await insert(2000, -5)).ok).toBe(false);
    expect((await insert(2100, 20000)).ok).toBe(false);
    await clear();
  });
});

describe.serial("booking API path", () => {
  // The booking API only accepts near-future dates; the raw-SQL contract above can use 2032.
  const API_BASE = futureSlot(24 * 9);
  const apiAt = (m: number) => new Date(API_BASE.getTime() + m * MIN);
  async function book(startMin: number, extra: Record<string, unknown> = {}, who = ctx.customerA, addressId = ctx.addressAId) {
    const scheduledDate = apiAt(startMin).toISOString();
    const quoteRes = await app.handle(
      new Request("http://localhost/api/bookings/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(who)}` },
        body: JSON.stringify({ serviceId: ctx.serviceId, addressId, scheduledDate, ...extra }),
      }),
    );
    const quoteJson = (await quoteRes.json()) as { data?: { quote?: { quoteToken?: string } } };
    const res = await app.handle(
      new Request("http://localhost/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(who)}` },
        body: JSON.stringify({
          serviceId: ctx.serviceId,
          addressId,
          scheduledDate,
          providerId: ctx.providerId,
          quoteToken: quoteJson.data?.quote?.quoteToken,
          ...extra,
        }),
      }),
    );
    return { status: res.status, json: (await res.json()) as any };
  }
  test("a DURATION service freezes its appointment minutes on the booking and blocks the partner for them", async () => {
    if (!dbOk) return;
    await clear();
    await prisma.service.update({
      where: { id: ctx.serviceId },
      data: {
        partnerSlotPolicy: "DURATION",
        pricingModel: "hourly",
        catalogConfig: { bookingMode: "HOURLY", quantity: { type: "HOUR", unitLabel: "hour", min: 1, max: 4, step: 1, unitPrice: 200 } } as Prisma.InputJsonValue,
      },
    });
    const first = await book(0, { quantity: 3 });
    expect([200, 201]).toContain(first.status);
    const id = first.json.data.booking?.id ?? first.json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.estimatedDuration).toBe(180);
    expect(row.slotDurationMinutes).toBe(180);
    // Another customer, same partner, 90 minutes in: refused by the application check (typed), not a raw DB error.
    const clash = await book(90, { quantity: 1 }, ctx.customerB, ctx.addressBId);
    expect(clash.status).toBe(400);
    expect(clash.json.code).toBe("PROVIDER_UNAVAILABLE");
    // After the window (0 + 180 + 30 = 210; next start − 30 ≥ 210).
    const after = await book(240, { quantity: 1 }, ctx.customerB, ctx.addressBId);
    expect([200, 201]).toContain(after.status);
    await prisma.booking.deleteMany({ where: { serviceId: ctx.serviceId, scheduledDate: { gte: apiAt(-60) } } });
  });
  test("a FIXED (turnaround) service keeps the 60-minute visit block", async () => {
    if (!dbOk) return;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { partnerSlotPolicy: "FIXED" } });
    const r = await book(1440, { quantity: 4 });
    expect([200, 201]).toContain(r.status);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.estimatedDuration).toBe(240);
    expect(row.slotDurationMinutes).toBe(0);
    const w = await slot(id);
    expect((w.e.getTime() - w.s.getTime()) / MIN).toBe(60);
    await prisma.booking.deleteMany({ where: { serviceId: ctx.serviceId, scheduledDate: { gte: apiAt(1380) } } });
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { partnerSlotPolicy: "DURATION" } });
  });
  test("two customers racing for overlapping slots with one partner: one booking, one typed refusal", async () => {
    if (!dbOk) return;
    await heartbeatFresh(ctx);
    const [a, b] = await Promise.all([
      book(2880, { quantity: 2 }),
      book(2910, { quantity: 2 }, ctx.customerB, ctx.addressBId),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBeLessThan(300); // exactly one created (200/201)
    expect(statuses[1]).toBe(400);
    const loser = a.status === 400 ? a : b;
    expect(loser.json.code).toBe("PROVIDER_UNAVAILABLE"); // typed by the app lock, never a raw DB error
    const rows = await prisma.booking.count({ where: { providerId: ctx.providerId, scheduledDate: { gte: apiAt(2800), lte: apiAt(3000) } } });
    expect(rows).toBe(1);
    await prisma.booking.deleteMany({ where: { serviceId: ctx.serviceId, scheduledDate: { gte: apiAt(2800) } } });
  });
});
