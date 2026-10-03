/**
 * CHARACTERIZATION — the partner-calendar contract as it exists today (Phase 2 stabilization).
 *
 * This file does NOT endorse the rule; it pins what the platform enforces so a change to it is a
 * deliberate owner decision, not an accident. Source of the rule:
 *   - trigger bookings_sync_conflict_slots(): slot = [scheduled_date − 30m, scheduled_date + 30m)
 *     for active statuses, NULL otherwise (migration 20260609240000, half-open since 20260909090000);
 *   - EXCLUDE bookings_provider_slot_excl / bookings_user_slot_excl over that range;
 *   - booking-validation.service BOOKING_BUFFER_MINUTES = 30 ("60 minutes apart is the tightest
 *     LEGAL back-to-back pair"), and owner decisions #10/#11 (capacity-concurrency-decision.test.ts).
 * No layer reads estimated_duration. Consequence (the open product question): a 4-hour booking
 * blocks its partner for ONE hour around its start, not four.
 *
 * If the owner adopts duration-aware blocking, this file must change with the trigger — that is
 * the point of it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `sched-${Date.now().toString(36)}`;
const MIN = 60_000;
let ctx: AdvCtx;
let dbOk = false;
let seq = 0;
// A day well in the future, on the hour, so nothing else in the fixture set collides.
const BASE = new Date(Date.UTC(2031, 0, 15, 4, 0, 0));
const at = (minutes: number) => new Date(BASE.getTime() + minutes * MIN);

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

/** Insert straight through the enforcement layer (trigger + EXCLUDE), like capacity-concurrency-decision. */
async function insert(
  startMin: number,
  durationMin: number,
  opts: { user?: "A" | "B"; status?: string } = {},
): Promise<{ ok: true; id: string } | { ok: false; code: string }> {
  const id = `${RUN}-b-${++seq}`;
  const user = opts.user === "B" ? ctx.customerB : ctx.customerA;
  const address = opts.user === "B" ? ctx.addressBId : ctx.addressAId;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                             estimated_duration, base_amount, final_amount, total_amount, status, updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 100, 100, 100, $9::"BookingStatus", NOW(), NOW())`,
      id,
      `${id}-BN`,
      user.id,
      ctx.providerId,
      ctx.serviceId,
      address,
      at(startMin),
      durationMin,
      opts.status ?? "ACCEPTED",
    );
    return { ok: true, id };
  } catch (e) {
    const code =
      e instanceof Prisma.PrismaClientKnownRequestError
        ? String((e.meta as { code?: string } | undefined)?.code ?? /Code: `(\w+)`/.exec(e.message)?.[1] ?? e.code)
        : /23P01|exclusion/i.test(String(e))
          ? "23P01"
          : String(e).slice(0, 80);
    return { ok: false, code };
  }
}

async function clear() {
  await prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });
}

const conflict = (r: Awaited<ReturnType<typeof insert>>) => !r.ok && /23P01/.test(r.code);

describe.serial("partner calendar contract (characterization)", () => {
  test("1–3: 1 h, 2 h and 4 h bookings all get the same 60-minute slot — duration is not read", async () => {
    if (!dbOk) return;
    await clear();
    for (const [i, dur] of [60, 120, 240].entries()) {
      const r = await insert(i * 600, dur, { user: i % 2 ? "B" : "A" });
      expect(r.ok).toBe(true);
      const [row] = await prisma.$queryRaw<{ s: Date; e: Date }[]>`
        SELECT provider_slot_start AS s, provider_slot_end AS e FROM bookings WHERE id = ${(r as { id: string }).id}`;
      expect((row!.e.getTime() - row!.s.getTime()) / MIN).toBe(60);
      expect(row!.s.getTime()).toBe(at(i * 600 - 30).getTime());
    }
  });

  test("4: exact boundary — a booking 60 min after another is allowed (half-open touch)", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 60)).ok).toBe(true);
    expect((await insert(60, 60, { user: "B" })).ok).toBe(true);
  });

  test("5: partial overlap — 30 and 59 min after start are rejected for the partner", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 60)).ok).toBe(true);
    expect(conflict(await insert(30, 60, { user: "B" }))).toBe(true);
    expect(conflict(await insert(59, 60, { user: "B" }))).toBe(true);
  });

  test("6: containment — a job starting inside a 4-hour booking's hours 2–4 is ACCEPTED today", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 240)).ok).toBe(true);
    // 10:00–14:00 by duration; the partner is still bookable at 11:00, 12:00 and 13:00.
    expect((await insert(60, 60, { user: "B" })).ok).toBe(true);
    expect((await insert(180, 60, { user: "B" })).ok).toBe(true);
  });

  test("7: adjacent non-overlap after a 4-hour job is allowed", async () => {
    if (!dbOk) return;
    await clear();
    expect((await insert(0, 240)).ok).toBe(true);
    expect((await insert(240, 60, { user: "B" })).ok).toBe(true);
  });

  test("8: concurrent inserts for the same partner slot — exactly one wins, every other is refused", async () => {
    if (!dbOk) return;
    await clear();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => insert(i * 5, 240, { user: i % 2 ? "B" : "A" })),
    );
    expect(results.filter((r) => r.ok).length).toBe(1);
    // Raw racing inserts hit two exclusion constraints, so a loser is either an exclusion
    // violation or a deadlock victim — both refusals. (The booking path serializes with an
    // advisory lock before inserting, so it only ever sees the first.)
    const losers = results.filter((r) => !r.ok) as { ok: false; code: string }[];
    expect(losers.length).toBe(5);
    for (const l of losers) expect(["23P01", "40P01"]).toContain(l.code);
  });

  test("9: cancellation releases the slot; the same slot can be booked again", async () => {
    if (!dbOk) return;
    await clear();
    const first = await insert(0, 240);
    expect(first.ok).toBe(true);
    expect(conflict(await insert(10, 60, { user: "B" }))).toBe(true);
    await prisma.$executeRawUnsafe(
      `UPDATE bookings SET status = 'CANCELLED_BY_USER'::"BookingStatus" WHERE id = $1`,
      (first as { id: string }).id,
    );
    const [row] = await prisma.$queryRaw<{ s: Date | null }[]>`
      SELECT provider_slot_start AS s FROM bookings WHERE id = ${(first as { id: string }).id}`;
    expect(row!.s).toBeNull();
    expect((await insert(10, 60, { user: "B" })).ok).toBe(true);
  });

  test("10: reschedule recomputes the slot from the new start (still 60 min, duration ignored)", async () => {
    if (!dbOk) return;
    await clear();
    const r = await insert(0, 240);
    expect(r.ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE bookings SET scheduled_date = $2 WHERE id = $1`, (r as { id: string }).id, at(300));
    const [row] = await prisma.$queryRaw<{ s: Date; e: Date }[]>`
      SELECT provider_slot_start AS s, provider_slot_end AS e FROM bookings WHERE id = ${(r as { id: string }).id}`;
    expect(row!.s.getTime()).toBe(at(270).getTime());
    expect(row!.e.getTime()).toBe(at(330).getTime());
    // The old window is free again; the new one is taken.
    expect((await insert(0, 60, { user: "B" })).ok).toBe(true);
    // Overlap the new window without an identical start: an identical (provider, scheduled_date)
    // is refused earlier by the unique index bookings_provider_scheduled_active_key (23505), which a
    // test DB built by the old setup lacked — so this assertion only ever passed on a DB weaker than
    // production. 310 → slot 280–340 overlaps 270–330 and exercises the window exclusion itself.
    expect(conflict(await insert(310, 60, { user: "B" }))).toBe(true);
    await clear();
  });
});
