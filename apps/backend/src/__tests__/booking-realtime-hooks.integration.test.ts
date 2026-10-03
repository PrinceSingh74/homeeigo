import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";
import { roomManager } from "../lib/websocket";
import { ADMIN_NOTIFICATIONS_ROOM } from "../lib/booking-realtime";
import { trackingService } from "../services/tracking.service";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";

/**
 * The state-machine owners must emit the realtime frame themselves. These are the transitions the
 * customer used to go blind on (en-route emitted nothing; cancel/admin actions emitted nothing
 * unless partner-web happened to re-send over WS).
 */
const RUN = `rthook-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const spies: Array<{ mockRestore: () => void }> = [];
let day = 1;

async function booking(tag: string, status: BookingStatus, providerId: string | null) {
  day += 1;
  const created = await prisma.booking.create({
    data: {
      bookingNumber: `RTH-${RUN}-${tag}`,
      userId: ctx.customerA.id,
      providerId,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status,
      acceptedAt: status === BookingStatus.ACCEPTED ? new Date() : undefined,
      assignedAt: status === BookingStatus.ACCEPTED ? new Date() : undefined,
      scheduledDate: new Date(Date.now() + day * 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.PENDING,
    },
  });
  // Paid through the real wallet checkout, not a hand-set "wallet" payment status.
  await payWithRealWalletDrainingItsFrame(created.id, created.userId!);
  return prisma.booking.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * Settling a payment publishes the booking's CURRENT status in the background
 * (lib/booking-payment-settled.ts) — for these fixtures, `accepted`. That frame belongs to the
 * fixture, not to the transition under test, and it is fire-and-forget, so it can land on EITHER
 * side of the checkout's await:
 *
 *   late  — it arrived ~0.5 s after the spies were armed and was picked up as the transition's
 *           frame ("expected en_route, received accepted", full-suite run 2026-09-20);
 *   early — it had already been broadcast before a recorder armed afterwards could see it, so
 *           waiting for it timed out and failed the run outright (10 s, run f1).
 *
 * Recording from BEFORE the payment covers both orders; a sleep covers neither, it only changes
 * which one is likely.
 */
async function payWithRealWalletDrainingItsFrame(bookingId: string, userId: string): Promise<void> {
  const seen = spyOn(roomManager, "broadcast"); // records; still calls through
  try {
    await payWithRealWallet(bookingId, userId);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (seen.mock.calls.some((c) => c[0] === `booking:${bookingId}`)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fixture payment-settled frame for ${bookingId} never arrived — the hook is silent`);
  } finally {
    seen.mockRestore();
  }
}

function armSpies() {
  const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
  const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
  spies.push(broadcast, sendToUser);
  return { broadcast, sendToUser };
}

async function settle() {
  // Publishers are fire-and-forget after commit; let the microtask + one DB round-trip drain.
  await new Promise((r) => setTimeout(r, 250));
}

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});
afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("booking transitions publish realtime frames", () => {
  it("commitEnRoute → en_route frame on booking room, both users and admin room", async () => {
    if (!reachable) return;
    const b = await booking("enroute", BookingStatus.ACCEPTED, ctx.providerId);
    const { broadcast, sendToUser } = armSpies();

    const applied = await trackingService.commitEnRoute({
      bookingId: b.id,
      providerId: ctx.providerId,
      distanceKm: 2.5,
      googleEtaMin: 9,
      source: "explicit_partner_action",
    });
    expect(applied).toBe(true);
    await settle();

    const room = broadcast.mock.calls.find((c) => c[0] === `booking:${b.id}`);
    expect(room?.[1].data.status).toBe("en_route");
    expect(room?.[1].data.eta).toBe(9);
    expect(broadcast.mock.calls.some((c) => c[0] === ADMIN_NOTIFICATIONS_ROOM)).toBe(true);
    expect(sendToUser.mock.calls.map((c) => c[0]).sort()).toEqual([ctx.customerA.id, ctx.vendorUserId].sort());

    // Idempotent transition → no second frame.
    broadcast.mockClear();
    const again = await trackingService.commitEnRoute({
      bookingId: b.id,
      providerId: ctx.providerId,
      distanceKm: 2.5,
      googleEtaMin: 9,
      source: "gps_geofence",
    });
    expect(again).toBe(false);
    await settle();
    expect(broadcast.mock.calls.some((c) => c[0] === `booking:${b.id}`)).toBe(false);
  });

  it("customer cancel → cancelled_by_user frame with refund fields", async () => {
    if (!reachable) return;
    const b = await booking("cancel", BookingStatus.PENDING, null);
    const { broadcast } = armSpies();

    const result = await bookingService.cancel({ userId: ctx.customerA.id }, b.id, "changed my mind");
    expect("error" in result).toBe(false);
    await settle();

    const room = broadcast.mock.calls.find((c) => c[0] === `booking:${b.id}`);
    expect(room).toBeDefined();
    expect(String(room![1].data.status)).toContain("cancelled");
    expect(room![1].data).toHaveProperty("refundAmount");
    expect(room![1].data.cancelledBy).toBe("user");
  });

  it("admin assign → assigned frame naming the partner", async () => {
    if (!reachable) return;
    const b = await booking("assign", BookingStatus.PENDING, null);
    const { broadcast, sendToUser } = armSpies();

    // The eligibility gate needs fresh presence; seed it so the call MUST succeed. A catch that
    // returned early here used to turn "reassignment threw" — the very failure this test exists
    // to catch — into a green run with zero assertions.
    await heartbeatFresh(ctx);
    await adminBookingOperationsService.reassignProvider(b.id, ctx.superAdmin.id, ctx.providerId, "manual assign");
    const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(fresh.status).toBe(BookingStatus.ASSIGNED);
    await settle();

    const room = broadcast.mock.calls.find((c) => c[0] === `booking:${b.id}`);
    expect(room?.[1].data.status).toBe("assigned");
    expect(room?.[1].data.providerId).toBe(ctx.providerId);
    expect(sendToUser.mock.calls.map((c) => c[0])).toContain(ctx.vendorUserId);
  });
});
