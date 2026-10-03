# PHASE 16 — PRODUCTION READINESS

## Verified

| Item | Status | Evidence |
|---|---|---|
| Runtime | Boots, validates, registers | `agents_initialized` with all 5 definitions |
| Database migration | Applied | `20260910090000_phase16_agent_runtime` on staging |
| Migration safety | Additive only | 4 enums, 2 tables, 11 indexes, 1 FK — no column dropped |
| Feature flags | Missing = disabled | K1: all 5 SHADOW with `FLAG_MISSING` |
| Kill switch | Stops all new runs | J1, K9 |
| AI budget | Reused, not duplicated | gateway reservation path |
| Model registry / prompts | Registered | 5 planner templates in `BUILTIN_TEMPLATES` |
| Audit | Verified persistence | forensic F5, F15 |
| RBAC | Agent role, not caller role | forensic F14a |
| Workflow / events | One consumer, computed subscription | L1 |
| Scheduler | 2 jobs on the existing registry | M1, M2 |
| Observability | 18 series, bounded cardinality | forensic F11a |
| Recovery | Orphan sweep, never blind restart | N1, N2, N3 |
| Rollback | Flags, kill switch, version pinning | see below |
| Admin UI | Built | exit 0, both routes emitted |
| Regression | No subsystem broken | 473 pass / 0 fail |

## NOT verified — stated plainly

**No production deployment exists.** Consistent with the platform's standing position (there is no
deployed runtime and no production auth mechanism), Phase 16 has been certified on **staging**
only. Every claim in these documents is a staging claim.

**Production canary not performed.** §72's rollout ladder is implemented and its stages were
exercised on staging (K1→K2→K3→K4), but no production canary has run, because there is no
production runtime to run it in.

**Grafana dashboards not authored.** The metrics are emitted and scrapeable; the 18 existing
dashboards were not extended.

**Two event triggers not wired.** `homigo.support.ticket.created` and `homigo.ops.alert.raised` do
not exist as events. Declared in `UNWIRED_TRIGGERS` and asserted by L2 rather than faked.

**Load behaviour unmeasured.** No 1k/10k/100k agent-run load test was performed.

**Some chaos conditions untested.** Database outage mid-run, Redis outage mid-run and partial
provider network failure were not injected.

## Pre-production checklist

Ordered so that each step is reversible before the next increases exposure.

1. **Apply the migration.** `prisma migrate deploy`. Additive; safe to apply ahead of the code.
2. **Seed the tool registry.** `seedToolRegistry()` runs at boot, but confirm
   `GET /api/agents` reports `readiness.ready = true` before enabling anything. An enabled agent
   against an unseeded registry fails every tool call opaquely.
3. **Set `AGENTS_ENABLED=true`.** Alone this changes nothing observable: with no flag rows every
   agent is SHADOW.
4. **Confirm `APP_ENV`** is in `AGENT_EXECUTION_ENVIRONMENTS` (default `production,staging`). An
   unrecognised value keeps every agent in SHADOW — the allowlist is what makes an unreviewed
   environment fail closed.
5. **Observe shadow.** Let the agents plan without executing. Compare recorded plans against what
   humans actually did. Shadow output is directly comparable: the exact arguments that *would*
   have been used are recorded.
6. **Enable ONE agent at 1 %.** Not all five. Start with `PHASE16_FINANCE_ASSISTANT` or
   `PHASE16_FRAUD_INVESTIGATION_ASSISTANT` — both are structurally read-only, so the worst case is
   a wasted inference call.
7. **Then one write-capable agent at 1 %,** and widen only on evidence:
   `homigo_agent_verification_total{verdict="FAILED"}` at zero,
   `homigo_agent_escalation_total` behaving as expected, cost within budget.
8. **Keep the kill switch reachable.** `AGENTS_KILL_SWITCH=true` stops all new runs within the
   flag cache TTL (30 s worst case, immediate with Redis broadcast).

## Rollback

| Level | Action | Effect |
|---|---|---|
| One agent | Set its flag `enabled=false` | That agent returns to SHADOW |
| All agents | `AGENTS_KILL_SWITCH=true` | No new run starts, any mode |
| Whole layer | `AGENTS_ENABLED=false` | Layer inert; routes still answer |
| Code | Revert the Phase-16 commit | Additive tables remain; nothing else reads them |
| Schema | Leave the migration applied | Two unused tables; no existing table was altered |

Irreversible business actions are **not** rolled back by any of these, deliberately. Where a side
effect may have landed, the run is `ESCALATED` for human reconciliation — compensation, not a fake
rollback.

## Required environment

```
AGENTS_ENABLED=false                              # default; explicit true to enable
AGENTS_KILL_SWITCH=false
AGENT_EXECUTION_ENVIRONMENTS=production,staging   # allowlist, never a deny-list
AGENT_MAX_STEPS=8  AGENT_MAX_TOOL_CALLS=12
AGENT_MAX_ELAPSED_MS=120000  AGENT_MAX_COST_USD=0.5
AGENT_MAX_TOKENS=24000  AGENT_MAX_DEPTH=2
AGENT_RATE_LIMIT_PER_MINUTE=20  AGENT_LEASE_MS=180000
AGENT_PLAN_TIMEOUT_MS=25000
```

Feature flag rows are **not** created by deployment. Provisioning one is a separate, deliberate
admin act — a flag that arrives switched on has skipped the review it exists to gate.
