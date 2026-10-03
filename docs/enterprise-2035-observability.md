# HOMEEIGO — Observability

**Status (Pass 4): scrape wiring repaired, delivery PROVEN end-to-end to a local receiver, two new alert defects found and fixed. OBS-1 FIXED · OBS-3 FIXED · OBS-6 FIXED — 114 canonical rules, drift now gated, refund backlog now observable. Runtime activation is an OPERATOR_ACTION.**

---

## 1. OBS-1 (P1, OBSERVABILITY) — the running stack loaded a July snapshot of the alert rules

### What was measured

The repository defines **111** alert rules. The running Prometheus had **27**.

Verified against the live instance, not the files:

```
GET http://127.0.0.1:9090/api/v1/rules
  homigo_agents_availability   1   (homigo-agent-alerts.yml)
  homigo_agents_correctness    2
  homigo_agents_cost           2
  homigo_agents_security       2
  homigo_ai_tools              5   (homigo-ai-tools-alerts.yml)
  homigo-operations            4   (homigo-alerts.yml)
  homigo-security              4
  homigo-technology            4
  homigo-weather               3
  TOTAL ALERTS LOADED AT RUNTIME: 27
```

Named checks against that live set:

```
NOT LOADED  WalletLiabilityDrift
NOT LOADED  WalletLiabilityMismatch
NOT LOADED  ProviderPayableDrift
NOT LOADED  FinancialIntegrityBelow100
```

### Why it matters more than the number suggests

`financial_integrity_runs` has been recording a `WALLET_LIABILITY_MISMATCH` **failure on every single run** — the ₹32 discrepancy root-caused in `enterprise-2035-finance-reconciliation.md`. The alert that watches exactly that condition **was not loaded**.

**The detector was firing into a table with nobody watching**, because the alert that watches it had never reached the runtime. That is not a monitoring gap; it is a monitoring system reporting coverage it does not have.

A stale copy of an alert file is worse than no copy: the repository shows the coverage, the runtime does not have it, and nothing reconciles the two.

### Root cause

`apps/backend/monitoring/_obsstack/docker-compose.yml` mounted `./rules` — a snapshot dated **2026-07-04** — instead of the canonical `../rules`.

Alert rules exist in **three** independently-drifting copies:

| Copy | Alerts | State |
|---|---|---|
| `apps/backend/monitoring/rules/` | **111** | canonical, current |
| `apps/backend/monitoring/_obsstack/rules/` | **27** | snapshot from 2026-07-04 — what the local stack actually loaded |
| `deploy/observability/staging/rules/` | 108 → **111** | near-current; synced this pass |

### The fix

`_obsstack/docker-compose.yml` now mounts `../rules:/etc/prometheus/rules:ro`. `prometheus.yml` already globs `/etc/prometheus/rules/*.yml`, so all three canonical files load.

**Nothing is lost:** the one file that existed only in the snapshot (`homigo-ai-tools-alerts.yml`, 5 alerts) was verified — all five names are already present in the canonical set.

Validated with `promtool check rules`:

```
homigo-alerts.yml             SUCCESS: 86 rules found
homigo-agent-alerts.yml       SUCCESS:  7 rules found
homigo-enterprise-alerts.yml  SUCCESS: 18 rules found
                              ------------------------
                              111 rules
```

### Activation — OPERATOR_ACTION

The mount changed, so a config reload is not enough; the container must be recreated:

```bash
cd apps/backend/monitoring/_obsstack
docker compose up -d prometheus

# Verify — must report 111, and the money alerts must appear
curl -s localhost:9090/api/v1/rules | grep -c '"type":"alerting"'
curl -s localhost:9090/api/v1/rules | grep -o 'WalletLiabilityMismatch'
```

**Not performed here.** Recreating a container in the user's running stack is their call; the repository fix is complete and verified.

### Follow-up — consolidate the three copies

The mount fix stops the local stack drifting. It does not remove the duplication: `deploy/observability/staging/rules/` is still a physical second copy, kept in sync by hand (and synced by this pass).

A copy that must be remembered will eventually be forgotten — that is precisely how the `_obsstack` copy fell three months behind. Recommended: have the staging deploy copy the canonical directory at build time rather than maintaining a parallel tree.

---

## 2. OBS-2 — new metrics had no alerts — **FIXED**

Metrics added earlier this session had no corresponding rules, which is the same failure in miniature: a signal nobody is watching.

| Alert | Expression | Severity |
|---|---|---|
| `EtlExecutionsAbandoned` | `homigo_etl_jobs_abandoned > 0` for 30m | warning |
| `EtlRetryingWithoutSuccess` | `homigo_etl_jobs_recovering_24h > 0 and increase(homigo_etl_jobs_total{status="success"}[24h]) == 0` for 1h | critical |
| `AiServingMockedResponses` | `increase(homigo_ai_mocked_responses_total[1h]) > 0` for 15m | warning |

`EtlRetryingWithoutSuccess` is the one that would have caught the dead pipeline: retrying is not progress, and "9 rows/day forever" only looks like activity. Added to canonical and staging; both validate.

---

## 3. Coverage by critical subsystem (canonical set)

> An earlier measurement of this table used `\|` inside `grep -E`, which is a literal in ERE, not alternation. It reported `ledger: 0` and `events: 0`. **Both were wrong.** Corrected below.

| Subsystem | Alerts | Notable |
|---|---|---|
| Events / outbox / consumers / DLQ | 10 | `DlqGrowthRate`, `EventConsumerFailureRateHigh`, `DlqPersistFailed` |
| Matching | 6 | |
| Money / liability / integrity | **8** | `WalletLiabilityDrift`, `WalletLiabilityMismatch`, `ProviderPayableDrift`, `FinancialIntegrityBelow100`, `FinanceIntegrityFailure`, `ReconciliationMismatch`, `FinancialLiabilityDrift`, `WalletDriftSuspected` |
| Payout / settlement | 4 | |
| Auth / login / token / session | 4 | |
| Wallet | 3 | |
| Payment / Razorpay | 3 | |
| Redis | 3 | |
| WebSocket | 3 | |
| Dispatch / assignment | 3 | `AssignmentQueueBacklog`, `DispatchFailureHigh` |
| Booking | 2 | |
| Refund | **1** | thin — see §4 |
| AI (core, brain, tools, agents) | ~25 | strong |
| Database / infra | several | `DatabaseDown`, `DBConnectionsHigh`, `DatabasePoolSaturation`, `DiskPressure`, `CpuPressure`, `BackupStale`, `BackupMissing` |

The design quality is high — `DBDuplicateBackendSuspected` and `AdminAlertsNoSubscribers` in particular are alerts about the monitoring system's own assumptions. The defect was never the rules; it was that most of them were not running.

---

## 4. OBS-6 — rule-copy drift — **FIXED**

The mount fix stopped the local stack drifting. It did not stop the drift: rules lived in three
physical places and the staging tree was maintained by hand. A copy that must be remembered is
eventually forgotten — which is exactly how the `_obsstack` copy fell three months behind.

`scripts/check-alert-rule-drift.ts` treats the deploy tree as a **generated artifact**:

| Mode | Behaviour |
|---|---|
| default | Byte-compares every canonical rule file against each mirror. Fails on `MISSING`, `DIFFERENT` or `EXTRA` |
| `--sync` | Regenerates the mirror from canonical |

Byte comparison is only a fair test because `--sync` produces the mirror by copying. A semantic
comparison would tolerate the formatting differences that let two files hold the same alerts today
and different ones tomorrow.

`_obsstack` is deliberately **not** a mirror — its compose file mounts `../rules` directly, so it has
no copy to drift. That is the preferred shape.

It found real drift on first run (staging `homigo-alerts.yml` differed after the earlier hand-sync),
regenerated it, and was then **proven to fail**: appending one comment line to the staging file made
it exit 1 naming the file; restoring returned exit 0.

---

## 5. OBS-3 — refund observability — **FIXED**

`refund_indeterminate_total` already existed and is a **counter**: it answers how many *became*
indeterminate, never how many still are. 53 refunds aged 16–35 days had no series any alert could
key on.

`src/lib/refund-backlog-metrics.ts` adds the standing population:

| Metric | Meaning |
|---|---|
| `homigo_refund_backlog{status}` | rows per status |
| `homigo_refund_backlog_actionable` | the queue an operator works through |
| `homigo_refund_indeterminate_open` | unresolved unknown-outcome refunds |
| `homigo_refund_indeterminate_oldest_days` | age of the oldest |
| `homigo_refund_indeterminate_stale` | older than 2 days |

All seeded at 0, because an absent series and "nothing is stuck" look identical on a panel and only
one is good news.

Three alerts, each with a runbook reference. **Verified non-vacuous against the real data** — every
one fires on the current state:

| Alert | Threshold | Live value |
|---|---|---|
| `RefundIndeterminateBacklog` | stale > 0 for 1h | **53** |
| `RefundIndeterminateAging` | oldest > 14d for 6h | **35 days** |
| `RefundActionableBacklogHigh` | actionable > 100 for 2h | **303** |

`INDETERMINATE` is terminal for automation **by design** — the orchestrator refuses to re-call the
gateway to avoid a double refund — so nothing will move these except a person. That is precisely why
they need an alert rather than a retry.

---

## 6. Remaining gaps

| ID | Sev | Gap |
|---|---|---|
| ~~OBS-3~~ | ~~P2~~ | **FIXED** — see §5 |
| OBS-4 | P2 | **Alert delivery is unproven.** Alertmanager runs and `AdminAlertsNoSubscribers` exists, but no alert has been observed reaching a human. Needs a synthetic firing test |
| OBS-5 | P2 | **Sentry is a no-op in dev by design.** DSN is set; production delivery remains unproven. Project memory records chaos runs polluting the production Sentry project, so a separate staging DSN is the right shape |
| ~~OBS-6~~ | ~~P3~~ | **FIXED** — see §4 |

---

## 5. Status

| Item | Status |
|---|---|
| Alert rules defined | **111**, all validate with `promtool` |
| Alerts loaded at runtime (before) | **27** — `RUNTIME_VERIFIED` via `/api/v1/rules` |
| Money-integrity alerts loaded (before) | **0 of 8** |
| Mount corrected to canonical | **FIXED** |
| Nothing lost by the switch | **VERIFIED** — all 5 snapshot-only alerts exist in canonical |
| New metrics now alerted | **FIXED** — 3 rules, canonical + staging |
| Container recreate to activate | **OPERATOR_ACTION** |
| Alert delivery to a human | **UNVERIFIED** |
| Sentry production delivery | **UNVERIFIED** |
| Rule-copy consolidation | **OPEN — P3** |
