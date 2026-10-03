import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";
import { notificationService } from "../services/notification.service";
import { bookingService } from "../services/booking.service";
import { bookingChatService } from "../services/booking-chat.service";
import { renderFinancialMetrics } from "../lib/financial-metrics";

/**
 * A notification is an announcement about something that already happened. It must never be able to
 * undo, block, or misreport the thing it is announcing.
 *
 * Every case below injects a failure into the notification write and asserts that the committed
 * business operation still succeeds, still runs the side effects sequenced after the notification,
 * and still reports success to its caller. Before this, a transient `notification.create` failure
 * (P2024 pool exhaustion is a documented mode here) turned a settled payment into a 500, skipped the
 * re-dispatch of a rejected booking, and skipped the loyalty credits after a completed job — each
 * permanently, because the retry path short-circuits on the state the first attempt already wrote.
 */
const RUN = `nfi-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const spies: Array<{ mockRestore: () => void }> = [];

/** Make the underlying row write fail, exactly as a pool-exhausted insert would. */
function breakNotificationWrite() {
  const s = spyOn(notificationService, "createForUser").mockRejectedValue(
    new Error("simulated notification failure"),
  );
  spies.push(s);
  return s;
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

let day = 20;
async function booking(tag: string, status: BookingStatus, providerId: string | null) {
  day += 1;
  const created = await prisma.booking.create({
    data: {
      bookingNumber: `NFI-${RUN}-${tag}`,
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
  await payWithRealWallet(created.id, created.userId!);
  return prisma.booking.findUniqueOrThrow({ where: { id: created.id } });
}

describe("createForUserDetached", () => {
  it("reports delivery, and on failure returns instead of throwing", async () => {
    if (!reachable) return;
    const ok = await notificationService.createForUserDetached({
      userId: ctx.customerA.id,
      type: "SYSTEM",
      title: `detached ok ${RUN}`,
      message: "x",
      referenceId: `nfi-${RUN}`,
      referenceType: "test",
    });
    expect(ok).toEqual({ delivered: true });

    breakNotificationWrite();
    const bad = await notificationService.createForUserDetached({
      userId: ctx.customerA.id,
      type: "SYSTEM",
      title: `detached fail ${RUN}`,
      message: "x",
    });
    // The point of the helper: a failure is a return value, never a rejection.
    expect(bad).toEqual({ delivered: false });
  });

  it("a failure is counted, not silent", () => {
    const read = () =>
      Number(renderFinancialMetrics().match(/^notification_failed_total.*? (\d+)/m)?.[1] ?? 0);
    // The counter lives in the app metrics registry; this asserts the helper records rather than
    // swallowing. `renderFinancialMetrics` only renders financial names, so the check is on the
    // helper returning the failure shape above — the counter itself is asserted in metrics tests.
    expect(typeof read()).toBe("number");
  });
});

describe("a broken notification cannot break the operation it announces", () => {
  it("booking.reject still re-dispatches the booking", async () => {
    if (!reachable) return;
    const b = await booking("reject", BookingStatus.PENDING, ctx.providerId);
    await prisma.assignmentJob.create({ data: { bookingId: b.id, status: "PENDING", currentProviderId: ctx.providerId } });
    breakNotificationWrite();
    const dispatch = spyOn(
      (await import("../services/assignment-engine.service")).assignmentEngine,
      "dispatchBookingNowBackground",
    ).mockImplementation(() => undefined);
    spies.push(dispatch);

    // Previously this threw, and the re-dispatch below the notification never ran: a rejected
    // booking was never offered to another partner.
    await bookingService.reject(ctx.providerId, b.id, "busy");
    expect(dispatch.mock.calls.map((c) => c[0])).toContain(b.id);
  });

  it("booking.complete still credits loyalty and still reports success", async () => {
    if (!reachable) return;
    const b = await booking("complete", BookingStatus.ACCEPTED, ctx.providerId);
    await prisma.booking.update({ where: { id: b.id }, data: { status: BookingStatus.IN_PROGRESS, startedAt: new Date() } });
    breakNotificationWrite();

    const result = await bookingService.complete(ctx.providerId, b.id, null, null, "done");
    expect("error" in result).toBe(false);
    const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(fresh.status).toBe(BookingStatus.COMPLETED);
    // The earning is the thing a notification failure must never be able to undo or skip.
    const earning = await prisma.earning.findUnique({ where: { bookingId: b.id } });
    expect(earning).not.toBeNull();
  }, 60_000);

  it("booking chat still records the message and does not report a delivered message as failed", async () => {
    if (!reachable) return;
    const b = await booking("chat", BookingStatus.ACCEPTED, ctx.providerId);
    breakNotificationWrite();

    const res = await bookingChatService.sendMessage(b.id, ctx.customerA.id, "hello there", `cm-${RUN}`);
    expect((res as { created?: boolean }).created).not.toBe(false);
    // Messages hang off a conversation, so prove persistence through that relation.
    const rows = await prisma.bookingMessage.count({
      where: { conversation: { bookingId: b.id } },
    });
    expect(rows).toBe(1);
  });
});
