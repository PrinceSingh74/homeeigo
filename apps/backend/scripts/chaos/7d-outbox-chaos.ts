/**
 * SECTION 7D — event / outbox saturation, backpressure and recovery.
 *
 *   DATABASE_URL="<test>" bun run scripts/chaos/7d-outbox-chaos.ts
 *
 * Runs IN-PROCESS against the real `outbox-processor`, `event-bus` and consumer registry, so a
 * handler invocation can be counted directly rather than inferred from a log line. The alternative —
 * driving a separate worker over HTTP — can only observe rows, and this section's most important
 * questions are about how many times a HANDLER ran, which rows cannot answer.
 *
 * ── Side-effect safety ──────────────────────────────────────────────────────
 *
 * Every experiment uses a purpose-registered test consumer whose only effect is an in-memory counter
 * and, where a persisted effect is needed, a row in `event_consumer_receipts` — the table the
 * platform already uses for exactly this. No money, booking, notification or payout path is touched.
 * Events carry a run-scoped id prefix and are deleted in cleanup.
 *
 * ── The FIFO problem, learned in 7A ─────────────────────────────────────────
 *
 * `claimBatch` orders `created_at ASC LIMIT batchSize`. This database carries ~33,000 PENDING rows
 * older than anything a test creates, so freshly-stamped events are never reached and every
 * assertion about them would be true for the wrong reason. Test events are therefore BACKDATED to
 * the head of the queue.
 */
import { assertChaosTargetIsolated } from "../../src/lib/chaos-isolation";

const target = assertChaosTargetIsolated("7D outbox chaos");

const prisma = (await import("../../src/lib/prisma")).default;
const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
const { eventPlatformConfig } = await import("../../src/events/core/config");
const { registerConsumer, getRegisteredConsumers } = await import(
  "../../src/events/core/consumer-registry"
);

const RUN = `7d-${Date.now().toString(36)}`;
/** Older than every real row, so the claim query reaches these first. */
const BACKDATE = new Date("2019-01-01T00:00:00.000Z");
/** A type no production consumer subscribes to, so only the test consumers below can see it. */
const TEST_EVENT_TYPE = "homigo.chaos.probe";

const failures: string[] = [];
function check(id: string, passed: boolean, detail: string): void {
  console.log(`    ${passed ? "PASS" : "FAIL"}  ${id.padEnd(22)} ${detail}`);
  if (!passed) failures.push(`${id}: ${detail}`);
}

/** Handler invocations, by event id. The number that matters for duplicate-effect questions. */
const invocations = new Map<string, number>();
let handlerDelayMs = 0;
let poisonIds = new Set<string>();

registerConsumer({
  name: "chaos-probe.v1",
  eventTypes: [TEST_EVENT_TYPE],
  maxAttempts: 1,
  handler: async (event) => {
    invocations.set(event.id, (invocations.get(event.id) ?? 0) + 1);
    if (handlerDelayMs > 0) await new Promise((r) => setTimeout(r, handlerDelayMs));
    if (poisonIds.has(event.id)) throw new Error("deliberate poison-event failure");
  },
});

type SeedOpts = { count: number; tag: string; poison?: boolean; availableAt?: Date };

async function seed({ count, tag, poison = false, availableAt }: SeedOpts): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const eventId = `${RUN}-${tag}-${i}`;
    await prisma.eventOutbox.create({
      data: {
        eventId,
        eventType: TEST_EVENT_TYPE,
        aggregateType: "chaos",
        aggregateId: `${RUN}-agg-${tag}-${i}`,
        status: "PENDING",
        createdAt: BACKDATE,
        ...(availableAt ? { availableAt } : {}),
        /**
         * The REAL CloudEvents-shaped envelope `validateEventEnvelope` accepts.
         *
         * The first version of this harness invented a plausible-looking shape
         * (`{eventId, type, version, occurredAt, aggregate, data}`) and every single event was
         * rejected with "Invalid Homigo event envelope" before reaching a consumer — so all
         * seventeen assertions failed for a test-data reason while looking like product defects.
         * The contract is `specversion/id/type/source/time/datacontenttype/data/homigo`, and
         * `homigo` must carry `version`, `aggregateType` and `aggregateId`.
         */
        payload: {
          specversion: "1.0",
          id: eventId,
          type: TEST_EVENT_TYPE,
          source: "chaos/7d",
          time: new Date().toISOString(),
          datacontenttype: "application/json",
          data: { probe: true },
          homigo: {
            version: "1.0",
            aggregateType: "chaos",
            aggregateId: `${RUN}-agg-${tag}-${i}`,
          },
        },
      },
    });
    if (poison) poisonIds.add(eventId);
    ids.push(eventId);
  }
  return ids;
}

async function rows(eventIds: string[]) {
  return prisma.eventOutbox.findMany({
    where: { eventId: { in: eventIds } },
    select: { eventId: true, status: true, attempts: true, publishedAt: true, lockedBy: true, lockedAt: true },
  });
}

async function receiptsFor(eventIds: string[]) {
  return prisma.eventConsumerReceipt.findMany({
    where: { eventId: { in: eventIds } },
    select: { eventId: true, consumerName: true, result: true },
  });
}

async function cleanup(): Promise<void> {
  await prisma.eventConsumerReceipt.deleteMany({ where: { eventId: { startsWith: RUN } } });
  await prisma.eventDeadLetter.deleteMany({ where: { eventId: { startsWith: RUN } } });
  await prisma.eventOutbox.deleteMany({ where: { eventId: { startsWith: RUN } } });
}

function setConsumersEnabled(value: boolean): void {
  (eventPlatformConfig as { consumersEnabled: boolean }).consumersEnabled = value;
}

/**
 * Drain only OUR events, bounded so a bug cannot loop forever.
 *
 * "Not yet drained" means PENDING **or PROCESSING**. The first version counted only PENDING, which
 * made the stranded-claim experiment vacuous in the worst way: those rows are deliberately left
 * PROCESSING, so the loop saw zero PENDING, returned on tick 0 without ever calling the processor,
 * and three invariants failed for want of the recovery ever being given a chance to run. The
 * give-away was `outbox_stale_claims_recovered {"count":5}` appearing in the NEXT phase — the
 * product had recovered them correctly, just after the assertions had already read the rows.
 */
async function drain(eventIds: string[], maxTicks = 30): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick++) {
    const unfinished = await prisma.eventOutbox.count({
      where: { eventId: { in: eventIds }, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (unfinished === 0) return tick;
    await processOutboxBatch();
  }
  return -1;
}

console.log("── 7D isolation proof ──");
console.log(`  database   : ${target.redacted}`);
console.log(`  run id     : ${RUN}`);
console.log(`  batchSize=${eventPlatformConfig.batchSize} maxAttempts=${eventPlatformConfig.maxAttempts} ` +
  `intervalMs=${eventPlatformConfig.intervalMs} lockTimeoutMs=${eventPlatformConfig.lockTimeoutMs}`);
console.log(`  consumers  : ${getRegisteredConsumers().length} registered (incl. chaos-probe.v1)`);
console.log(`  outboxEnabled=${eventPlatformConfig.outboxEnabled} consumersEnabled=${eventPlatformConfig.consumersEnabled}`);
console.log(`  time       : ${new Date().toISOString()}`);

await cleanup();

try {
  // ── BASELINE ─────────────────────────────────────────────────────────────
  console.log("\n── baseline: happy path ──");
  setConsumersEnabled(true);
  {
    const ids = await seed({ count: 10, tag: "base" });
    const t0 = Date.now();
    const ticks = await drain(ids);
    const ms = Date.now() - t0;
    const r = await rows(ids);
    const rc = await receiptsFor(ids);
    const published = r.filter((x) => x.status === "PUBLISHED").length;
    const invoked = ids.filter((id) => (invocations.get(id) ?? 0) > 0).length;
    console.log(`    drained in ${ticks} tick(s), ${ms}ms`);
    check("I1-delivered", published === 10, `PUBLISHED ${published}/10`);
    check("I15-receipts", rc.length === 10, `receipts ${rc.length}/10 (one per event per consumer)`);
    check("base-invoked", invoked === 10, `handler ran for ${invoked}/10 events`);
    check(
      "I5-once",
      ids.every((id) => (invocations.get(id) ?? 0) === 1),
      `no event invoked more than once: ${JSON.stringify([...new Set(ids.map((i) => invocations.get(i) ?? 0))])}`,
    );
  }

  // ── FAILURE MODE A: consumers disabled (regression of the 7A defect) ─────
  console.log("\n── mode A: consumers disabled (7A defect regression) ──");
  {
    const ids = await seed({ count: 8, tag: "disabled" });
    setConsumersEnabled(false);
    const before = invocations.size;
    for (let i = 0; i < 3; i++) await processOutboxBatch();
    const r = await rows(ids);
    const rc = await receiptsFor(ids);
    check("I8-not-terminal", r.every((x) => x.status === "PENDING"), `all ${r.length} stayed PENDING`);
    check("I8-no-publish", r.every((x) => x.publishedAt === null), "no publishedAt stamped");
    check("I8-no-receipts", rc.length === 0, `receipts fabricated: ${rc.length} (must be 0)`);
    check("I11-no-attempts", r.every((x) => x.attempts === 0), "attempts not burned while paused");
    check("A-no-invoke", invocations.size === before, "no handler ran while consumers were off");

    setConsumersEnabled(true);
    const ticks = await drain(ids);
    const after = await rows(ids);
    const afterReceipts = await receiptsFor(ids);
    check("I19-drains", after.every((x) => x.status === "PUBLISHED"), `backlog drained in ${ticks} tick(s)`);
    check("A-exactly-once", ids.every((id) => (invocations.get(id) ?? 0) === 1), "each event handled exactly once after re-enable");
    check("A-receipts", afterReceipts.length === 8, `receipts ${afterReceipts.length}/8`);
  }

  // ── FAILURE MODE C: poison event ─────────────────────────────────────────
  console.log("\n── mode C: poison event among healthy ones ──");
  {
    const poison = await seed({ count: 1, tag: "poison", poison: true });
    const healthy = await seed({ count: 6, tag: "healthy" });
    const all = [...poison, ...healthy];
    const ticks = await drain(all);
    const r = await rows(all);
    const poisonRow = r.find((x) => x.eventId === poison[0]);
    const healthyRows = r.filter((x) => healthy.includes(x.eventId));

    check(
      "I13-no-hol-block",
      healthyRows.every((x) => x.status === "PUBLISHED"),
      `healthy events behind the poison all completed: ${healthyRows.filter((x) => x.status === "PUBLISHED").length}/6`,
    );
    /**
     * The poison event's OUTBOX row still reaches PUBLISHED: `dispatchEvent` deliberately swallows a
     * consumer failure so one bad consumer cannot fail unrelated ones. The failure is recorded per
     * consumer in the dead-letter table, which is where it belongs.
     */
    const dlq = await prisma.eventDeadLetter.findMany({
      where: { eventId: poison[0] },
      select: { consumerName: true, attempts: true, error: true },
    });
    check("C-dead-lettered", dlq.length >= 1, `poison event dead-lettered for ${dlq.length} consumer(s)`);
    check("C-outbox-terminal", poisonRow?.status === "PUBLISHED", `poison outbox row = ${poisonRow?.status} (consumer failure is per-consumer, not per-event)`);
    const poisonReceipts = await receiptsFor(poison);
    check("C-no-success-receipt", poisonReceipts.every((x) => x.result !== "ok"), `no "ok" receipt for a handler that threw (${poisonReceipts.length} receipt rows)`);
    console.log(`    drained in ${ticks} tick(s); poison attempts=${poisonRow?.attempts}`);
  }

  // ── CLAIM RACE ───────────────────────────────────────────────────────────
  console.log("\n── claim race: concurrent processors over one population ──");
  {
    const ids = await seed({ count: 40, tag: "race" });
    const before = new Map(invocations);
    // Four concurrent ticks. Each opens its own pooled connection, so the claim SQL's
    // FOR UPDATE SKIP LOCKED is genuinely contended.
    await Promise.all([processOutboxBatch(), processOutboxBatch(), processOutboxBatch(), processOutboxBatch()]);
    await drain(ids);

    const doubled = ids.filter((id) => (invocations.get(id) ?? 0) - (before.get(id) ?? 0) > 1);
    const rc = await receiptsFor(ids);
    const r = await rows(ids);
    check("I3-single-claim", doubled.length === 0, `events handled more than once under 4-way contention: ${doubled.length}/40`);
    check("I16-receipts-unique", rc.length === 40, `receipts ${rc.length}/40 — one per event, enforced by the unique index`);
    check("race-all-done", r.every((x) => x.status === "PUBLISHED"), `all 40 reached PUBLISHED`);
  }

  // ── STRANDED PROCESSING / RECOVERY ───────────────────────────────────────
  console.log("\n── stranded PROCESSING recovery (simulated worker death) ──");
  {
    const ids = await seed({ count: 5, tag: "stranded" });
    /**
     * A worker that claimed rows and died leaves them PROCESSING with a stale `lockedAt`. Written
     * directly because killing a real worker mid-claim is not reproducible to the row level, and the
     * row state is what recovery actually keys on.
     */
    await prisma.eventOutbox.updateMany({
      where: { eventId: { in: ids } },
      data: {
        status: "PROCESSING",
        lockedBy: "dead-worker",
        lockedAt: new Date(Date.now() - eventPlatformConfig.lockTimeoutMs - 60_000),
      },
    });
    const beforeInv = new Map(invocations);
    const ticks = await drain(ids);
    const r = await rows(ids);
    check("I6-no-stranded", r.every((x) => x.status !== "PROCESSING"), `no row left PROCESSING (drained in ${ticks} tick(s))`);
    check("I7-reclaimed", r.every((x) => x.status === "PUBLISHED"), `all ${r.length} recovered to PUBLISHED`);
    check(
      "I7-once",
      ids.every((id) => (invocations.get(id) ?? 0) - (beforeInv.get(id) ?? 0) === 1),
      "each reclaimed event handled exactly once",
    );
  }

  // ── BURST / CAPACITY ─────────────────────────────────────────────────────
  console.log("\n── burst: 300 events, measured drain ──");
  {
    const ids = await seed({ count: 300, tag: "burst" });
    const t0 = Date.now();
    const ticks = await drain(ids, 60);
    const ms = Date.now() - t0;
    const r = await rows(ids);
    const done = r.filter((x) => x.status === "PUBLISHED").length;
    const rc = await receiptsFor(ids);
    const dupInvoked = ids.filter((id) => (invocations.get(id) ?? 0) > 1).length;
    console.log(`    ${done}/300 published in ${ms}ms across ${ticks} tick(s) — ${(300 / (ms / 1000)).toFixed(0)} events/s drained`);
    check("E-all-drained", done === 300, `burst fully drained: ${done}/300`);
    check("E-no-dup", dupInvoked === 0, `events handled more than once during the burst: ${dupInvoked}`);
    check("E-receipts", rc.length === 300, `receipts ${rc.length}/300`);
    check("I11-attempts-bounded", r.every((x) => x.attempts <= eventPlatformConfig.maxAttempts), "no row exceeded maxAttempts");
  }

  // ── IDEMPOTENCY UNDER CONCURRENT DISPATCH ────────────────────────────────
  console.log("\n── concurrent dispatch of the SAME event (idempotency design probe) ──");
  {
    /**
     * The claim query protects against two workers claiming one ROW. It does not protect against the
     * same EVENT being dispatched twice — which the architecture can produce legitimately, e.g. when
     * `recoverStaleClaims` returns a row to PENDING after `lockTimeoutMs` while the original worker
     * is merely slow rather than dead, or when an operator replays.
     *
     * `processConsumer` guards with `hasConsumerProcessed` (a read) and then writes the receipt AFTER
     * the handler. That is check-then-act: two concurrent dispatches can both find no receipt, both
     * run the handler, and both upsert. The unique index prevents duplicate ROWS; it does not
     * prevent duplicate EXECUTION.
     *
     * This measures which of the two it actually is, by counting handler invocations rather than
     * rows. The answer determines whether repeated consumer execution is safe by design or merely
     * unlikely.
     */
    const { dispatchEvent } = await import("../../src/events/core/event-bus");
    const eventId = `${RUN}-dup-0`;
    const event = {
      specversion: "1.0" as const,
      id: eventId,
      type: TEST_EVENT_TYPE,
      source: "chaos/7d",
      time: new Date().toISOString(),
      datacontenttype: "application/json" as const,
      data: { probe: true },
      homigo: { version: "1.0", aggregateType: "chaos", aggregateId: `${RUN}-agg-dup` },
    };

    invocations.delete(eventId);
    await Promise.all([dispatchEvent(event), dispatchEvent(event), dispatchEvent(event)]);
    const concurrentRuns = invocations.get(eventId) ?? 0;

    // Then a SEQUENTIAL redelivery, where the receipt already exists.
    await dispatchEvent(event);
    const afterSequential = invocations.get(eventId) ?? 0;

    const rc = await prisma.eventConsumerReceipt.count({ where: { eventId } });
    console.log(`    handler runs — 3 concurrent dispatches: ${concurrentRuns}; +1 sequential: ${afterSequential}; receipts: ${rc}`);

    check(
      "I18-sequential-idempotent",
      afterSequential === concurrentRuns,
      `a redelivery AFTER the receipt exists is skipped (runs stayed ${concurrentRuns})`,
    );
    check("I16-one-receipt", rc === 1, `exactly one receipt row despite ${concurrentRuns + 1} dispatches`);
    /**
     * Reported, not asserted as a pass/fail on the product: concurrent dispatch of one event is
     * expected to run the handler more than once under check-then-act, and whether that matters
     * depends on each consumer's own idempotency. Recording the measured number here so the design
     * is stated as a fact rather than assumed either way.
     */
    console.log(
      `    NOTE: concurrent dispatch ran the handler ${concurrentRuns}x for one event — ` +
        `check-then-act, so per-consumer idempotency is what makes repeat execution safe.`,
    );
  }

  // ── SLOW CONSUMER ────────────────────────────────────────────────────────
  console.log("\n── mode D: slow consumer (200ms per event) ──");
  {
    handlerDelayMs = 200;
    const ids = await seed({ count: 20, tag: "slow" });
    const t0 = Date.now();
    const ticks = await drain(ids, 40);
    const ms = Date.now() - t0;
    handlerDelayMs = 0;
    const r = await rows(ids);
    const stranded = r.filter((x) => x.status === "PROCESSING").length;
    console.log(`    20 events at 200ms each: ${ms}ms across ${ticks} tick(s) (serial floor 4000ms)`);
    check("D-completes", r.every((x) => x.status === "PUBLISHED"), `all 20 completed despite the delay`);
    check("D-no-stranded", stranded === 0, `rows stuck in PROCESSING: ${stranded}`);
    check("D-no-dup", ids.every((id) => (invocations.get(id) ?? 0) === 1), "a slow handler was not retried into duplicates");
    /**
     * MEASURED, not asserted: events within a batch are processed SERIALLY.
     *
     * `processOutboxBatch` does `for (const row of rows) await publishRow(row)`. The measured drain
     * lands just above the fully-serial floor, which settles the question — `consumerConcurrency`
     * parallelises the CONSUMERS of one event, not the events of one batch.
     *
     * The first version of this check asserted the opposite and failed. That was an unfounded
     * expectation, not a defect; recording the real behaviour is what matters, because it is what
     * makes the lease arithmetic below dangerous.
     */
    console.log(
      `    MEASURED: ${ms}ms vs a ${20 * 200}ms serial floor — events in a batch are processed serially`,
    );
    const leaseBudgetMs = eventPlatformConfig.lockTimeoutMs;
    const worstBatchMs = eventPlatformConfig.batchSize * (ms / 20);
    console.log(
      `    lease arithmetic: batchSize ${eventPlatformConfig.batchSize} x ${(ms / 20).toFixed(0)}ms/event ` +
        `= ${worstBatchMs.toFixed(0)}ms vs a ${leaseBudgetMs}ms lease`,
    );
  }

  // ── LEASE EXPIRY UNDER A SLOW BATCH ──────────────────────────────────────
  console.log("\n── lease expiry while a batch is still running ──");
  {
    /**
     * The consequence of serial batch processing, tested directly.
     *
     * `recoverStaleClaims` returns any PROCESSING row whose `lockedAt` is older than `lockTimeoutMs`
     * to PENDING — it cannot tell a dead worker from a slow one. Events within a batch are handled
     * one at a time, so a batch of `batchSize` events whose handlers are slow can outlive its own
     * lease. The rows at the back would then be re-claimed and dispatched a SECOND time while the
     * first pass is still working through them, and `processConsumer`'s check-then-act guard does
     * not prevent concurrent duplicate execution.
     *
     * Rather than wait out the 120s default, the lease is narrowed to its configured minimum for
     * this one measurement and the handler is made slow enough to cross it.
     */
    const originalLease = eventPlatformConfig.lockTimeoutMs;
    (eventPlatformConfig as { lockTimeoutMs: number }).lockTimeoutMs = 10_000;
    handlerDelayMs = 900;
    const ids = await seed({ count: 14, tag: "lease" });
    const before = new Map(invocations);

    // One long batch, and a competing tick mid-flight — exactly what a second worker (or the next
    // scheduler tick on this one) would do.
    const longBatch = processOutboxBatch();
    await new Promise((r) => setTimeout(r, 11_500)); // past the narrowed lease
    await processOutboxBatch();
    await longBatch;
    handlerDelayMs = 0;
    await drain(ids, 40);

    const duplicated = ids.filter((id) => (invocations.get(id) ?? 0) - (before.get(id) ?? 0) > 1);
    const rc = await receiptsFor(ids);
    const r = await rows(ids);
    console.log(
      `    lease ${10_000}ms, 900ms/event x 14; events handled twice: ${duplicated.length}/14`,
    );
    check("lease-completes", r.every((x) => x.status === "PUBLISHED"), `all 14 reached PUBLISHED`);
    check("lease-one-receipt", rc.length === 14, `receipts ${rc.length}/14 — no duplicate rows`);
    /**
     * Reported as a measurement, not scored: whether duplicate HANDLER execution is acceptable is a
     * per-consumer question the platform answers with per-consumer idempotency. Scoring it as a
     * product failure would be inventing a guarantee the architecture does not claim.
     */
    console.log(
      duplicated.length > 0
        ? `    NOTE: ${duplicated.length} event(s) had their handler run twice — lease expiry during a slow batch is reachable.`
        : `    NOTE: no duplicate handler execution observed at this lease/latency combination.`,
    );
    (eventPlatformConfig as { lockTimeoutMs: number }).lockTimeoutMs = originalLease;
  }

  // ── OBSERVABILITY ────────────────────────────────────────────────────────
  console.log("\n── backlog + lag observability ──");
  {
    const pending = await prisma.eventOutbox.count({ where: { status: "PENDING" } });
    const processing = await prisma.eventOutbox.count({ where: { status: "PROCESSING" } });
    const oldest = await prisma.eventOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const ageH = oldest ? ((Date.now() - oldest.createdAt.getTime()) / 3_600_000).toFixed(1) : "n/a";
    check("I9-backlog-visible", Number.isFinite(pending), `PENDING=${pending} PROCESSING=${processing}`);
    check("I10-lag-visible", oldest !== null, `oldest PENDING is ${ageH}h old — lag is queryable`);
  }
} finally {
  setConsumersEnabled(true);
  handlerDelayMs = 0;
  poisonIds = new Set();
  await cleanup();
  const leftover = await prisma.eventOutbox.count({ where: { eventId: { startsWith: RUN } } });
  const leftoverReceipts = await prisma.eventConsumerReceipt.count({ where: { eventId: { startsWith: RUN } } });
  console.log(`\n── cleanup ── leftover events=${leftover} receipts=${leftoverReceipts}`);
  if (leftover !== 0 || leftoverReceipts !== 0) failures.push("cleanup left test rows behind");
}

console.log("\n── 7D result ──");
if (failures.length === 0) console.log("  ALL INVARIANTS HELD");
else {
  console.log(`  ${failures.length} VIOLATED:`);
  for (const f of failures) console.log(`    - ${f}`);
}
await prisma.$disconnect();
process.exit(failures.length === 0 ? 0 : 1);
