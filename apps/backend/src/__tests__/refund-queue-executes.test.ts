/**
 * `refundWorkflowService.listQueue` must actually run.
 *
 * It did not. It `include`d a `payment` relation that `RefundRequest` does not have, so every call
 * threw a Prisma validation error and the admin refund queue answered 500. Three things let that
 * survive from Pass 2 to Pass 6:
 *
 *   - `tsc` passed: the `include` object was a variable, and TypeScript only checks excess
 *     properties on fresh object literals;
 *   - `refund-queue-priority.test.ts` asserted on the method's SOURCE TEXT, so it never executed it;
 *   - the dev backend was running a stale build, so the endpoint was never really called.
 *
 * So this test does the one thing none of those did: it calls the method against a database and
 * checks the shape the console depends on (`row.payment.bookingId`, used to address the retry).
 *
 * Runs against `homigo_test`. The single refund row it creates is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import prisma from "../lib/prisma";
import { refundWorkflowService } from "../services/refund-workflow.service";

const MARKER = `rq-exec-${Date.now()}`;
let refundId = "";
let expectedBookingId = "";

beforeAll(async () => {
  const payment = await prisma.payment.findFirst({ select: { id: true, userId: true, bookingId: true } });
  if (!payment) throw new Error("homigo_test has no payment rows; run `bun run test:setup` and seed first");
  expectedBookingId = payment.bookingId;
  const r = await prisma.refundRequest.create({
    data: {
      paymentId: payment.id,
      userId: payment.userId,
      amount: 1,
      reason: MARKER,
      // INDETERMINATE is the urgent bucket, so it is drawn first and lands inside any page size.
      status: "INDETERMINATE",
      requestedBy: payment.userId,
      idempotencyKey: MARKER,
      dataOrigin: "TEST",
      createdAt: new Date("2000-01-01T00:00:00Z"),
    },
    select: { id: true },
  });
  refundId = r.id;
});

afterAll(async () => {
  if (refundId) await prisma.refundRequest.delete({ where: { id: refundId } }).catch(() => undefined);
});

describe("refund queue — executes and carries the booking the retry needs", () => {
  it("the default (urgent-first) queue resolves and includes the row with its booking", async () => {
    const rows = await refundWorkflowService.listQueue();
    const mine = rows.find((r) => r.id === refundId);
    expect(mine).toBeDefined();
    expect(mine!.payment?.bookingId).toBe(expectedBookingId);
    expect(Array.isArray(mine!.audits)).toBe(true);
  });

  it("draws every urgent row before any non-urgent row", async () => {
    // The ordering contract, checked on the returned rows rather than on source text.
    const rows = await refundWorkflowService.listQueue(undefined, 500);
    const urgent = new Set(["INDETERMINATE", "PROCESSING"]);
    const firstNonUrgent = rows.findIndex((r) => !urgent.has(r.status));
    if (firstNonUrgent >= 0) {
      expect(rows.slice(firstNonUrgent).some((r) => urgent.has(r.status))).toBe(false);
    }
  });

  it("the status-filtered queue resolves with the same shape", async () => {
    const rows = await refundWorkflowService.listQueue("INDETERMINATE", 500);
    const mine = rows.find((r) => r.id === refundId);
    expect(mine?.payment?.bookingId).toBe(expectedBookingId);
  });
});
