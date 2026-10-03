# PHASE 14 — Resilience Matrix

Every row was exercised, not described. The DR drill in §A was run this phase against an isolated
database; `homigo_db` was never written to.

---

## A. Disaster recovery drill — executed

**Question this phase asked that a normal DR test does not:** a restore that brings back bookings
and payments but loses *who approved the model that was serving*, *what the spend cap was*, or
*which experiment was running* has restored the business and lost the governance. §90 makes that
the test.

| Step | Result |
|---|---|
| `pg_dump -Fc` of `homigo_p39` | **10,871,736 bytes** |
| Archive integrity (`pg_restore --list`) | **204 TABLE DATA entries** |
| Restore into isolated `homigo_dr_drill` | `pg_restore` **exit 0** |
| Production touched | **No** — source was `homigo_p39`, target a scratch database |

### Governance state after restore

| Table | Source | Restored | Result |
|---|---|---|---|
| `ai_budget_policies` | 1 | 1 | **OK** |
| `ai_budget_windows` | 1 | 1 | **OK** |
| `ai_tool_policy_logs` | 35 | 35 | **OK** |
| `workflow_definitions` | 25 | 25 | **OK** |
| `workflow_instances` | 0 | 0 | **OK** |
| `ml_model_versions` | 1 | 1 | **OK** |
| `platform_experiments` | 1 | 1 | **OK** |
| `audit_retention_policies` | 5 | 5 | **OK** |
| `ai_prompt_versions` | 12 | 12 | **OK** |
| `consent_records` | 0 | 0 | **OK** |
| `enterprise_audit_logs` | 16,568 | 16,563 | **explained below** |

**The 5-row gap is not loss.** The backend was still running and writing audit rows while the dump
was taken. Verified rather than assumed:

```
src rows at or before the snapshot instant : 16,563
restored                                    : 16,563
VERDICT: PASS — restore is complete as of the snapshot instant
```

30 further rows were written to the source *after* the snapshot. That is the concrete meaning of
RPO for this platform: a hot `pg_dump` is consistent as of its start, and anything after is not in
it. **No RPO target is asserted** — none exists in this project.

### Governance content, not just row counts

```
audit hashes preserved   : 16563 of 16563
ml approval intact       : p14_dr_model v1 approved_by=p14-drill
budget cap intact        : GLOBAL:* $5 fail_mode=FAIL_CLOSED
experiment state intact  : p14_dr_drill status=running
```

Counts alone would have passed even if every `approved_by` had come back null.

*(The first run of this drill reported a total failure. The cause was Git Bash rewriting the
container path `/tmp/p14_dr.dump` into a Windows path before `docker exec` saw it, so `pg_dump`
never wrote a file. Fixed with `MSYS_NO_PATHCONV=1`. Recorded because a green-to-red flip caused by
the harness is exactly the kind of result that gets misreported as a system defect.)*

---

## B. System-by-system

| System | Failure | Detection | Recovery | Idempotency | Audit | Test | Result |
|---|---|---|---|---|---|---|---|
| **Postgres** | Loss / corruption | Healthcheck; `up` target | `pg_dump`/`pg_restore` into isolated DB | Restore is whole-database | Restored audit intact | **Drill run this phase** | **PASS** |
| **Redis** | Outage | Health checking + auto-reconnect | Rate limits fall back to `consumeRateLimitSmart`'s degraded path | n/a | — | Pre-existing (Phase 5 cert) | **PASS (inherited)** |
| **EventOutbox** | Publish failure | `status=FAILED`, `attempts`, DLQ | `replayDeadLetterById` | `EventConsumerReceipt` gate; `ALREADY_PROCESSED` closes without re-running | **`EVENT_REPLAY_EXECUTED` — added this phase** | Replay path source-verified | **PASS** |
| **Workflow engine** | Worker death mid-step | `STALE_LEASE` (`jobLeaseMs`) | Executor reclaims the lease itself | Optimistic status takeover | Step runs | Detection tested | **PASS — self-healing** |
| **Workflow engine** | Lost wake-up | `LOST_WAKEUP` — `nextRunAt` passed **and** no pending job | Operator `REQUEUE` | Resumes at persisted `stepIndex`; refuses if a job already exists | `WORKFLOW_INSTANCE_RECOVERED` | **3 tests** | **PASS — built this phase** |
| **Workflow engine** | Immortal instance | `EXPIRED_UNTERMINATED` — past the definition's own `maxAgeMs` | Operator `CANCEL` + pending job cancelled | Cancel executes no step | Same | Detection tested | **PASS — built this phase** |
| **Scheduler** | Duplicate execution | — | Leader election / `SKIP LOCKED` | `ScheduledJob` status transitions | — | Pre-existing | **PASS (inherited)** |
| **AI gateway** | Provider outage | Circuit breaker + cooldown | Ordered failover chain | Whole-request deadline | `AiGatewayRequest.fallbackUsed` | Pre-existing | **PASS (inherited)** |
| **AI gateway** | Runaway spend | `homigo_ai_budget_decision_total` | **Cap blocks at the boundary** | Reserve→settle; abandon on failure | `AI_BUDGET_BLOCKED` | **§43 concurrency test** | **PASS — built this phase** |
| **AI budget store** | Unreachable | `BUDGET_UNAVAILABLE` decision + error log | Per-policy `failMode` | Reservation not taken | Logged | Source-verified | **PASS** |
| **ML platform** | Warehouse stale / horizon expired | 4 health checks | Callers fall back to deterministic rules | n/a | — | Phase 12/13 | **PASS (reporting real failure)** |
| **Audit log** | Multiple events per request | — | — | — | — | **1 → 2 stored** | **FIXED this phase** |
| **Audit log** | Write failure, governance act | throw at the call site | caller sees `GOVERNANCE_AUDIT_UNAVAILABLE` | act refused before it is recorded as done | — | real outage drill | **FIXED — fail-closed** |
| **Audit log** | Write failure, high-volume path | `logger.error` | degraded, action proceeds | — | — | same drill | **BY DESIGN — fail-open** |
| **AI vision path** | Ungoverned provider spend | source-wide adapter scan | budget + rate limit + audit applied | reserve/settle, abandon on failure | `AiGatewayRequest` | guard test, verified by deletion | **FIXED this pass** |
| **Observability** | Exporter down | `up = 0`; telemetry data age | Restart | n/a | — | Phase 13: 93/95 panels NO DATA | **PASS (inherited)** |
| **Experiments** | Runaway exposure | Exposure counter | **Stop switch — status read per assignment** | Deterministic bucketing | `EXPERIMENT_CREATED` | **4 tests** | **PASS — built this phase** |

---

## C. Concurrency and idempotency, measured

| Property | Test | Result |
|---|---|---|
| Budget cap under concurrency | 30 simultaneous requests, cap sized for 5 | **5 allowed, 25 denied, committed $0.138000 = limit exactly** |
| Workflow recovery under concurrency | 2 operators, same observation | **1 RECOVERED, 1 LOST_RACE, 1 wake-up job** |
| Reservation release on failure | `abandonBudget` | `reserved = 0`, `settled = 0` |
| UNKNOWN cost never settles as zero | `settleBudget(…, UNKNOWN)` | `unknownCostRequests > 0`, `settledUsd = 0` |
| Experiment assignment stability | 20 repeats, same customer | **1 distinct variant** |
| Notification cadence | `idempotencyKey` unique per reservation | Pre-existing, structurally enforced |
| Replay idempotency | `hasConsumerProcessed` gate | Returns `ALREADY_PROCESSED` without re-running |
| Workflow trigger idempotency | `WorkflowInstance.idempotencyKey` unique | A duplicate trigger cannot open a second instance |

---

## D. Known limitations

**Audit persistence: now split by risk, and no longer a blanket limitation.**

Pass 1 recorded this as unresolved. Pass 2 closed the part that mattered.

`AuditLogService.record` remains fail-open for the high-volume paths — an audit outage must not
take down login, booking or payment. `AuditLogService.recordGoverned` is fail-closed and is used by
model approve/promote/rollback, budget policy changes, event replay and workflow recovery: it
writes the enterprise row, **checks the returned id**, and throws when it is absent. Awaiting alone
would not have sufficed, because `enterpriseAuditService.log` catches its own errors and returns
`null` — the failure would have been swallowed by the very call meant to detect it.

Verified against a **real outage** (the audit table renamed away in the isolated database):

```
governed act           THREW  GOVERNANCE_AUDIT_UNAVAILABLE: ML_MODEL_PROMOTED could not be recorded
LOGIN (must stay open) returned normally
```

**Residual limit, stated rather than glossed:** the ML audit is written outside the transaction
that changed the stage, so a throw surfaces the problem to the caller but does not roll the stage
change back. Making it atomic means threading a transaction client through
`enterpriseAuditService` — a change to a shared service with many callers, and one to make
deliberately.

**`force` replay is reachable in code, not over HTTP.** `replayOutboxEvent({force: true})` deletes
the consumer receipt and could therefore duplicate a consequential side effect. No route reaches
it; the only caller passes `force` defaulting false. Left as-is rather than removed, because
closing a path nothing calls would be speculative — but it is the sharpest edge in the replay
surface and any future caller must gate it.

**RPO and RTO are undefined.** The drill measures the *mechanism* (dump consistency point, restore
exit 0, governance parity). No target exists in this project and none was invented.

**Backup encryption and off-host storage were not verified.** `scripts/backup-postgres.sh` and the
retention helper exist, but whether backups are encrypted at rest and stored off-host depends on
infrastructure this environment does not have. **`EXTERNAL_ARTIFACT_REQUIRED`.**

**Chaos testing was partial.** The DR restore drill ran. Killing workers, cutting Redis mid-flight
and pausing the scheduler under load were not re-run this phase; those paths carry their Phase-5
certification and were not modified here.
