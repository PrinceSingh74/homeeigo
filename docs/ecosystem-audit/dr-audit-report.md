# Disaster Recovery Audit Report

**Audit date:** 2026-06-10  
**Method:** Script inventory + partial live checks (Redis/DB health). Full DR drill **NOT EXECUTED**.

---

## Planned DR Capabilities (code)

| Capability | Script / Mechanism |
|------------|-------------------|
| DB backup | `scripts/backup-db.ts`, `backup-postgres.sh` |
| DB restore | `scripts/restore-postgres.ts`, `restore-postgres.sh` |
| DR restore drill | `scripts/p2-validation/dr-restore-drill.ts` (scratch DB only) |
| Chaos drill | `scripts/dr-chaos-drill.ts` |
| Scheduled backups | `maintenance.ts` if `ENABLE_SCHEDULED_BACKUPS=true` |
| Redis fallback | in-memory when `REDIS_URL` unset |

---

## Scenarios — Execution Status

| Scenario | Executed | Result |
|----------|----------|--------|
| DB crash / recovery | ❌ | `/ready` shows db healthy only |
| Redis crash | ❌ | redis healthy; no kill test |
| Server restart | ⚠️ PARTIAL | backend was running (uptime ~307s at start) |
| Webhook interruption | ❌ | no webhook secret |
| Payment interruption | ⚠️ TEST | adversarial rollback on ledger fail ✅ |
| Queue failure | ❌ | in-process scheduler; no failure injection |
| Network partition | ❌ | not simulated |

---

## Financial Safety (test evidence, not DR drill)

| Invariant | Evidence |
|-----------|----------|
| No duplicate payment | wallet-integrity: 0 double-spend |
| No duplicate booking | concurrency tests in 480-test suite PASS |
| No financial drift | money paise drift 0; 1M paise test PASS |
| Wallet rollback on ledger fail | production-blocker-final PASS |

---

## DR Drill Script Requirements (not met in audit)

```
DR_SCRATCH_DATABASE_URL required (isolated DB)
pg_restore + psql on PATH
```

**`p2:dr` NOT RUN** — would not execute without scratch DB URL and dump file.

---

## Issues

### ISSUE-DR-001 — No DR drill execution
- **Severity:** HIGH
- **Impact:** RTO/RPO unproven
- **Fix:** Configure `DR_SCRATCH_DATABASE_URL`; run `bun run p2:dr`; document RTO
- **Confidence:** HIGH

### ISSUE-DR-002 — S3 backup validation not run
- **Severity:** MEDIUM
- **Fix:** `bun run p2:s3` with AWS credentials
- **Confidence:** HIGH

### ISSUE-DR-003 — Redis single point for rate limits/WS fan-out
- **Severity:** MEDIUM
- **Impact:** Degraded mode on Redis loss (in-memory fallback) may split-brain schedulers
- **Fix:** Document degraded behavior; test redis kill switch
- **Confidence:** MEDIUM

---

## DR Score: 45/100

Financial invariants tested in unit/adversarial tests; operational DR procedures not executed.
