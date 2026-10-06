/**
 * Booking creation refuses a request without a server quote. Every production caller of
 * `bookingService.create` must therefore be able to satisfy it: the main route already did; the
 * provider-specific route dropped the token on the floor and the assistant's booking tool never had
 * one, so both answered QUOTE_REQUIRED to every request.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { registerToolHandlers } from "../ai-tools/execution/handlers";
import { TOOL_CATALOG } from "../ai-tools/registry/tool-catalog";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `qcall-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function post(path: string, body: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { success?: boolean; code?: string; quote?: { quoteToken?: string }; data?: any } };
}

describe.serial("POST /api/providers/:id/book", () => {
  const body = () => ({ serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(300).toISOString() });

  test("without a quote it is refused and the answer carries the current quote", async () => {
    expect(dbOk).toBe(true);
    const r = await post(`/api/providers/${ctx.providerId}/book`, body());
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("QUOTE_REQUIRED");
    expect(typeof r.json.quote?.quoteToken).toBe("string");
  });

  test("with the token from the quote route the request gets past the quote gate", async () => {
    expect(dbOk).toBe(true);
    const b = body();
    const quoted = await post("/api/bookings/price-quote", { serviceId: b.serviceId, addressId: b.addressId, quantity: b.quantity });
    const token = quoted.json.data?.quote?.quoteToken as string | undefined;
    expect(typeof token).toBe("string");
    const r = await post(`/api/providers/${ctx.providerId}/book`, { ...b, quoteToken: token });
    // Whatever else the server decides about this provider and slot, it is no longer a quote refusal.
    expect(["QUOTE_REQUIRED", "QUOTE_MISMATCH", "QUOTE_INVALID", "QUOTE_EXPIRED", "PRICE_CHANGED"]).not.toContain(r.json.code ?? "");
    expect(r.status).toBe(201);
    expect(r.json.data?.booking?.id ?? r.json.data?.id).toBeTruthy();
  });
});

describe.serial("the assistant's booking tool", () => {
  type ToolResult = { status?: string; booked?: boolean; error?: string; booking?: { id: string }; confirmedTotalPaise?: number; quote?: { total: number; totalPaise: number } };
  const slot = () => futureSlot(330).toISOString();
  const bookings = () => prisma.booking.count({ where: { userId: ctx.customerA.id, scheduledDate: new Date(slot()) } });
  async function run(extra: Record<string, unknown> = {}): Promise<ToolResult> {
    const entry = registerToolHandlers(TOOL_CATALOG as Parameters<typeof registerToolHandlers>[0]).find((t) => t.toolId === "write.booking.createBooking");
    if (!entry?.handler) throw new Error("write.booking.createBooking has no handler bound");
    return (await entry.handler({
      actor: { actorId: ctx.customerA.id, actorRole: "CUSTOMER" } as never,
      arguments: { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: slot(), ...extra },
      executionId: `exec-${RUN}`,
    } as never)) as ToolResult;
  }

  test("the first call books nothing: it returns the server's total for the customer to confirm", async () => {
    expect(dbOk).toBe(true);
    const r = await run();
    expect(r.status).toBe("CONFIRMATION_REQUIRED");
    expect(r.booked).toBe(false);
    expect(r.booking).toBeUndefined();
    expect(r.quote?.totalPaise).toBeGreaterThan(0);
    expect(r.confirmedTotalPaise).toBe(r.quote?.totalPaise);
    expect(await bookings()).toBe(0);
  });

  test("a confirmed total that is not the server's total books nothing and returns the real one", async () => {
    expect(dbOk).toBe(true);
    const first = await run();
    const r = await run({ confirmedTotalPaise: (first.confirmedTotalPaise ?? 0) - 100 });
    expect(r.status).toBe("PRICE_CHANGED");
    expect(r.booked).toBe(false);
    expect(r.confirmedTotalPaise).toBe(first.confirmedTotalPaise);
    expect(await bookings()).toBe(0);
    for (const bad of ["abc", 12.5, -1]) expect((await run({ confirmedTotalPaise: bad })).booked).toBe(false);
    expect(await bookings()).toBe(0);
  });

  test("with the total the customer confirmed, it books at exactly that total", async () => {
    expect(dbOk).toBe(true);
    const first = await run();
    const r = await run({ confirmedTotalPaise: first.confirmedTotalPaise });
    expect(r.error).toBeUndefined();
    expect(r.booking?.id).toBeTruthy();
    const saved = await prisma.booking.findUniqueOrThrow({ where: { id: r.booking!.id }, select: { finalAmount: true } });
    expect(Math.round(saved.finalAmount * 100)).toBe(first.confirmedTotalPaise!);
  });
});
