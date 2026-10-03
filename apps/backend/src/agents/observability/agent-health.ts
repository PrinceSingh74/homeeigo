import prisma from "../../lib/prisma";
import { agentsConfig, executionEnvironmentAllowed } from "../config";
import { evaluateFlag } from "../../services/feature-flag.service";
import { listAgentDefinitions } from "../registry/agent-registry";
import { checkAgentReadiness } from "../readiness";
import type { AgentId } from "../types";

/**
 * The operational state of each agent, computed from what is actually true.
 *
 * The control centre needs more than "LIVE or SHADOW". §30 asks for ten distinguishable states,
 * and the only way to show them honestly is to derive each one from a real signal — a flag row, a
 * readiness probe, a run count, a failure ratio. Nothing here is inferred from intent.
 *
 * The states are deliberately ORDERED by severity in `resolveState`, because several can be true
 * at once and an operator must see the one that most changes what they should do. An agent that is
 * both `CONTROLLED` (partial rollout) and `BLOCKED` (kill switch) is BLOCKED — showing CONTROLLED
 * would be technically accurate and operationally a lie.
 */

export type AgentOperationalState =
  /** The layer or this agent is switched off. Nothing runs, not even planning. */
  | "OFF"
  /** Planning and authorising, deliberately performing no side effects. */
  | "SHADOW"
  /** Live, healthy, nothing in flight. */
  | "READY"
  /** Live with runs currently in flight. */
  | "RUNNING"
  /** Work is sitting with a human. Not a failure — the designed high-risk outcome. */
  | "WAITING_APPROVAL"
  /** Live, but failing or failing verification at a rate that needs attention. */
  | "DEGRADED"
  /** Cannot execute for a reason outside the flag: kill switch, or unmet readiness. */
  | "BLOCKED"
  /** Live and failing almost everything. Distinct from DEGRADED by severity. */
  | "ERROR"
  /** Enabled at a partial rollout percentage. */
  | "CONTROLLED"
  /** Enabled at full rollout. */
  | "LIVE";

export type AgentHealth = {
  agentId: AgentId;
  state: AgentOperationalState;
  /** Why this state, in a form an operator can act on. Never just the state name again. */
  stateReason: string;
  /** LIVE means side effects are permitted right now; SHADOW means they are not. */
  executionMode: "LIVE" | "SHADOW" | "REFUSED";
  rolloutPct: number | null;
  /** Null when the platform has no measurement, NOT zero. */
  metrics: {
    windowHours: number;
    runs: number | null;
    completed: number | null;
    failed: number | null;
    escalated: number | null;
    inFlight: number;
    verificationFailures: number | null;
    successRate: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    costUsd: number | null;
    lastRunAt: string | null;
  };
  pendingApprovals: number;
};

/**
 * How many runs are needed before a rate is worth showing.
 *
 * Below this the UI is told to render INSUFFICIENT DATA rather than a percentage. One failure out
 * of one run is not "0% success" in any useful sense, and a control centre that says so will be
 * ignored within a week.
 */
const MIN_RUNS_FOR_RATE = 5;

/** Failure ratios that separate healthy from degraded from broken. Measured, not decorative. */
const DEGRADED_FAILURE_RATIO = 0.3;
const ERROR_FAILURE_RATIO = 0.9;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

async function collectMetrics(agentId: AgentId, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const [rows, inFlight, verificationFailures, lastRun] = await Promise.all([
    prisma.agentRun.findMany({
      where: { agentId, createdAt: { gte: since } },
      select: { status: true, latencyMs: true, costUsd: true },
    }),
    prisma.agentRun.count({
      where: {
        agentId,
        status: { in: ["CREATED", "PLANNING", "WAITING_POLICY", "EXECUTING", "VERIFYING"] },
      },
    }),
    prisma.agentRunStep.count({
      where: { status: "VERIFICATION_FAILED", createdAt: { gte: since }, run: { agentId } },
    }),
    prisma.agentRun.findFirst({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const runs = rows.length;
  // No runs in the window means no measurement — null, never zero. A control centre that reports
  // "0% success" for an agent nobody has used is reporting a failure that did not happen.
  if (runs === 0) {
    return {
      windowHours,
      runs: 0,
      completed: null,
      failed: null,
      escalated: null,
      inFlight,
      verificationFailures: null,
      successRate: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
      costUsd: null,
      lastRunAt: lastRun?.createdAt.toISOString() ?? null,
    };
  }

  const completed = rows.filter((r) => r.status === "COMPLETED").length;
  const failed = rows.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length;
  const escalated = rows.filter((r) => r.status === "ESCALATED").length;
  const latencies = rows
    .map((r) => r.latencyMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);

  return {
    windowHours,
    runs,
    completed,
    failed,
    escalated,
    inFlight,
    verificationFailures,
    // Below the threshold a ratio is noise. The UI renders INSUFFICIENT DATA for null.
    successRate: runs >= MIN_RUNS_FOR_RATE ? completed / runs : null,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
    p95LatencyMs: percentile(latencies, 95),
    costUsd: rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    lastRunAt: lastRun?.createdAt.toISOString() ?? null,
  };
}

/**
 * Resolve the single state to show, most-actionable first.
 *
 * Ordering is the whole design. Several conditions can hold simultaneously, and the operator needs
 * the one that changes their next action. BLOCKED outranks CONTROLLED because a kill switch makes
 * the rollout percentage irrelevant; WAITING_APPROVAL outranks RUNNING because a human is the
 * bottleneck; DEGRADED outranks READY because an agent that is technically available and failing a
 * third of its runs is not ready for anything.
 */
function resolveState(input: {
  layerEnabled: boolean;
  killSwitch: boolean;
  ready: boolean;
  envAllowed: boolean;
  flagEnabled: boolean;
  rolloutPct: number | null;
  pendingApprovals: number;
  metrics: AgentHealth["metrics"];
}): { state: AgentOperationalState; reason: string } {
  if (!input.layerEnabled) {
    return { state: "OFF", reason: "AGENTS_ENABLED is not true — the whole layer is switched off" };
  }
  if (input.killSwitch) {
    return { state: "BLOCKED", reason: "Kill switch engaged — no new run will start in any mode" };
  }
  if (!input.ready) {
    return {
      state: "BLOCKED",
      reason: "Tool registry incomplete — every tool call would fail at the audit write",
    };
  }
  if (input.pendingApprovals > 0) {
    return {
      state: "WAITING_APPROVAL",
      reason: `${input.pendingApprovals} action(s) awaiting a human decision`,
    };
  }

  if (!input.envAllowed) {
    return { state: "SHADOW", reason: "This environment is not permitted to execute side effects" };
  }
  if (!input.flagEnabled) {
    return { state: "SHADOW", reason: "Feature flag is off — planning only, no side effects" };
  }

  const { runs, failed, successRate } = input.metrics;
  if (runs !== null && runs >= MIN_RUNS_FOR_RATE && failed !== null) {
    const failureRatio = failed / runs;
    if (failureRatio >= ERROR_FAILURE_RATIO) {
      return {
        state: "ERROR",
        reason: `${Math.round(failureRatio * 100)}% of recent runs failed — the agent is enabled and not working`,
      };
    }
    if (failureRatio >= DEGRADED_FAILURE_RATIO) {
      return {
        state: "DEGRADED",
        reason: `${Math.round(failureRatio * 100)}% of recent runs failed`,
      };
    }
  }

  if (input.metrics.inFlight > 0) {
    return { state: "RUNNING", reason: `${input.metrics.inFlight} run(s) currently in flight` };
  }

  if (input.rolloutPct !== null && input.rolloutPct < 100) {
    return {
      state: "CONTROLLED",
      reason: `Enabled at ${input.rolloutPct}% rollout`,
    };
  }

  // READY vs LIVE: LIVE says the agent has actually done work recently; READY says it is able to
  // and has not. Collapsing them would hide "enabled but never exercised", which is exactly the
  // state a canary needs to distinguish.
  if (successRate !== null) {
    return { state: "LIVE", reason: "Fully enabled and executing" };
  }
  return { state: "READY", reason: "Fully enabled, no runs in the measurement window" };
}

export async function getAgentHealth(windowHours = 24): Promise<AgentHealth[]> {
  const env = executionEnvironmentAllowed();
  const readiness = await checkAgentReadiness();

  return Promise.all(
    listAgentDefinitions().map(async (def) => {
      const [flagRow, metrics, pendingApprovals] = await Promise.all([
        prisma.platformFeatureFlag
          .findUnique({ where: { key: def.flagKey }, select: { enabled: true, rolloutPct: true } })
          .catch(() => null),
        collectMetrics(def.agentId, windowHours),
        /**
         * Approvals raised BY this agent's runs.
         *
         * Joined through `agent_run_steps` rather than counting the whole approval queue, so an
         * unrelated admin approval never makes an agent look like it is waiting on a human.
         */
        prisma.agentRunStep
          .count({
            where: {
              approvalId: { not: null },
              status: "AWAITING_APPROVAL",
              run: { agentId: def.agentId },
            },
          })
          .catch(() => 0),
      ]);

      const flag = await evaluateFlag(def.flagKey, def.agentId).catch(() => ({
        enabled: false,
        reason: "LOOKUP_FAILED" as const,
      }));

      const { state, reason } = resolveState({
        layerEnabled: agentsConfig.enabled,
        killSwitch: agentsConfig.killSwitch,
        ready: readiness.ready,
        envAllowed: env.allowed,
        flagEnabled: flag.enabled,
        rolloutPct: flagRow?.rolloutPct ?? null,
        pendingApprovals,
        metrics,
      });

      const executionMode: AgentHealth["executionMode"] =
        !agentsConfig.enabled || agentsConfig.killSwitch
          ? "REFUSED"
          : env.allowed && flag.enabled
            ? "LIVE"
            : "SHADOW";

      return {
        agentId: def.agentId,
        state,
        stateReason: reason,
        executionMode,
        rolloutPct: flagRow?.enabled ? (flagRow.rolloutPct ?? null) : null,
        metrics,
        pendingApprovals,
      };
    }),
  );
}

/**
 * Dependency health for the control centre.
 *
 * Each entry is measured, and a probe that cannot run reports UNKNOWN — never OK. §66 forbids
 * rendering unavailable as healthy, and the only way to honour that is for the producer to be
 * capable of saying "I do not know".
 */
export type DependencyHealth = {
  name: string;
  status: "OK" | "DEGRADED" | "DOWN" | "UNKNOWN";
  detail: string;
};

export async function getDependencyHealth(): Promise<DependencyHealth[]> {
  const out: DependencyHealth[] = [];

  const probe = async (
    name: string,
    fn: () => Promise<{ status: DependencyHealth["status"]; detail: string }>,
  ) => {
    try {
      out.push({ name, ...(await fn()) });
    } catch (err) {
      out.push({
        name,
        status: "UNKNOWN",
        detail: `probe failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  };

  await probe("Database", async () => {
    const t0 = Date.now();
    await prisma.$queryRawUnsafe("SELECT 1");
    const ms = Date.now() - t0;
    return { status: ms < 500 ? "OK" : "DEGRADED", detail: `${ms}ms round trip` };
  });

  await probe("Tool registry", async () => {
    const r = await checkAgentReadiness();
    return r.ready
      ? { status: "OK", detail: "every capability tool resolves" }
      : { status: "DOWN", detail: `${r.missingTools.length} capability tools missing` };
  });

  await probe("EventOutbox", async () => {
    const [pending, failed] = await Promise.all([
      prisma.eventOutbox.count({ where: { status: "PENDING" } }),
      prisma.eventOutbox.count({ where: { status: "FAILED" } }),
    ]);
    if (failed > 0) return { status: "DEGRADED", detail: `${failed} failed, ${pending} pending` };
    return { status: "OK", detail: `${pending} pending, 0 failed` };
  });

  await probe("Scheduler", async () => {
    const { listJobHandlers } = await import("../../events/core/job-registry");
    const agentJobs = listJobHandlers().filter((j) => j.startsWith("agent."));
    return agentJobs.length >= 2
      ? { status: "OK", detail: `${agentJobs.length} agent jobs registered` }
      : { status: "DOWN", detail: `only ${agentJobs.length} agent jobs registered` };
  });

  await probe("Audit trail", async () => {
    const recent = await prisma.enterpriseAuditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
    });
    // Zero audit rows in 24h is not automatically a fault — it may simply be a quiet system. It is
    // reported as UNKNOWN rather than OK or DOWN, because this probe genuinely cannot tell.
    return recent > 0
      ? { status: "OK", detail: `${recent} governance rows in 24h` }
      : { status: "UNKNOWN", detail: "no governance rows in 24h — quiet system or broken writer" };
  });

  await probe("AI Gateway", async () => {
    const recent = await prisma.agentRun.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } },
      select: { errorCode: true },
    });
    if (recent.length === 0) {
      return { status: "UNKNOWN", detail: "no agent runs in the last hour to judge from" };
    }
    const providerFailures = recent.filter((r) => r.errorCode === "PLANNER_UNAVAILABLE").length;
    const ratio = providerFailures / recent.length;
    if (ratio >= 0.5) return { status: "DEGRADED", detail: `${providerFailures}/${recent.length} runs hit provider errors` };
    return { status: "OK", detail: `${recent.length - providerFailures}/${recent.length} runs reached a provider` };
  });

  return out;
}
