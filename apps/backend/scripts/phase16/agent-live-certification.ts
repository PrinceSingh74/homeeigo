/**
 * Phase 16 — LIVE execution certification.
 *
 * The default-off suite proves the agents are correctly disabled. That is necessary and not
 * sufficient: an agent layer that only ever refuses is trivially "safe" and completely unproven.
 * This script provisions the flags on staging, drives real execution, and then puts the flags
 * back — so the evidence covers the path that actually does something.
 *
 * The canary sequence in §72 is exercised directly: SHADOW first, then a 0% rollout (enabled but
 * excluded), then 100%. Each stage asserts what the run mode actually was, not what was intended.
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { runAgent, getAgentStatuses, initAgents, checkAgentReadiness } from "../../src/agents";
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

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

const ADMIN = "phase16-admin";
const actor = () => ({ actorId: ADMIN, actorRole: "ADMIN" as const, userRole: "ADMIN", traceId: `live-${Date.now()}` });

/** Provision a flag for THIS environment. `currentEnvironment()` keys on APP_ENV, i.e. "staging". */
async function setFlag(key: string, enabled: boolean, rolloutPct = 100): Promise<void> {
  await prisma.platformFeatureFlag.upsert({
    where: { key },
    create: { key, enabled, rolloutPct, environment: "staging", updatedBy: "phase16-cert" },
    update: { enabled, rolloutPct, environment: "staging", updatedBy: "phase16-cert" },
  });
  // The read path caches per process; without eviction the next read serves the old value and the
  // test measures the cache rather than the flag.
  __clearFlagMemoryCache();
}

async function clearFlags(): Promise<void> {
  await prisma.platformFeatureFlag.deleteMany({
    where: { key: { in: Object.values(AGENT_FLAGS) } },
  });
  __clearFlagMemoryCache();
}

async function main(): Promise<void> {
  assertStaging();
  initAgents();

  try {
    // ── K0: readiness is a precondition, and it is stated rather than assumed ──
    const readiness = await checkAgentReadiness();
    check("K0", "Agent layer reports itself ready (tool registry seeded)",
      readiness.ready,
      `ready=${readiness.ready} missingTools=${readiness.missingTools.length} reasons=${readiness.reasons.join(",") || "none"}`);

    // ── K1: default is SHADOW with no flag row at all ─────────────────────
    await clearFlags();
    let statuses = await getAgentStatuses();
    check("K1", "With no flag row, every agent is SHADOW",
      statuses.every((s) => s.effectiveMode === "SHADOW" && s.modeReason.includes("FLAG_MISSING")),
      statuses.map((s) => `${s.agentId}=${s.effectiveMode}`).join(" "));

    // ── K2: flag present but disabled is still SHADOW ─────────────────────
    await setFlag(AGENT_FLAGS.operations, false);
    statuses = await getAgentStatuses();
    const opsOff = statuses.find((s) => s.agentId === "operations")!;
    check("K2", "A disabled flag keeps the agent in SHADOW",
      opsOff.effectiveMode === "SHADOW", `mode=${opsOff.effectiveMode} reason=${opsOff.modeReason}`);

    // ── K3: canary at 0% — enabled, but this subject is excluded ──────────
    await setFlag(AGENT_FLAGS.operations, true, 0);
    const canaryRun = await runAgent({
      agentId: "operations",
      goal: "Review open operational alerts",
      input: "Canary stage: 0 percent rollout.",
      actor: actor(),
      trigger: { type: "MANUAL" },
    });
    check("K3", "A 0% canary rollout does not execute",
      canaryRun.mode === "SHADOW",
      `mode=${canaryRun.mode} status=${canaryRun.status}`);

    // ── K4: full rollout — the agent genuinely goes LIVE ──────────────────
    await setFlag(AGENT_FLAGS.operations, true, 100);
    statuses = await getAgentStatuses();
    const opsOn = statuses.find((s) => s.agentId === "operations")!;
    check("K4", "A fully-enabled flag puts the agent in LIVE",
      opsOn.effectiveMode === "LIVE", `mode=${opsOn.effectiveMode} reason=${opsOn.modeReason}`);

    // ── K5: a LIVE run that really reads through the tool layer ───────────
    const live = await runAgent({
      agentId: "operations",
      goal: "Read the open operational alerts and report what is happening",
      input: "Operational review. Report the open alerts and their severity.",
      actor: actor(),
      trigger: { type: "MANUAL" },
    });
    console.log(`        live run ${live.runId} mode=${live.mode} status=${live.status} steps=${live.steps.length}`);
    console.log(`        summary: ${live.summary.replace(/\n/g, " | ").slice(0, 400)}`);

    if (live.errorCode === "PLANNER_UNAVAILABLE" || live.errorCode === "PLANNER_BUDGET") {
      record("K5", "LIVE run executes real tool calls", "BLOCKED",
        `AI provider unavailable (${live.errorCode}); runtime failed closed as designed.`);
    } else {
      const executed = await prisma.agentRunStep.count({
        where: { runId: live.runId, status: { in: ["VERIFIED", "EXECUTED"] } },
      });
      check("K5", "A LIVE run executes real, recorded tool calls",
        live.mode === "LIVE" && executed > 0,
        `mode=${live.mode} status=${live.status} executedSteps=${executed}`);

      // Every executed step must join to a real tool execution row — the agent's own record is
      // not permitted to be the only evidence that something ran.
      const steps = await prisma.agentRunStep.findMany({
        where: { runId: live.runId, executionId: { not: null } },
        select: { executionId: true, toolId: true },
      });
      const execIds = steps.map((s) => s.executionId!).filter(Boolean);
      const toolRows = execIds.length
        ? await prisma.aiToolExecution.count({ where: { executionId: { in: execIds } } })
        : 0;
      check("K6", "Every agent tool call has an authoritative ai_tool_executions row",
        execIds.length > 0 && toolRows === execIds.length,
        `agentSteps=${execIds.length} toolExecutionRows=${toolRows} tools=${steps.map((s) => s.toolId).join(",")}`);
    }

    // ── K7: read-only agents stay read-only even when fully enabled ───────
    await setFlag(AGENT_FLAGS.finance, true, 100);
    await setFlag(AGENT_FLAGS.fraud, true, 100);
    const financeLive = await runAgent({
      agentId: "finance",
      goal: "Explain the current finance position",
      input: "Report GMV, margin and any failing integrity invariant.",
      actor: actor(),
      trigger: { type: "MANUAL" },
    });
    const fraudLive = await runAgent({
      agentId: "fraud",
      goal: "Brief an investigator on the open fraud queue",
      input: "Summarise open fraud cases and their signals.",
      actor: actor(),
      trigger: { type: "MANUAL" },
    });

    const writes = await prisma.agentRunStep.count({
      where: {
        runId: { in: [financeLive.runId, fraudLive.runId] },
        toolId: { not: { startsWith: "read." } },
      },
    });
    check("K7", "Finance and Fraud perform no write even when fully LIVE",
      writes === 0,
      `financeMode=${financeLive.mode} fraudMode=${fraudLive.mode} nonReadSteps=${writes}`);

    // ── K8: money and enforcement tools were never touched by ANY run ─────
    const forbidden = await prisma.agentRunStep.count({
      where: {
        OR: [
          { toolId: { startsWith: "high_risk." } },
          { toolId: { contains: "refund" } },
          { toolId: { contains: "payout" } },
          { toolId: { contains: "Ban" } },
          { toolId: { contains: "Suspend" } },
        ],
      },
    });
    check("K8", "No agent run has ever touched a money or enforcement tool",
      forbidden === 0, `forbiddenSteps=${forbidden} (across all runs on this database)`);

    // ── K9: the kill switch overrides a fully-enabled flag ────────────────
    const prev = process.env.AGENTS_KILL_SWITCH;
    process.env.AGENTS_KILL_SWITCH = "true";
    const killed = await runAgent({
      agentId: "operations",
      goal: "Attempt to run while killed",
      input: "kill probe",
      actor: actor(),
      trigger: { type: "MANUAL" },
    });
    process.env.AGENTS_KILL_SWITCH = prev;
    check("K9", "The kill switch beats a fully-enabled flag",
      killed.errorCode === "KILL_SWITCH",
      `status=${killed.status} code=${killed.errorCode ?? "-"}`);
  } finally {
    // Always restore. Leaving staging with agents enabled would make the next default-off run
    // measure the leftovers of this one.
    await clearFlags();
    console.log("\n[cleanup] agent flags removed; staging returned to default-off");
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`PHASE 16 LIVE CERTIFICATION: ${pass} PASS, ${fail} FAIL, ${blocked} BLOCKED`);
  for (const r of results.filter((x) => x.status !== "PASS")) console.log(`  ${r.status} ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("LIVE HARNESS FAILED:", err);
  await clearFlags().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(2);
});
