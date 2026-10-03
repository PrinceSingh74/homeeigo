"use client";

import type { ReactNode } from "react";
import {
  AGENT_STATE,
  DEPENDENCY_STATE,
  RISK_TONE,
  RUN_STATUS_TONE,
  TONE_CLASS,
  TONE_DOT,
  type StateTone,
} from "@/lib/agent-states";
import type { AgentOperationalState, DependencyHealth } from "@/services/agents-api";

/**
 * Shared agent UI primitives.
 *
 * Every badge, dot and metric on every agent screen comes from here, so a state cannot be styled
 * one way on the control centre and another way in the run timeline. The vocabulary lives in
 * `lib/agent-states.ts`; this file only renders it.
 */

export function Badge({
  tone,
  children,
  title,
}: {
  tone: StateTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The agent state badge.
 *
 * `title` carries the server's reason, so hovering any state answers "why" without a round trip —
 * and the reason is the server's words, never re-derived on the client.
 */
export function AgentStateBadge({
  state,
  reason,
}: {
  state: AgentOperationalState;
  reason?: string;
}) {
  const p = AGENT_STATE[state];
  return (
    <Badge tone={p.tone} title={reason ?? p.hint}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[p.tone]}`} aria-hidden />
      {p.label}
    </Badge>
  );
}

export function DependencyBadge({ status }: { status: DependencyHealth["status"] }) {
  const p = DEPENDENCY_STATE[status];
  return (
    <Badge tone={p.tone} title={p.hint}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[p.tone]}`} aria-hidden />
      {p.label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const tone = RUN_STATUS_TONE[status] ?? "neutral";
  return <Badge tone={tone}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return <span className="text-[var(--color-biz-muted)]">—</span>;
  return <Badge tone={RISK_TONE[risk] ?? "neutral"}>{risk}</Badge>;
}

/**
 * A labelled metric.
 *
 * `emphasis` is deliberately not "is this bad" — the caller decides that from the data, because
 * whether a number is bad depends on which number it is. Escalations rising is not a fault.
 */
export function Metric({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: StateTone;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${
          emphasis ? TONE_CLASS[emphasis].split(" ").find((c) => c.startsWith("text-")) : ""
        }`}
        title={hint}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A panel that can honestly say it has nothing to show.
 *
 * Three distinct empty states, because they mean different things and an operator responds to each
 * differently: still loading, genuinely nothing yet, or the data could not be fetched. Collapsing
 * them into one blank area is how "the API is down" gets read as "everything is quiet".
 */
export function PanelState({
  loading,
  error,
  empty,
  emptyLabel,
  children,
}: {
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-biz-muted)]">
        <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--color-biz-muted)]" aria-hidden />
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-red-400" role="alert">
        This data could not be loaded. It is unavailable, which is not the same as empty.
      </div>
    );
  }
  if (empty) {
    return (
      <div className="p-6 text-sm text-[var(--color-biz-muted)]">
        {emptyLabel ?? "Nothing recorded yet."}
      </div>
    );
  }
  return <>{children}</>;
}

export function SectionHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}
