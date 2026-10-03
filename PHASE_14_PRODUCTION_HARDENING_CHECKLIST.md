# PHASE 14 — Production Hardening Checklist

**Date:** 2026-09-05
**Purpose:** separate what is *built and verified in development* from what is *live in production*.
These are not the same thing, and every row below says which.

| Status | Meaning |
|---|---|
| `DEVELOPMENT_VERIFIED` | Implemented, enforced and proven by execution against `homigo_p39` / `homigo_test` |
| `STAGING_VERIFIED` | Proven on the staging stack |
| `PRODUCTION_VERIFIED` | Proven against production state |
| `PRODUCTION_DEPLOYMENT_REQUIRED` | Built and verified in dev; **not yet live in production** |

---

## A. The blocking item

### A1 — `20260907090100_audit_trace_not_unique`

**`PRODUCTION_DEPLOYMENT_REQUIRED`. This is the highest-priority item in the phase.**

`enterprise_audit_logs.trace_id` is `UNIQUE` in production **right now**, verified directly:

| Database | Index | State |
|---|---|---|
| **`homigo_db` (production)** | `enterprise_audit_logs_trace_id_key` | **UNIQUE — defect live** |
| `homigo_p39` | `enterprise_audit_logs_trace_id_idx` | plain — fixed |
| `homigo_test` | `enterprise_audit_logs_trace_id_idx` | plain — fixed |
| `homigo_dr_drill` | `enterprise_audit_logs_trace_id_idx` | plain — fixed |

**Consequence while unapplied:** any request emitting more than one governance event records only
the first. The rest fail their insert and are swallowed by the audit service's catch. An approval
and the promotion it authorises share a request, so that pair is precisely the one that loses its
second half.

#### Migration rehearsed against real production data

Not a dry statement — the production audit table was copied into a scratch database and the
migration applied to it:

| Step | Result |
|---|---|
| Rows copied from `homigo_db` | **346,070** (31,975,750-byte dump) |
| Integrity hashes present | 346,070 |
| Pre-migration index | `enterprise_audit_logs_trace_id_key` → **UNIQUE** |
| Migration runtime | **1,457 ms** |
| Post-migration index | `enterprise_audit_logs_trace_id_idx` → **plain** |
| Row + hash + id checksum before | `346070\|346070\|d061460fd8caa3f9d89020784dfb7fd0` |
| Row + hash + id checksum after | `346070\|346070\|d061460fd8caa3f9d89020784dfb7fd0` |
| **Data integrity** | **PASS — byte-identical** |
| Post-migration invariant | Two rows inserted on one trace → **2 stored** |

The scratch database was dropped afterwards.

#### Deployment notes — measured, not assumed

- **Lock behaviour:** `DROP INDEX` takes `ACCESS EXCLUSIVE`, `CREATE INDEX` takes `SHARE`. Audit
  **writes** are blocked for the duration; reads of other columns are not.
- **Measured duration: ~1.5 s** on 346,070 rows. No maintenance window is asserted — that is the
  deployer's call — but this is the real number to base it on.
- **`CREATE INDEX CONCURRENTLY` is not usable here**: it cannot run inside a transaction, and
  Prisma wraps each migration in one. The 1.5 s blocking form is the correct trade.
- **Blocked audit writes do not error out callers.** `AuditLogService.record` is fail-open and
  waits on the lock; the governance-critical path (`recordGoverned`) is admin-initiated and
  low-volume, so a 1.5 s stall there is a stall, not a failure.
- **Reversible.** The inverse is `DROP INDEX enterprise_audit_logs_trace_id_idx; CREATE UNIQUE
  INDEX enterprise_audit_logs_trace_id_key ON enterprise_audit_logs(trace_id);` — but only while
  no trace is yet shared. Once the platform starts recording multiple events per trace, reverting
  will fail on the duplicates it exists to permit. **Roll forward, not back.**

#### Post-deployment verification

```sql
-- must return 0 rows
SELECT indexname FROM pg_indexes
 WHERE tablename = 'enterprise_audit_logs' AND indexdef LIKE '%UNIQUE%'
   AND indexname LIKE '%trace%';
```

### A2 — `20260907090200_retention_categories`

**`PRODUCTION_DEPLOYMENT_REQUIRED`.** Production's `retention_category` enum was read directly and
carries only the original five values:

```
SECURITY_EVENTS, PAYMENT_EVENTS, FINANCIAL_LEDGER, LOGIN_EVENTS, SYSTEM_LOGS
```

`AI_TELEMETRY`, `AUTOMATION_TELEMETRY` and `OPERATIONAL_ACTIVITY` are absent, so the telemetry
retention sweep cannot run there. `ALTER TYPE … ADD VALUE IF NOT EXISTS` is additive and cannot
affect existing rows. **Adding the values deletes nothing** — the sweep is driven by
`audit_retention_policies` rows, and none exist.

### A3 — `20260907090000_phase14_governance`

**`PRODUCTION_DEPLOYMENT_REQUIRED`.** Creates `ai_budget_policies`, `ai_budget_windows`, their
enums, and adds `ai_tool_policy_logs.policy_version`. Verified absent from production:
`ai_budget*` tables → **0**.

Additive only. Until applied, **the AI spend cap cannot function in production** — the enforcement
code is deployed-safe (it queries `ai_budget_policies`; a missing table surfaces as
`BUDGET_UNAVAILABLE`, which is permissive by design) but there is no cap to enforce.

---

## B. Requirement status

| # | Control | Development | Staging | Production | Evidence |
|---|---|---|---|---|---|
| 1 | **audit_trace_not_unique** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | 10 sequential + 10 concurrent events on one trace → 10 stored each; migration rehearsed on 346,070 production rows |
| 2 | **AI budget control** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | 30 concurrent vs cap-for-5 → committed `$0.138000` = limit exactly |
| 3 | **AI budget — no ungoverned door** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Vision bypass found and closed; guard test fails when reintroduced |
| 4 | **Frequency caps** | `DEVELOPMENT_VERIFIED` (notifications only) | pre-existing | pre-existing, live | `NotificationCadenceReservation` unique `idempotencyKey` |
| 5 | **Workflow recovery** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (code only; no migration) | 2 operators → 1 RECOVERED / 1 LOST_RACE, 1 wake-up job |
| 6 | **Event replay** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (code only) | Canonical audit + mandatory reason; idempotency pre-existing |
| 7 | **Model rollback** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | `supersededVersionId` stored at promotion |
| 8 | **Policy engine** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | Fail-closed via `tool-bridge`; ALLOW audited (34 → 35) |
| 9 | **Policy versioning** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (needs A3) | `rules.v10.282c390e` stamped; pre-fix rows keep `NULL` |
| 10 | **Privacy controls** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | 690 series, 48 label keys, 0 forbidden, 0 PII-shaped values |
| 11 | **Retention — governance routing** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (code only) | 9 governance actions no longer map to `SYSTEM_LOGS` |
| 12 | **Retention — telemetry classes** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (needs A2) | No policy → `NO_POLICY`, 35 rows → 35 rows |
| 13 | **Prompt versioning** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | Failure path now carries `promptVersion` |
| 14 | **Workflow versioning** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | Boot fingerprint; instance pins version + mode |
| 15 | **Model versioning** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | Partial unique index on PRODUCTION stage |
| 16 | **Experiment stop switch** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (code only) | unregistered 0/200 · running 200/200 · paused 0/200 |
| 17 | **DR restore** | `DEVELOPMENT_VERIFIED` | — | **not drilled in production** | All 10 governance tables at parity; 16,563/16,563 hashes |
| 18 | **Governance audit fails closed** | `DEVELOPMENT_VERIFIED` | not applied | **`PRODUCTION_DEPLOYMENT_REQUIRED`** (code only) | Real outage: governed act **threw**, LOGIN unaffected |
| 19 | **Security / RBAC** | `DEVELOPMENT_VERIFIED` | pre-existing | pre-existing, live | 4 new routes mapped; unmapped `/api/admin/*` denied by default |

---

## C. Deployment order

The migrations are independent, but this order minimises the window in which the audit fix is
half-present:

1. **`20260907090100_audit_trace_not_unique`** — highest priority; ~1.5 s of blocked audit writes.
   Stops ongoing governance-record loss.
2. **`20260907090000_phase14_governance`** — creates the budget tables and `policy_version`.
   Nothing enforces until a policy row is created, so this is safe to apply ahead of any decision
   about limits.
3. **`20260907090200_retention_categories`** — adds three enum values. Deletes nothing; the sweep
   stays a no-op until someone writes a retention policy.

Application code can deploy before or after 2 and 3 — it degrades safely without them
(`BUDGET_UNAVAILABLE`, `NO_POLICY`). It should deploy **after** 1, so the audit fix is in place
before the new governance events start sharing traces.

---

## D. Post-deployment verification

```sql
-- 1. audit trace capacity
SELECT count(*) FROM pg_indexes
 WHERE tablename='enterprise_audit_logs' AND indexdef LIKE '%UNIQUE%' AND indexname LIKE '%trace%';
-- expect 0

-- 2. budget tables present, and deliberately empty
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'ai_budget%') AS tables,
       (SELECT count(*) FROM ai_budget_policies) AS policies;
-- expect tables=2, policies=0  (no cap is a decision, not a defect)

-- 3. policy version column
SELECT count(*) FROM information_schema.columns
 WHERE table_name='ai_tool_policy_logs' AND column_name='policy_version';
-- expect 1

-- 4. retention categories
SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
 WHERE t.typname='retention_category'
   AND e.enumlabel IN ('AI_TELEMETRY','AUTOMATION_TELEMETRY','OPERATIONAL_ACTIVITY');
-- expect 3
```

Runtime check after deploy — two governance events under one trace must both persist:

```sql
SELECT trace_id, count(*) FROM enterprise_audit_logs
 WHERE created_at > now() - interval '1 hour'
 GROUP BY trace_id HAVING count(*) > 1 LIMIT 5;
```

Before the migration this query **can never return a row**. That it can is the fix working.

---

## E. What deployment does NOT do

- **It sets no spend cap.** `ai_budget_policies` ships empty, and `NO_POLICY_CONFIGURED` is
  counted so the absence is visible. The limit is a business decision.
- **It deletes no data.** All three migrations are additive apart from one index swap; the
  retention sweep no-ops without a policy row.
- **It changes no pricing behaviour.** The experiment's arms remain identical and it remains
  suppressed until someone registers it.
- **It does not make the platform DPDP-compliant.** These are technical controls; the legal
  interpretation does not exist in this repository.

---

## F. Blocked on someone else

| # | Item | Type |
|---|---|---|
| 1 | Production migration window | **PRODUCTION_DEPLOYMENT_REQUIRED** — items A1–A3 |
| 2 | The AI spend limit | HUMAN_DECISION_REQUIRED |
| 3 | Retention durations for the three new categories | HUMAN_DECISION_REQUIRED |
| 4 | RPO / RTO targets | HUMAN_DECISION_REQUIRED |
| 5 | Experiment treatment behaviour and owner | HUMAN_DECISION_REQUIRED |
| 6 | Legal DPDP interpretation | LEGAL_DECISION_REQUIRED |
| 7 | BigQuery billing | EXTERNAL_ARTIFACT_REQUIRED |
| 8 | Backup encryption / off-host storage verification | EXTERNAL_ARTIFACT_REQUIRED |
| 9 | Staging rehearsal of all three migrations | Recommended before production |
