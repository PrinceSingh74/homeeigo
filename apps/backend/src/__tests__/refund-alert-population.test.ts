/**
 * The refund alerts must page on money a person can act on, and stay quiet about fixtures.
 *
 * Pass 3 added three refund alerts and verified them as "non-vacuous — every one fires on the
 * current state". They did fire. Pass 4 then measured the population they were firing on: **97.1%**
 * of `refund_requests` in the live database are certification or test artifacts, including **all
 * 250** FAILED rows and **all 53** INDETERMINATE ones. The alerts were correct, loaded, firing, and
 * pointing operators at test data.
 *
 * So "the alert fires" is not the property worth testing. The property worth testing is *which rows
 * make it fire*. This drives the real sampler through `renderMetrics()` and asserts on the exposed
 * series, because the alerts key on those series and nothing else.
 *
 * Runs against `homigo_test`. Every row is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import { renderMetrics } from "../lib/metrics";
import { initRefundBacklogMetricsAtZero, registerRefundBacklogSamplers } from "../lib/refund-backlog-metrics";

const MARKER = `refund-pop-${Date.now()}`;
/**
 * Refund rows only.
 *
 * `RefundRequest.paymentId` is a required FK, so an earlier version of this test built a whole
 * user → booking → payment chain per row and spent three iterations discovering required columns
 * (`baseAmount`, `address`, ...) that have nothing to do with what is being tested. The sampler
 * reads `refund_requests` and nothing else, so an existing payment is reused and the refund row is
 * the only thing created. Less setup is also less that can drift.
 */
const created: string[] = [];
let payment: { id: string; userId: string };

/** The exposed value of a gauge, or null when the series is absent. */
function gauge(metrics: string, name: string, labels?: string): number | null {
  const pattern = labels
    ? new RegExp(`^${name}\\{${labels}\\}\\s+(-?[\\d.e+]+)$`, "m")
    : new RegExp(`^${name}\\s+(-?[\\d.e+]+)$`, "m");
  const m = metrics.match(pattern);
  return m ? Number(m[1]) : null;
}

async function makeRefund(origin: DataOrigin | null, status: "INDETERMINATE" | "FAILED"): Promise<void> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const refund = await prisma.refundRequest.create({
    data: {
      paymentId: payment.id,
      userId: payment.userId,
      amount: 100,
      reason: `${MARKER} ${origin ?? "unknown"}`,
      status,
      requestedBy: payment.userId,
      idempotencyKey: `${MARKER}-${suffix}`,
      dataOrigin: origin,
      // Older than the 2-day staleness cutoff, so this row reaches the series the alert reads.
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    },
    select: { id: true },
  });
  created.push(refund.id);
}

/** Drive the registered scrape samplers and return the exposition text. */
async function scrape(): Promise<string> {
  return renderMetrics();
}

beforeAll(async () => {
  const p = await prisma.payment.findFirst({ select: { id: true, userId: true } });
  if (!p) throw new Error("homigo_test has no payment rows; run `bun run test:setup` and seed first");
  payment = p;
  initRefundBacklogMetricsAtZero();
  registerRefundBacklogSamplers();
});

afterAll(async () => {
  await prisma.refundRequest.deleteMany({ where: { id: { in: created } } });
});

describe("refund backlog metrics — population", () => {
  it("a CERTIFICATION refund does not move the series the alerts read", async () => {
    const before = await scrape();
    const openBefore = gauge(before, "homigo_refund_indeterminate_open") ?? 0;
    const staleBefore = gauge(before, "homigo_refund_indeterminate_stale") ?? 0;
    const nonBusinessBefore = gauge(before, "homigo_refund_backlog_nonbusiness", 'status="INDETERMINATE"') ?? 0;

    await makeRefund("CERTIFICATION", "INDETERMINATE");

    const after = await scrape();
    // This is the assertion Pass 3 was missing. A certification refund is still a row, still
    // INDETERMINATE, still old — everything the old unscoped query looked at — and it must not
    // reach the series that pages a human about customer money.
    expect(gauge(after, "homigo_refund_indeterminate_open")).toBe(openBefore);
    expect(gauge(after, "homigo_refund_indeterminate_stale")).toBe(staleBefore);
    // It is not discarded either: 97% of the table being test data is worth seeing.
    expect(gauge(after, "homigo_refund_backlog_nonbusiness", 'status="INDETERMINATE"')).toBe(nonBusinessBefore + 1);
  });

  it("a REAL refund does move them", async () => {
    const before = await scrape();
    const openBefore = gauge(before, "homigo_refund_indeterminate_open") ?? 0;
    const staleBefore = gauge(before, "homigo_refund_indeterminate_stale") ?? 0;

    await makeRefund("REAL", "INDETERMINATE");

    const after = await scrape();
    expect(gauge(after, "homigo_refund_indeterminate_open")).toBe(openBefore + 1);
    expect(gauge(after, "homigo_refund_indeterminate_stale")).toBe(staleBefore + 1);
  });

  it("an UNKNOWN (NULL) refund moves them too — history is not silently dropped", async () => {
    // Every row that predates the column is NULL. Excluding them would erase real refund history
    // from the operator's queue on the day provenance shipped, which is the opposite failure.
    const before = await scrape();
    const openBefore = gauge(before, "homigo_refund_indeterminate_open") ?? 0;

    await makeRefund(null, "INDETERMINATE");

    const after = await scrape();
    expect(gauge(after, "homigo_refund_indeterminate_open")).toBe(openBefore + 1);
  });

  it("keeps the actionable total on the business population as well", async () => {
    const before = await scrape();
    const actionableBefore = gauge(before, "homigo_refund_backlog_actionable") ?? 0;

    await makeRefund("TEST", "FAILED");

    const after = await scrape();
    expect(gauge(after, "homigo_refund_backlog_actionable")).toBe(actionableBefore);
    expect(gauge(after, "homigo_refund_backlog_nonbusiness", 'status="FAILED"')).toBeGreaterThan(0);
  });
});
