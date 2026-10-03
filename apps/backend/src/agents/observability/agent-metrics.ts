import { incCounter, observeHist, setGauge } from "../../lib/metrics";

/**
 * Phase 16 agent telemetry.
 *
 * Label cardinality is bounded by construction: every label below is either an agent id (five
 * values), a mode (two), a risk tier (three), or a closed reason/verdict code. No run id, no
 * actor id, no ticket id, no free text, and no model-authored string ever becomes a label —
 * §55 applies to metrics as much as to logs, and an unbounded label is both a PII leak and a
 * way to take Prometheus down.
 */

export function recordAgentRunStarted(agentId: string, mode: string, trigger: string): void {
  incCounter("homigo_agent_runs_total", { agent_id: agentId, mode, trigger });
}

/** Terminal outcome of a run. `status` is the AgentRunStatus enum, so the set is closed. */
export function recordAgentRunCompleted(agentId: string, mode: string, status: string): void {
  incCounter("homigo_agent_run_outcome_total", { agent_id: agentId, mode, status });
}

/** A run was refused before it started. `code` is the closed AgentAdmissionRefusal union. */
export function recordAgentAdmissionRefused(agentId: string, code: string): void {
  incCounter("homigo_agent_admission_refused_total", { agent_id: agentId, code });
}

/**
 * A plan was rejected. `code` is the closed PlanRejection union.
 *
 * `UNKNOWN_CAPABILITY` on this counter is the one worth alerting on: it means a model asked for
 * something outside its agent's vocabulary, which is either a prompt-injection attempt or a
 * genuine drift between the prompt and the registry. Both need a human.
 */
export function recordAgentPlanRejected(agentId: string, code: string): void {
  incCounter("homigo_agent_plan_rejected_total", { agent_id: agentId, code });
}

export function recordAgentPlanAccepted(agentId: string, riskTier: string, steps: number): void {
  incCounter("homigo_agent_plan_accepted_total", { agent_id: agentId, risk_tier: riskTier });
  // A counter pair, not a histogram: `observeHist` here buckets by DURATION, so a step count of
  // 3 would be filed as "3 seconds" and every plan would pile into the same tail bucket. Summed
  // steps over accepted plans gives the mean plan length, which is the question actually asked.
  incCounter("homigo_agent_plan_steps_total", { agent_id: agentId }, steps);
}

/** How a step was disposed of: EXECUTE, SHADOW or ESCALATE. */
export function recordAgentStepDisposition(agentId: string, action: string, riskTier: string): void {
  incCounter("homigo_agent_step_disposition_total", { agent_id: agentId, action, risk_tier: riskTier });
}

export function recordAgentToolCall(agentId: string, status: string): void {
  incCounter("homigo_agent_tool_calls_total", { agent_id: agentId, status });
}

/**
 * A post-condition verdict. VERIFIED / FAILED / UNKNOWN / NOT_APPLICABLE.
 *
 * FAILED and UNKNOWN are the interesting series. A tool that reports success while its
 * post-condition fails is the exact discrepancy §14 exists to surface, and it is invisible in
 * the tool-layer metrics because there the call genuinely succeeded.
 */
export function recordAgentVerification(agentId: string, verdict: string): void {
  incCounter("homigo_agent_verification_total", { agent_id: agentId, verdict });
}

/**
 * How old the data behind a step turned out to be. FRESH / STALE / UNKNOWN / NOT_REQUIRED.
 *
 * UNKNOWN is the series worth watching. A capability that starts returning results with no
 * datable timestamp has not broken — every read still succeeds and every dashboard still fills —
 * but it has quietly stopped being usable as evidence for a write, and this counter is the only
 * place that becomes visible before an operator notices agents escalating for no obvious reason.
 */
export function recordAgentFreshness(agentId: string, verdict: string): void {
  incCounter("homigo_agent_freshness_total", { agent_id: agentId, verdict });
}

/**
 * A write refused because the evidence behind it was stale or undatable.
 *
 * Separate from the escalation counter on purpose: this is the one escalation reason that points
 * at a DATA problem rather than a risk decision, and burying it among human-approval escalations
 * would hide a degrading cache behind a number that is supposed to be large.
 */
export function recordAgentStaleEvidenceBlock(agentId: string, verdict: string): void {
  incCounter("homigo_agent_stale_evidence_blocked_total", { agent_id: agentId, verdict });
}

export function recordAgentEscalation(agentId: string, reason: string): void {
  incCounter("homigo_agent_escalation_total", { agent_id: agentId, reason });
}

/** A run stopped on a bound: MAX_STEPS, MAX_TOOL_CALLS, BUDGET_EXHAUSTED, ELAPSED, TOKENS. */
export function recordAgentBoundHit(agentId: string, bound: string): void {
  incCounter("homigo_agent_bound_hit_total", { agent_id: agentId, bound });
}

/** Recursion or self-trigger refused. The counter §30 asks to be able to see. */
export function recordAgentLoopPrevented(agentId: string, kind: string): void {
  incCounter("homigo_agent_loop_prevented_total", { agent_id: agentId, kind });
}

/** A duplicate trigger collapsed onto an existing run instead of starting a second one. */
export function recordAgentDuplicateSuppressed(agentId: string, trigger: string): void {
  incCounter("homigo_agent_duplicate_suppressed_total", { agent_id: agentId, trigger });
}

export function recordAgentLatency(agentId: string, mode: string, ms: number): void {
  // Seconds. `observeHist` buckets against DURATION_BUCKETS, which are expressed in seconds —
  // passing milliseconds would put every run in the overflow bucket and make the histogram
  // read as "everything is slow" regardless of what actually happened.
  observeHist("homigo_agent_run_latency_seconds", ms / 1000, { agent_id: agentId, mode });
}

export function recordAgentCost(agentId: string, costUsd: number): void {
  incCounter("homigo_agent_cost_usd_total", { agent_id: agentId }, costUsd);
}

export function recordAgentTokens(agentId: string, prompt: number, completion: number): void {
  incCounter("homigo_agent_tokens_total", { agent_id: agentId, kind: "prompt" }, prompt);
  incCounter("homigo_agent_tokens_total", { agent_id: agentId, kind: "completion" }, completion);
}

/** Orphaned runs recovered by the sweep. A sustained non-zero value means processes are dying. */
export function recordAgentRecovered(agentId: string, action: string): void {
  incCounter("homigo_agent_recovered_total", { agent_id: agentId, action });
}

/**
 * Publish the series at zero on boot.
 *
 * NO DATA and 0 mean completely different things — "nothing happened" versus "the exporter is
 * broken" — and Grafana renders them almost identically. A panel that has never had a sample looks
 * like a healthy flat line, and an alert on a series that does not exist can never fire.
 *
 * Seeding a counter at zero asserts only that the counter EXISTS and has counted nothing, which is
 * true. That is not a fake zero: a fake zero would report 0 for something actually non-zero or
 * unmeasurable, and nothing here does that.
 *
 * The label sets are exactly the ones the Grafana board queries, and no more. An earlier version
 * seeded five series and left nine of the eighteen charted metrics absent until their first
 * occurrence — the observability self-test now asserts the dashboard and the exporter agree.
 * Cardinality stays bounded: five agents × closed enums, no ids.
 */
export function initAgentMetricsAtZero(agentIds: string[]): void {
  for (const agentId of agentIds) {
    for (const mode of ["SHADOW", "LIVE"]) {
      for (const trigger of ["MANUAL", "EVENT", "SCHEDULE"]) {
        incCounter("homigo_agent_runs_total", { agent_id: agentId, mode, trigger }, 0);
      }
      for (const status of ["COMPLETED", "FAILED", "ESCALATED"]) {
        incCounter("homigo_agent_run_outcome_total", { agent_id: agentId, mode, status }, 0);
      }
    }

    // Security-relevant refusals. These are the series where "zero" and "not reporting" must be
    // distinguishable, because a silent one reads as "no attempted escalations".
    for (const code of ["UNKNOWN_CAPABILITY", "UNKNOWN_ARGUMENT"]) {
      incCounter("homigo_agent_plan_rejected_total", { agent_id: agentId, code }, 0);
    }
    for (const kind of ["RECURSION_CYCLE_DETECTED", "RECURSION_DEPTH_EXCEEDED"]) {
      incCounter("homigo_agent_loop_prevented_total", { agent_id: agentId, kind }, 0);
    }
    for (const code of ["KILL_SWITCH", "RATE_LIMITED"]) {
      incCounter("homigo_agent_admission_refused_total", { agent_id: agentId, code }, 0);
    }

    // Correctness. A missing FAILED or UNKNOWN series looks exactly like a healthy one.
    for (const verdict of ["VERIFIED", "FAILED", "UNKNOWN", "NOT_APPLICABLE"]) {
      incCounter("homigo_agent_verification_total", { agent_id: agentId, verdict }, 0);
    }
    for (const reason of ["HIGH_RISK_REQUIRES_HUMAN", "READ_ONLY_AGENT"]) {
      incCounter("homigo_agent_escalation_total", { agent_id: agentId, reason }, 0);
    }

    // Freshness. STALE and UNKNOWN are the series a dashboard must be able to show as a real
    // zero, because "no stale reads" and "the freshness check stopped running" look identical
    // when the series is simply absent.
    for (const verdict of ["FRESH", "STALE", "UNKNOWN", "NOT_REQUIRED"]) {
      incCounter("homigo_agent_freshness_total", { agent_id: agentId, verdict }, 0);
    }
    for (const verdict of ["STALE", "UNKNOWN"]) {
      incCounter("homigo_agent_stale_evidence_blocked_total", { agent_id: agentId, verdict }, 0);
    }

    // §8 refusals. A request that asked for information and got a plan proposing a change is a
    // model-behaviour signal, and it needs to be visible as zero rather than missing.
    for (const code of ["INTENT_FORBIDS_SIDE_EFFECT", "INTENT_HUMAN_ONLY", "NEEDS_CLARIFICATION"]) {
      incCounter("homigo_agent_plan_rejected_total", { agent_id: agentId, code }, 0);
    }

    for (const action of ["EXECUTE", "SHADOW", "ESCALATE"]) {
      for (const risk_tier of ["LOW", "MEDIUM", "HIGH"]) {
        incCounter("homigo_agent_step_disposition_total", { agent_id: agentId, action, risk_tier }, 0);
      }
    }

    for (const status of ["SUCCESS", "FAILED"]) {
      incCounter("homigo_agent_tool_calls_total", { agent_id: agentId, status }, 0);
    }
    incCounter("homigo_agent_plan_accepted_total", { agent_id: agentId, risk_tier: "LOW" }, 0);
    incCounter("homigo_agent_plan_steps_total", { agent_id: agentId }, 0);
    incCounter("homigo_agent_cost_usd_total", { agent_id: agentId }, 0);
    for (const kind of ["prompt", "completion"]) {
      incCounter("homigo_agent_tokens_total", { agent_id: agentId, kind }, 0);
    }
    incCounter("homigo_agent_duplicate_suppressed_total", { agent_id: agentId, trigger: "EVENT" }, 0);
    for (const action of ["TIMED_OUT", "ESCALATED"]) {
      incCounter("homigo_agent_recovered_total", { agent_id: agentId, action }, 0);
    }
    incCounter("homigo_agent_bound_hit_total", { agent_id: agentId, bound: "MAX_STEPS" }, 0);
  }
}

/**
 * Whether each agent is currently permitted to execute.
 *
 * A gauge rather than a log line because "which agents were live at the time" is a question
 * asked after an incident, and by then the log has rotated.
 */
export function setAgentEnabledGauge(agentId: string, live: boolean): void {
  setGauge("homigo_agent_live", live ? 1 : 0, { agent_id: agentId });
}
