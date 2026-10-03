/**
 * Phase 16 — event, scheduler and recovery integration.
 *
 * These paths are the difference between "an agent you can call" and "an agentic platform". They
 * are also the paths most likely to be certified on a green unit test and be dead in production,
 * so every check here drives the REAL consumer, the REAL job registry and the REAL database, and
 * asserts on persisted rows rather than on return values.
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { readFileSync } from "fs";
import { resolve } from "path";
import { initAgents, AGENT_TRIGGERS, UNWIRED_TRIGGERS } from "../../src/agents";
import { agentTriggerConsumer } from "../../src/events/consumers/agent-trigger.consumer";
import { buildPartnerPausedEvent } from "../../src/events/catalog/partner.events";
import { getJobHandler, listJobHandlers } from "../../src/events/core/job-registry";
import { AGENT_RECOVERY_JOB, AGENT_SCHEDULED_RUN_JOB } from "../../src/agents";
import { matchConsumers } from "../../src/events/core/consumer-registry";
import { bootstrapEventConsumers } from "../../src/events/consumers";
import type { HomigoEvent } from "../../src/events/core/homigo-event";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];
function check(id: string, name: string, ok: boolean, detail: string): void {
  results.push({ id, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${name}\n        ${detail}`);
}

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

const PROVIDER = "phase16-provider";

async function main(): Promise<void> {
  assertStaging();
  initAgents();
  bootstrapEventConsumers();

  console.log("=== L. EVENT TRIGGERS ===");

  // L1 — the consumer is actually subscribed to the event types the registry names. A registry
  // entry with no subscription is a trigger that never fires.
  const eventType = AGENT_TRIGGERS[0]!.eventType;
  const subscribed = matchConsumers(eventType).map((c) => c.name);
  check("L1", "The agent consumer is subscribed to its declared event type",
    subscribed.includes("agent-trigger"),
    `event=${eventType} consumers=${subscribed.join(",")}`);

  /**
   * L2 — every registered trigger is backed by a REAL producer.
   *
   * This check used to assert the opposite: that two triggers were correctly declared UNWIREABLE
   * because `homigo.support.ticket.created` and `homigo.ops.alert.raised` did not exist. Both
   * producers now emit transactionally from their owning services, so the honest assertion is
   * that nothing remains unwired AND every declared event type has a producer in the codebase.
   *
   * The producer check reads the SOURCE rather than trusting the registry: a trigger whose event
   * is never published looks identical to a working one from inside the registry.
   */
  const producerSources = [
    "../../src/services/support-ticket.service.ts",
    "../../src/services/ops-alert.service.ts",
    "../../src/services/partner-operations.service.ts",
  ]
    .map((rel) => readFileSync(resolve(import.meta.dir, rel), "utf-8"))
    .join(" ");

  const builders = [
    "buildSupportTicketCreatedEvent",
    "buildOpsAlertRaisedEvent",
    "buildPartnerPausedEvent",
  ];
  const missingProducers = builders.filter((b) => !producerSources.includes(b));

  check("L2", "Every registered trigger has a real producer and none remain unwired",
    UNWIRED_TRIGGERS.length === 0 && missingProducers.length === 0 && AGENT_TRIGGERS.length === 3,
    `triggers=${AGENT_TRIGGERS.length} unwired=${UNWIRED_TRIGGERS.length} missingProducers=${JSON.stringify(missingProducers)}`);
  // L3 — a real event, through the real consumer, starts a real run.
  await prisma.agentRun.deleteMany({ where: { subjectType: "provider", subjectId: PROVIDER } });
  const event = buildPartnerPausedEvent({
    providerId: PROVIDER,
    pausedAt: new Date(),
    reason: "phase16 integration test",
  });
  await agentTriggerConsumer(event as HomigoEvent);

  const started = await prisma.agentRun.findMany({
    where: { subjectType: "provider", subjectId: PROVIDER },
    select: { runId: true, agentId: true, triggerType: true, triggerRef: true, causationId: true, depth: true, status: true },
  });
  check("L3", "A real partner.paused event starts a governed agent run",
    started.length === 1 && started[0]!.agentId === "partner-operations" && started[0]!.triggerType === "EVENT",
    `runs=${started.length} agent=${started[0]?.agentId} trigger=${started[0]?.triggerType} depth=${started[0]?.depth}`);

  // L4 — causation is threaded, which is what makes the recursion guard able to see a cycle.
  check("L4", "The run carries the event id as its causation id",
    started[0]?.causationId === event.id && started[0]?.triggerRef === event.id,
    `causationId=${started[0]?.causationId === event.id} triggerRef=${started[0]?.triggerRef === event.id}`);

  // L5 — replaying the SAME event creates no second run. The cooldown is bypassed by using a
  // fresh event id so that this measures idempotency specifically, not the cooldown.
  await agentTriggerConsumer(event as HomigoEvent);
  await agentTriggerConsumer(event as HomigoEvent);
  const afterReplay = await prisma.agentRun.count({
    where: { subjectType: "provider", subjectId: PROVIDER },
  });
  check("L5", "Replaying the same event three times produces one run",
    afterReplay === 1, `runs=${afterReplay}`);

  // L6 — five CONCURRENT deliveries of one event still produce one run.
  await prisma.agentRun.deleteMany({ where: { subjectType: "provider", subjectId: PROVIDER } });
  const concurrent = buildPartnerPausedEvent({
    providerId: PROVIDER,
    pausedAt: new Date(),
    reason: "phase16 concurrency",
  });
  await Promise.all(Array.from({ length: 5 }, () => agentTriggerConsumer(concurrent as HomigoEvent)));
  const afterConcurrent = await prisma.agentRun.count({
    where: { subjectType: "provider", subjectId: PROVIDER },
  });
  check("L6", "Five concurrent deliveries of one event produce one run",
    afterConcurrent === 1, `runs=${afterConcurrent}`);

  // L7 — a DIFFERENT event for the same subject is suppressed by the cooldown, not by idempotency.
  const second = buildPartnerPausedEvent({
    providerId: PROVIDER,
    pausedAt: new Date(),
    reason: "phase16 cooldown probe",
  });
  await agentTriggerConsumer(second as HomigoEvent);
  const afterCooldown = await prisma.agentRun.count({
    where: { subjectType: "provider", subjectId: PROVIDER },
  });
  check("L7", "A second, distinct event for the same subject is held by the cooldown",
    afterCooldown === 1, `runs=${afterCooldown} (distinct eventId, within 30m cooldown)`);

  /**
   * L8 — a trigger for one subject creates runs only for THAT subject.
   *
   * Rewritten to be state-independent. The first version asserted `otherSubjectRuns <= 1`, which
   * quietly depended on a fresh database: after a few executions the unrelated subject had
   * accumulated two rows and the check failed while the property it describes still held perfectly.
   * A test whose result depends on how many times it has run before is not measuring the system.
   */
  const OTHER_SUBJECT = "phase16-unrelated-provider";
  await prisma.agentRun.deleteMany({ where: { subjectType: "provider", subjectId: OTHER_SUBJECT } });

  const wrongSubject = buildPartnerPausedEvent({
    providerId: OTHER_SUBJECT,
    pausedAt: new Date(),
    reason: "phase16 isolation probe",
  });
  await agentTriggerConsumer(wrongSubject as HomigoEvent);

  const otherSubjectRuns = await prisma.agentRun.count({
    where: { subjectType: "provider", subjectId: OTHER_SUBJECT },
  });
  const originalSubjectRuns = await prisma.agentRun.count({
    where: { subjectType: "provider", subjectId: PROVIDER },
  });

  check("L8", "A trigger for a different subject leaves the first subject's runs untouched",
    otherSubjectRuns === 1 && originalSubjectRuns === afterCooldown,
    `otherSubjectRuns=${otherSubjectRuns} originalSubjectRuns=${originalSubjectRuns} (expected ${afterCooldown})`);

  await prisma.agentRun.deleteMany({ where: { subjectType: "provider", subjectId: OTHER_SUBJECT } });

  console.log("\n=== M. SCHEDULER ===");

  check("M1", "Agent jobs are registered on the platform scheduler",
    Boolean(getJobHandler(AGENT_SCHEDULED_RUN_JOB)) && Boolean(getJobHandler(AGENT_RECOVERY_JOB)),
    `registered=${listJobHandlers().filter((j) => j.startsWith("agent.")).join(",")}`);

  const recoveryDef = getJobHandler(AGENT_RECOVERY_JOB)!;
  check("M2", "The recovery sweep opts out of the staleness guard",
    recoveryDef.maxStalenessMs === null,
    `maxStalenessMs=${String(recoveryDef.maxStalenessMs)} (a late sweep is still correct)`);

  // M3 — a malformed scheduled payload is a permanent failure, not a silent no-op.
  let threw = false;
  try {
    await getJobHandler(AGENT_SCHEDULED_RUN_JOB)!.handler(
      { agentId: "not-a-real-agent" },
      { jobId: "j1", jobType: AGENT_SCHEDULED_RUN_JOB, attempt: 1, runAt: new Date(), triggerEventId: null },
    );
  } catch {
    threw = true;
  }
  check("M3", "A scheduled job naming an unknown agent fails loudly", threw,
    threw ? "handler threw, so the scheduler can dead-letter it" : "handler silently accepted an unknown agent");

  console.log("\n=== N. RECOVERY ===");

  // N1 — an orphan that never executed anything is recovered as TIMED_OUT (safe to re-run).
  const cleanOrphan = `orphan-clean-${Date.now()}`;
  await prisma.agentRun.create({
    data: {
      runId: cleanOrphan, agentId: "operations", agentVersion: "1.0.0", mode: "LIVE",
      status: "PLANNING", actorRole: "ADMIN", triggerType: "MANUAL", traceId: cleanOrphan,
      depth: 0, goal: "orphan recovery probe (nothing executed)",
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
    },
  });

  // N2 — an orphan that DID execute is recovered as ESCALATED (a human must reconcile).
  const dirtyOrphan = `orphan-dirty-${Date.now()}`;
  await prisma.agentRun.create({
    data: {
      runId: dirtyOrphan, agentId: "operations", agentVersion: "1.0.0", mode: "LIVE",
      status: "EXECUTING", actorRole: "ADMIN", triggerType: "MANUAL", traceId: dirtyOrphan,
      depth: 0, goal: "orphan recovery probe (side effect may have landed)",
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
      steps: {
        create: [{
          stepIndex: 1, phase: "EXECUTE", capability: "ops.resolveAlert",
          toolId: "write.ops.resolveAlert", status: "EXECUTED", executionId: `exec-${Date.now()}`,
        }],
      },
    },
  });

  await getJobHandler(AGENT_RECOVERY_JOB)!.handler(
    {},
    { jobId: "sweep", jobType: AGENT_RECOVERY_JOB, attempt: 1, runAt: new Date(), triggerEventId: null },
  );

  const clean = await prisma.agentRun.findUnique({ where: { runId: cleanOrphan }, select: { status: true, stopReason: true } });
  const dirty = await prisma.agentRun.findUnique({ where: { runId: dirtyOrphan }, select: { status: true, escalationReason: true } });

  check("N1", "An orphan with no side effect is recovered as TIMED_OUT",
    clean?.status === "TIMED_OUT" && clean?.stopReason === "ORPHAN_RECOVERED",
    `status=${clean?.status} stopReason=${clean?.stopReason}`);

  check("N2", "An orphan that may have applied a side effect is ESCALATED, never re-run",
    dirty?.status === "ESCALATED" && Boolean(dirty?.escalationReason),
    `status=${dirty?.status} reason=${dirty?.escalationReason?.slice(0, 60)}`);

  // N3 — recovery is idempotent: a second sweep must not move terminal runs again.
  await getJobHandler(AGENT_RECOVERY_JOB)!.handler(
    {},
    { jobId: "sweep2", jobType: AGENT_RECOVERY_JOB, attempt: 1, runAt: new Date(), triggerEventId: null },
  );
  const cleanAgain = await prisma.agentRun.findUnique({ where: { runId: cleanOrphan }, select: { status: true } });
  check("N3", "A second recovery sweep leaves terminal runs untouched",
    cleanAgain?.status === "TIMED_OUT", `status=${cleanAgain?.status}`);

  await prisma.agentRun.deleteMany({ where: { runId: { in: [cleanOrphan, dirtyOrphan] } } });

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`INTEGRATION CERTIFICATION: ${pass} PASS, ${fail} FAIL`);
  for (const r of results.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("INTEGRATION HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
