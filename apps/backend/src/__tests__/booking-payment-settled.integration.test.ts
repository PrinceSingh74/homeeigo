import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { AssignmentJobStatus, BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { assignmentEngine } from "../services/assignment-engine.service";
import { roomManager } from "../lib/websocket";
import { onBookingPaymentSettled } from "../lib/booking-payment-settled";

/**
 * When a payment settles, an unassigned PENDING booking must be (re)dispatched and every surface
 * must receive the status frame. Dispatch is not triggered for a booking that already has a
 * partner.
 */
const RUN = `pset-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const spies: Array<{ mockRestore: () => void }> = [];

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

let slotOffsetDays = 1;
/**
 * DELIBERATELY hand-set as paid. Every other suite settles wallet bookings through the real checkout
 * (`payWithRealWallet`); this one cannot. Its subject is `onBookingPaymentSettled` — the hook the real
 * checkout itself fires in the background — so paying through the checkout would run the code under
 * test before its spies exist, and would move a partnered booking to ACCEPTED, which is exactly the
 * state the second case asserts the hook leaves alone. The paid status here is the hook's INPUT; no
 * money path reads it.
 */
async function pendingBooking(tag: string, providerId: string | null) {
  // Each booking gets its own day: the customer slot-exclusion constraint refuses overlaps.
  slotOffsetDays += 1;
  return prisma.booking.create({
    data: {
      bookingNumber: `PSET-${RUN}-${tag}`,
      userId: ctx.customerA.id,
      providerId,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: BookingStatus.PENDING,
      scheduledDate: new Date(Date.now() + slotOffsetDays * 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "wallet",
    },
  });
}

describe("onBookingPaymentSettled", () => {
  it("re-dispatches an unassigned PENDING booking and publishes the status frame", async () => {
    if (!reachable) return;
    const booking = await pendingBooking("unassigned", null);
    await prisma.assignmentJob.create({ data: { bookingId: booking.id, status: AssignmentJobStatus.PENDING } });

    const dispatch = spyOn(assignmentEngine, "dispatchBookingNowBackground").mockImplementation(() => undefined);
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
    const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
    spies.push(dispatch, broadcast, sendToUser);

    await onBookingPaymentSettled(booking.id, "test");

    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([booking.id]);
    const room = broadcast.mock.calls.find((c) => c[0] === `booking:${booking.id}`);
    expect(room).toBeDefined();
    expect(room![1].data.status).toBe("pending");
    expect(room![1].data.paymentStatus).toBe("success");
    expect(sendToUser.mock.calls.map((c) => c[0])).toContain(ctx.customerA.id);
  });

  it("does not dispatch a booking that already has a partner", async () => {
    if (!reachable) return;
    const booking = await pendingBooking("assigned", ctx.providerId);
    const dispatch = spyOn(assignmentEngine, "dispatchBookingNowBackground").mockImplementation(() => undefined);
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
    const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
    spies.push(dispatch, broadcast, sendToUser);

    await onBookingPaymentSettled(booking.id, "test");
    expect(dispatch.mock.calls.length).toBe(0);
    // Partner's user room is told as well, since the booking is theirs.
    expect(sendToUser.mock.calls.map((c) => c[0]).sort()).toEqual([ctx.customerA.id, ctx.vendorUserId].sort());
  });

  it("is a no-op for an unknown booking and never throws", async () => {
    if (!reachable) return;
    const dispatch = spyOn(assignmentEngine, "dispatchBookingNowBackground").mockImplementation(() => undefined);
    spies.push(dispatch);
    await expect(onBookingPaymentSettled("does-not-exist", "test")).resolves.toBeUndefined();
    expect(dispatch.mock.calls.length).toBe(0);
  });
});
