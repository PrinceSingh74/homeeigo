/**
 * Phase 16 — true end-to-end agentic flows (§57).
 *
 * This is the check the previous phase could not run, because two of the three producers did not
 * exist. It drives the ENTIRE chain with nothing stubbed:
 *
 *   real service write
 *     → transactional outbox row
 *       → real outbox processor
 *         → real consumer registry
 *           → real agent trigger
 *             → real agent runtime (plan, policy, risk, tool, verify)
 *               → persisted run + steps + tool executions + audit
 *
 * Assertions are on persisted rows at every hop. "The consumer was called" is not evidence that a
 * governed run happened; a row in `agent_runs` joined to a row in `ai_tool_executions` is.
 */
import "../../src/load-env";

import prisma from "../../src/lib/prisma";
import { supportTicketService } from "../../src/services/support-ticket.service";
import { opsAlertService } from "../../src/services/ops-alert.service";
import { partnerOperationsService } from "../../src/services/partner-operations.service";
import { bootstrapEventConsumers } from "../../src/events/consumers";
import { initAgents } from "../../src/agents";
import { AGENT_FLAGS } from "../../src/agents/config";
import { __clearFlagMemoryCache } from "../../src/services/feature-flag.service";

type Result = { id: string; name: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
const results: Result[] = [];
function record(id: string, name: string, status: Result["status"], detail: string): void {
  results.push({ id, name, status, detail });
  console.log(`[${status === "PASS" ? "PASS " : status === "FAIL" ? "FAIL " : "BLOCK"}] ${id} ${name}\n        ${detail}`);
}
function check(id: string, name: string, ok: boolean, detail: string): void {
  record(id, name, ok ? "PASS" : "FAIL", detail);
}

/**
 * The outbox must be ON for this harness to prove anything.
 *
 * `.env.staging` ships `EVENTS_OUTBOX_ENABLED=false`, and the setting is read once at import time,
 * so it cannot be flipped from inside this file — static imports are hoisted above every
 * statement. `load-env` now preserves an explicit shell value for it, the same way it preserves
 * PORT and DATABASE_URL, so the harness is run as:
 *
 *     EVENTS_OUTBOX_ENABLED=true HOMIGO_STAGING=1 bun run scripts/phase16/e2e-agentic-flow.ts
 *
 * Asserted rather than assumed: a silent `claimed=0` would otherwise read as "the agent never
 * ran" when the truth is "the processor was switched off".
 */
function assertOutboxEnabled(): void {
  /**
   * BOTH flags, checked separately.
   *
   * They are independent, and the dangerous combination is outbox-on/consumers-off: the processor
   * claims rows, publishes them and marks them PUBLISHED while `dispatchEvent` returns immediately.
   * Outbox metrics climb, every row reaches a terminal state, and no consumer ever runs — which
   * reads exactly like a healthy pipeline. Observed here as `claimed=68` with zero agent runs.
   */
  const missing: string[] = [];
  if (process.env.EVENTS_OUTBOX_ENABLED !== "true") missing.push("EVENTS_OUTBOX_ENABLED");
  if (process.env.EVENTS_CONSUMERS_ENABLED !== "true") missing.push("EVENTS_CONSUMERS_ENABLED");
  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") missing.push("STAGING_EVENTS_CERTIFICATION");
  if (missing.length > 0) {
    throw new Error(
      `REFUSING: this harness proves the full event path. Re-run with ${missing.join("=true ")}=true ` +
        "(STAGING_EVENTS_CERTIFICATION=1). The staging baseline ships these off on purpose.",
    );
  }
}

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

const CUSTOMER = "phase16-customer";
const PROVIDER = "phase16-provider";

async function setFlag(key: string, enabled: boolean): Promise<void> {
  await prisma.platformFeatureFlag.upsert({
    where: { key },
    create: { key, enabled, rolloutPct: 100, environment: "staging", updatedBy: "phase16-e2e" },
    update: { enabled, rolloutPct: 100, environment: "staging" },
  });
  __clearFlagMemoryCache();
}

/**
 * Drain the outbox until nothing is left to claim.
 *
 * Bounded: an unbounded drain would hang the harness if the processor ever failed to advance a
 * row, which is exactly the failure worth surfacing as a stuck test rather than an infinite one.
 */
async function drainOutbox(maxTicks = 10): Promise<number> {
  const { processOutboxBatch } = await import("../../src/events/core/outbox-processor");
  let total = 0;
  for (let i = 0; i < maxTicks; i += 1) {
    const { claimed } = await processOutboxBatch();
    total += claimed;
    if (claimed === 0) break;
  }
  return total;
}

async function runForSubject(subjectType: string, subjectId: string) {
  return prisma.agentRun.findFirst({
    where: { subjectType, subjectId },
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
}

/** Did this run get all the way through a governed tool call? */
async function toolEvidence(runId: string) {
  const steps = await prisma.agentRunStep.findMany({
    where: { runId, executionId: { not: null } },
    select: { executionId: true, toolId: true, status: true },
  });
  const ids = steps.map((s) => s.executionId!).filter(Boolean);
  const executions = ids.length
    ? await prisma.aiToolExecution.findMany({
        where: { executionId: { in: ids } },
        select: { executionId: true, toolId: true, status: true, policyDecision: true },
      })
    : [];
  return { steps, executions };
}

async function main(): Promise<void> {
  assertStaging();
  assertOutboxEnabled();
  initAgents();
  bootstrapEventConsumers();

  // Live, so the flows exercise real execution rather than shadow.
  for (const key of Object.values(AGENT_FLAGS)) await setFlag(key, true);
  console.log("[setup] all agents LIVE\n");

  try {
    // ── S. SUPPORT: ticket → outbox → processor → consumer → agent run ──────
    console.log("=== S. SUPPORT END-TO-END ===");

    const ticket = await supportTicketService.create(CUSTOMER, {
      subject: "My cleaner did not arrive for the scheduled slot",
      description:
        "I booked a cleaning for this morning and nobody came. I would like to know what happened and reschedule.",
      category: "booking",
    });

    const outboxBefore = await prisma.eventOutbox.count({
      where: { aggregateId: ticket.id, eventType: "homigo.support.ticket.created" },
    });
    check("S1", "The ticket write produced an outbox row",
      outboxBefore === 1, `ticketId=${ticket.id} outboxRows=${outboxBefore}`);

    const claimed = await drainOutbox();
    const supportRun = await runForSubject("ticket", ticket.id);

    check("S2", "The outbox processor delivered the event and an agent run exists",
      Boolean(supportRun) && supportRun?.agentId === "support",
      `claimed=${claimed} runId=${supportRun?.runId ?? "none"} agent=${supportRun?.agentId ?? "-"} trigger=${supportRun?.triggerType ?? "-"}`);

    if (supportRun) {
      check("S3", "The run is causally bound to the event that started it",
        supportRun.triggerType === "EVENT" && Boolean(supportRun.causationId) && supportRun.depth === 1,
        `trigger=${supportRun.triggerType} causationId=${Boolean(supportRun.causationId)} depth=${supportRun.depth}`);

      const { steps, executions } = await toolEvidence(supportRun.runId);
      if (supportRun.errorCode === "PLANNER_UNAVAILABLE" || supportRun.errorCode === "PLANNER_BUDGET") {
        record("S4", "Support run reached governed tool execution", "BLOCKED",
          `AI provider unavailable (${supportRun.errorCode}); the chain up to planning is proven, execution is not.`);
      } else {
        check("S4", "The run executed governed tools with authoritative execution rows",
          steps.length > 0 && executions.length === steps.length,
          `status=${supportRun.status} agentSteps=${steps.length} toolExecutions=${executions.length} tools=${executions.map((e) => e.toolId).join(",")}`);
      }

      // No matter what the model planned, the money/enforcement surface must be untouched.
      const forbidden = supportRun.steps.filter(
        (s) => s.toolId && /high_risk\.|refund|payout|Ban|Suspend/.test(s.toolId),
      );
      check("S5", "The support flow touched no money or enforcement tool",
        forbidden.length === 0, `forbiddenSteps=${forbidden.length}`);
    }

    // ── T. OPERATIONS: alert → outbox → processor → consumer → agent run ────
    console.log("\n=== T. OPERATIONS END-TO-END ===");

    /**
     * Raise, deliver, and retry ONLY when the AI provider could not serve the planner.
     *
     * By the time this flow runs, the support flow above has already spent the free-tier quota and
     * the operations run lands on PLANNER_UNAVAILABLE every time. That is an environment condition,
     * not a property of the pipeline — and reporting it as a pass would count a provider outage as
     * evidence. Each attempt raises a NEW alert (a fresh alertType), because replay of the same
     * event is correctly idempotent and would never re-plan.
     *
     * The retry is bounded and applies only to provider unavailability. A run that reached the
     * tool layer is judged on its first result.
     */
    const alertTypes: string[] = [];
    let alert: Awaited<ReturnType<typeof opsAlertService.raise>> = null;
    let opsRunAttempt: Awaited<ReturnType<typeof runForSubject>> = null;
    let alertType = "";

    for (let attempt = 0; attempt < 4; attempt += 1) {
      alertType = `phase16_e2e_${Date.now()}_${attempt}`;
      alertTypes.push(alertType);
      alert = await opsAlertService.raise(
        alertType,
        "CRITICAL",
        "Dispatch stalled: 6 bookings unassigned beyond SLA in zone HSR",
      );
      await drainOutbox();
      opsRunAttempt = alert ? await runForSubject("ops_alert", alert.id) : null;
      const code = opsRunAttempt?.errorCode;
      if (code !== "PLANNER_UNAVAILABLE" && code !== "PLANNER_BUDGET") break;
      await new Promise((r) => setTimeout(r, (attempt + 1) * 20_000));
    }

    check("T1", "The alert write produced an outbox row",
      Boolean(alert) &&
        (await prisma.eventOutbox.count({
          where: { aggregateId: alert!.id, eventType: "homigo.ops.alert.raised" },
        })) === 1,
      `alertId=${alert?.id}`);

    const opsRun = opsRunAttempt;

    check("T2", "The outbox processor delivered the alert and an Operations run exists",
      Boolean(opsRun) && opsRun?.agentId === "operations",
      `attempts=${alertTypes.length} runId=${opsRun?.runId ?? "none"} agent=${opsRun?.agentId ?? "-"}`);

    if (opsRun) {
      const { steps, executions } = await toolEvidence(opsRun.runId);
      if (opsRun.errorCode === "PLANNER_UNAVAILABLE" || opsRun.errorCode === "PLANNER_BUDGET") {
        record("T3", "Operations run reached governed tool execution", "BLOCKED",
          `AI provider unavailable (${opsRun.errorCode}).`);
      } else {
        check("T3", "The run executed governed tools with authoritative execution rows",
          steps.length > 0 && executions.length === steps.length,
          `status=${opsRun.status} agentSteps=${steps.length} toolExecutions=${executions.length} tools=${executions.map((e) => e.toolId).join(",")}`);
      }
    }

    // An INFO alert must produce NO run — the trigger condition is real.
    const infoType = `phase16_e2e_info_${Date.now()}`;
    const infoAlert = await opsAlertService.raise(infoType, "INFO", "Surge cleared in Indiranagar");
    await drainOutbox();
    const infoRun = infoAlert ? await runForSubject("ops_alert", infoAlert.id) : null;
    check("T4", "An INFO alert publishes an event but starts no agent run",
      Boolean(infoAlert) && infoRun === null,
      `infoAlertId=${infoAlert?.id} agentRun=${infoRun ? "STARTED" : "none"}`);

    // ── U. PARTNER: pause → outbox → processor → consumer → agent run ───────
    console.log("\n=== U. PARTNER END-TO-END ===");

    await prisma.agentRun.deleteMany({ where: { subjectType: "provider", subjectId: PROVIDER } });
    await partnerOperationsService.setOnline(PROVIDER, true).catch(() => undefined);
    await partnerOperationsService.pause(PROVIDER, "phase16 e2e").catch(() => undefined);

    const partnerClaimed = await drainOutbox();
    const partnerRun = await runForSubject("provider", PROVIDER);

    check("U1", "A real partner pause drives a Partner Operations run through the outbox",
      Boolean(partnerRun) && partnerRun?.agentId === "partner-operations",
      `claimed=${partnerClaimed} runId=${partnerRun?.runId ?? "none"} trigger=${partnerRun?.triggerType ?? "-"}`);

    // ── V. REPLAY: re-delivering the same events must not duplicate work ────
    console.log("\n=== V. REPLAY SAFETY ===");

    const beforeReplay = await prisma.agentRun.count();
    await prisma.eventOutbox.updateMany({
      where: {
        aggregateId: { in: [ticket.id, alert?.id ?? "none"] },
        eventType: { in: ["homigo.support.ticket.created", "homigo.ops.alert.raised"] },
      },
      data: { status: "PENDING", publishedAt: null, attempts: 0 },
    });
    const replayClaimed = await drainOutbox();
    const afterReplay = await prisma.agentRun.count();

    check("V1", "Replaying delivered events creates no additional agent runs",
      afterReplay === beforeReplay,
      `replayClaimed=${replayClaimed} runsBefore=${beforeReplay} runsAfter=${afterReplay}`);

    const dupTicketRuns = await prisma.agentRun.count({ where: { subjectType: "ticket", subjectId: ticket.id } });
    check("V2", "Exactly one run exists for the replayed ticket",
      dupTicketRuns === 1, `runsForTicket=${dupTicketRuns}`);

    // Cleanup fixtures created by this run.
    await prisma.supportTicket.delete({ where: { id: ticket.id } }).catch(() => undefined);
    await prisma.opsAlert.deleteMany({ where: { alertType: { in: [...alertTypes, infoType] } } }).catch(() => undefined);
  } finally {
    await prisma.platformFeatureFlag.deleteMany({ where: { key: { in: Object.values(AGENT_FLAGS) } } });
    __clearFlagMemoryCache();
    console.log("\n[cleanup] agent flags removed; staging returned to default-off");
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`E2E AGENTIC FLOW: ${pass} PASS, ${fail} FAIL, ${blocked} BLOCKED`);
  for (const r of results.filter((x) => x.status !== "PASS")) console.log(`  ${r.status} ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("E2E HARNESS FAILED:", err);
  await prisma.platformFeatureFlag
    .deleteMany({ where: { key: { in: Object.values(AGENT_FLAGS) } } })
    .catch(() => undefined);
  await prisma.$disconnect();
  process.exit(2);
});
