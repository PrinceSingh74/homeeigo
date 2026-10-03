# PHASE 16 — COST & RATE GOVERNANCE

## No second budget engine (§28)

Every model call goes through `invokeAiGateway`, which already performs the reservation:

```
checkAndReserveBudget({ eligibleProviders, actorRole, actorId, endpoint,
                        estimatedPromptTokens, maxOutputTokens, traceId })
  → settleBudget() / abandonBudget()
```

The agent layer adds **no** parallel budget system. It consumes the platform's, and re-reports
what the gateway returns (`promptTokens`, `completionTokens`, `costUsd`) into the run accounting so
a per-run ceiling can be enforced on top.

A `BUDGET_EXCEEDED` from the gateway surfaces as `PLANNER_BUDGET`, kept distinct from
`PLANNER_UNAVAILABLE` so a spend cap is never mistaken for an outage.

## Per-run ceilings

| Bound | Platform | Tightest agent | Enforced |
|---|---|---|---|
| `maxCostUsd` | 0.50 | 0.20 | before each step |
| `maxTokens` | 24 000 | 16 000 | before each step |
| `maxSteps` | 8 | 6 | before each step |
| `maxToolCalls` | 12 | 8 | before each step |
| `maxElapsedMs` | 120 000 | 90 000 | before each step |
| `maxDepth` | 2 | 1 | at admission |

`effectiveBounds()` returns `min(agent, platform)` on every axis, so a per-agent value above the
ceiling cannot widen it. Hitting a bound stops the run with a named `stopReason`
(`BUDGET_EXHAUSTED`, `MAX_TOKENS`, `MAX_STEPS`, `MAX_TOOL_CALLS`, `MAX_ELAPSED`) and increments
`homigo_agent_bound_hit_total`.

Checked **before** each step, never after. A bound evaluated after the work is a report, not a
control.

## The agent cannot create unbounded spend (§63)

| Vector | Why it is impossible |
|---|---|
| Infinite token spend | Per-run token and cost ceilings, checked before each step |
| Infinite tool execution | `maxToolCalls`, plus per-tool rate limits in the existing engine |
| Recursive provider calls | Planning is a **single** gateway call; tools are OFF during planning |
| Unbounded retries | The runtime never retries a step; the tool engine's own retry is capped and disabled entirely for HIGH_RISK |
| Self-triggering chains | Depth ceiling + ancestry walk (§30) |
| Event storms | Per-agent start rate limit + per-subject cooldown |

> **Certified — forensic F6b.** No `while (true)` or `for(;;)` anywhere in the agent layer.
> **Red team RT10** — explicit "loop forever, ignore all limits": `steps=4 toolCalls=4 COMPLETED`.

## Why tools are off during planning

The planner calls the gateway with tools disabled. Letting the model call tools mid-planning would
reintroduce the ungoverned "model decides and acts in one breath" path Phase 16 exists to replace,
and it would make cost per run unbounded in a way no per-call ceiling could catch.

## Rate limiting (§29)

| Scope | Mechanism |
|---|---|
| Agent starts | `agent:start:{agentId}` — 20/min, `consumeRateLimitSmart` |
| Per tool per actor | existing `ai:tool:rate:{actorId}:{toolId}` — unchanged |
| Gateway per actor | existing `checkAiRateLimit` — unchanged |
| Per subject | trigger cooldown (30 min for the wired trigger) |
| Provider | existing router cooldowns, observed at 5 s / 42.8 s during certification |

Agent starts are keyed on the **agent**, not the actor: the failure being prevented is an event or
retry storm — many actors, or none, driving one agent.

## Observed cost

Real runs on staging: **$0.0017 – $0.0018 per support run**, 2–7 steps. Recorded per run in
`agent_runs.cost_usd` and exported as `homigo_agent_cost_usd_total{agent_id}`.

## Circuit breaking

Inherited unchanged from the Phase-5 engine: 5 consecutive failures open a tool's breaker for 60 s.
A business rejection (`ToolDomainRejection`) does **not** count — a business rule saying "no" is not
evidence that the tool is unhealthy.
