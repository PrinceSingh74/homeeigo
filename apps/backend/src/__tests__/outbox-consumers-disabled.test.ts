import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { dbReachable, prisma } from "./helpers/adversarial-fixtures";
import { processOutboxBatch } from "../events/core/outbox-processor";
import { eventPlatformConfig } from "../events/core/config";

/**
 * SECTION 7 — an event marked PUBLISHED must have been delivered to someone.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * `publishRow` did `await dispatchEvent(event); await markPublished(row.id);`. With
 * `EVENTS_CONSUMERS_ENABLED=false`, `dispatchEvent` returns on its first line without reaching any
 * consumer, and `markPublished` then set status PUBLISHED, stamped `publishedAt`, cleared
 * `lastError` and counted `homigo_outbox_publish_total{result="success"}`.
 *
 * The event became terminal, undelivered, and indistinguishable from a delivered one. Retention
 * deletes PUBLISHED rows after fourteen days, so the evidence disappears too.
 *
 * Found during the 7A load baseline, on a real isolated backend: with consumers disabled, 221 rows
 * moved to PUBLISHED in twenty seconds while the process logged zero `event_consumer_ok` lines.
 * `/ready` already named the state `publish_without_delivery`, so it was visible — and still
 * destroyed every event that passed through it. Visibility is not containment.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 *
 * Not "the processor returns 0" — that is satisfied by a processor which is simply broken. The
 * assertion is on the ROWS: after a tick with consumers off, the seeded events must still be
 * PENDING, unstamped, and therefore still deliverable. Then, with consumers on, the same rows must
 * actually leave PENDING — otherwise this file would pass against a processor that never works.
 */
const RUN = `outbox-nodeliver-${Date.now().toString(36)}`;
let dbOk = false;

/** Restored in afterAll — this flag is process-global and other suites share the process. */
const ORIGINAL_CONSUMERS_ENABLED = eventPlatformConfig.consumersEnabled;

function setConsumersEnabled(value: boolean): void {
  (eventPlatformConfig as { consumersEnabled: boolean }).consumersEnabled = value;
}

/**
 * Seeded at the FRONT of the queue, deliberately.
 *
 * `claimBatch` orders `created_at ASC LIMIT batchSize`. This database carries ~36,000 PENDING rows
 * older than anything a test creates, so freshly-stamped rows sit behind them and are never reached
 * — which made the first version of every "still PENDING" assertion below true for the wrong
 * reason. The positive control caught it. Backdating puts these rows first, so the flag is the only
 * thing that can decide their fate.
 */
const BACKDATED = new Date("2020-01-01T00:00:00.000Z");

async function seedPending(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const eventId = `${RUN}-${i}`;
    /**
     * A shape `validateEventEnvelope` accepts, so that a row which DOES get claimed reaches
     * `dispatchEvent` rather than failing validation — otherwise "still PENDING" could be explained
     * by a malformed payload instead of by the guard.
     */
    const row = await prisma.eventOutbox.create({
      data: {
        eventId,
        eventType: "homigo.booking.created",
        aggregateType: "booking",
        aggregateId: `${RUN}-agg-${i}`,
        status: "PENDING",
        createdAt: BACKDATED,
        payload: {
          eventId,
          type: "homigo.booking.created",
          version: "1.0",
          occurredAt: new Date().toISOString(),
          aggregate: { type: "booking", id: `${RUN}-agg-${i}` },
          data: { bookingId: `${RUN}-agg-${i}` },
        },
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function statusesOf(ids: string[]) {
  return prisma.eventOutbox.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, publishedAt: true, attempts: true },
  });
}

beforeAll(async () => {
  dbOk = await dbReachable();
}, 60_000);

beforeEach(async () => {
  if (dbOk) await prisma.eventOutbox.deleteMany({ where: { eventId: { startsWith: RUN } } });
});

afterAll(async () => {
  setConsumersEnabled(ORIGINAL_CONSUMERS_ENABLED);
  if (dbOk) await prisma.eventOutbox.deleteMany({ where: { eventId: { startsWith: RUN } } });
}, 60_000);

describe("consumers disabled", () => {
  test("a tick claims nothing and publishes nothing", async () => {
    if (!dbOk) return;
    const ids = await seedPending(5);
    setConsumersEnabled(false);

    const result = await processOutboxBatch();

    expect(result.claimed).toBe(0);
    /**
     * The row-level assertion, which is the one that matters. `claimed: 0` alone would also be
     * produced by a processor that had stopped working for any other reason.
     */
    const rows = await statusesOf(ids);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
    expect(rows.every((r) => r.publishedAt === null)).toBe(true);
  }, 60_000);

  test("attempts are not burned while paused", async () => {
    if (!dbOk) return;
    const ids = await seedPending(3);
    setConsumersEnabled(false);

    // Several ticks, as a paused deployment window would produce.
    for (let i = 0; i < 4; i++) await processOutboxBatch();

    /**
     * The reason the fix declines to claim rather than claim-and-release. `attempts` increments
     * inside the claim statement, so a release-based pause would march every row through
     * `maxAttempts` into FAILED and the DLQ — turning a pause into a different kind of loss.
     */
    const rows = await statusesOf(ids);
    expect(rows.every((r) => r.attempts === 0)).toBe(true);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  }, 60_000);
});

describe("consumers enabled", () => {
  test("the same rows do leave PENDING — so the file is not vacuous", async () => {
    if (!dbOk) return;
    const ids = await seedPending(3);
    setConsumersEnabled(true);

    await processOutboxBatch();

    /**
     * The positive control for the whole file. Every assertion above is satisfied by a processor
     * that never publishes anything at all; this is what distinguishes "paused on purpose" from
     * "broken".
     *
     * Asserted as "no longer PENDING" rather than "PUBLISHED": a consumer that throws sends the row
     * to retry or FAILED, which is still proof that the row was claimed and dispatched. Pinning
     * PUBLISHED would make this test depend on every registered consumer succeeding against
     * whatever fixture data happens to exist.
     */
    const rows = await statusesOf(ids);
    expect(rows.every((r) => r.status !== "PENDING" || r.attempts > 0)).toBe(true);
  }, 60_000);
});

describe("the two flags are independent, and that is the trap", () => {
  test("outbox on + consumers off is a pause, not a publish", async () => {
    if (!dbOk) return;
    const ids = await seedPending(4);
    setConsumersEnabled(false);
    expect(eventPlatformConfig.outboxEnabled).toBe(true);

    await processOutboxBatch();

    /**
     * Stated as its own case because this exact combination is what `/ready` reports as
     * `publish_without_delivery`, and what shipped for long enough to be documented as a known
     * state. It is now a queue, not a shredder.
     */
    const rows = await statusesOf(ids);
    expect(rows.filter((r) => r.status === "PUBLISHED")).toHaveLength(0);
  }, 60_000);
});
