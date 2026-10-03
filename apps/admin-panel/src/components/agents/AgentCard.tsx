"use client";

import Link from "next/link";
import { ChevronRight, Lock, ShieldAlert } from "lucide-react";
import { AgentStateBadge, Badge, Metric } from "./AgentPrimitives";
import {
  formatCost,
  formatCount,
  formatMs,
  formatRate,
  formatRelative,
} from "@/lib/agent-states";
import type { AgentHealth, AgentStatus } from "@/services/agents-api";

/**
 * One agent, summarised for an operations screen.
 *
 * Density is the point: an operator scanning five of these needs state, why, throughput, cost and
 * whether a human is blocked — without expanding anything. Detail lives one click away rather than
 * inside a card that has to be unfolded before it says anything.
 *
 * Deliberately NOT here: a "go live" toggle. Execution is decided by the environment allowlist and
 * the feature flag on the server; a control that appeared to override either would be a rollout
 * bypass dressed as convenience. The card explains state; it does not grant it.
 */
export function AgentCard({
  status,
  health,
}: {
  status: AgentStatus;
  health: AgentHealth | undefined;
}) {
  const m = health?.metrics;

  return (
    <Link
      href={`/agents/${status.agentId}`}
      className="group biz-glass-panel block rounded-xl p-4 transition-colors hover:border-[var(--color-biz-line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-biz-accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{status.name}</h3>
            {health ? (
              <AgentStateBadge state={health.state} reason={health.stateReason} />
            ) : null}
            {status.readOnly ? (
              <Badge tone="info" title="Holds no write capability at all — enforced at registry load">
                <Lock className="h-3 w-3" aria-hidden />
                Read-only
              </Badge>
            ) : null}
          </div>
          {/*
            The reason line, always. "Shadow" alone invites "something is broken"; "Shadow —
            feature flag is off" says the agent is off because nobody turned it on, which is the
            intended default and a completely different situation.
          */}
          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-biz-muted)]">
            {health?.stateReason ?? status.description}
          </p>
        </div>
        <ChevronRight
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-biz-muted)] transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>

      {health && health.pendingApprovals > 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {health.pendingApprovals} action{health.pendingApprovals === 1 ? "" : "s"} awaiting a human
          decision
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Metric
          label={`Runs / ${m?.windowHours ?? 24}h`}
          value={formatCount(m?.runs ?? null)}
          hint="Runs started in the measurement window"
        />
        <Metric
          label="Success"
          value={formatRate(m?.successRate ?? null)}
          hint="Null below five runs — a rate from one run is noise"
          emphasis={
            m?.successRate == null
              ? undefined
              : m.successRate >= 0.9
                ? "positive"
                : m.successRate >= 0.7
                  ? "attention"
                  : "critical"
          }
        />
        <Metric
          label="Escalated"
          value={formatCount(m?.escalated ?? null)}
          hint="Handed to a human — a designed outcome, not a failure"
        />
        <Metric
          label="p95 latency"
          value={formatMs(m?.p95LatencyMs ?? null)}
          hint="Includes planning, dominated by provider latency"
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-biz-line)] pt-3 text-[11px] text-[var(--color-biz-muted)]">
        <span className="font-mono">
          v{status.version} · {status.toolsetVersion}
        </span>
        <span className="flex items-center gap-3">
          <span title="Inference spend in the window">{formatCost(m?.costUsd ?? null)}</span>
          <span title="Most recent run">{formatRelative(m?.lastRunAt ?? null)}</span>
        </span>
      </div>
    </Link>
  );
}
