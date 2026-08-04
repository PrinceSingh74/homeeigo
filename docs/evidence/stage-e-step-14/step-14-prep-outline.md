# Stage E — Step 14 Prep Outline (NOT STARTED)

**Prerequisite:** Step 13 CLOSED (multi-instance outbox PASS @ RC `c31f154`)  
**Certified revision:** `homigo-backend-staging-00029-pbn`  
**Expected next focus:** Worker crash / stale lease recovery & outbox claim safety under failure

---

## Likely Step 14 Scope (Stage E — Reliability Torture)

Based on Step 13 deferrals and outbox implementation @ RC `c31f154`:

| Area | Objective |
|------|-----------|
| Stale lock recovery | Prove `PROCESSING` rows with expired `locked_at` reset to `PENDING` and are reclaimed |
| Worker crash simulation | Leader loses lock mid-batch; no lost events, no duplicate effects |
| Lease timeout | Validate `EVENTS_OUTBOX_LOCK_TIMEOUT_MS` (default 120s) behavior on staging |
| Recovery drain | All injected events reach terminal state after simulated failure |
| Idempotency hold | `event_consumer_receipts` UNIQUE constraint survives recovery retries |

## Implementation hooks (RC forensic)

- `recoverStaleClaims()` in `outbox-processor.ts` — resets stale PROCESSING → PENDING
- `runWithLeaderLock("maintenance:event_outbox")` — leader failover on crash
- `markFailed()` / retry with `available_at` backoff

## Pre-flight (reuse Step 13 baseline)

- [ ] RC `c31f154` + digest `sha256:0ad025…` still serving
- [ ] minScale ≥ 2, events ON, staging DB only
- [ ] Migrations 31/31 unchanged
- [ ] New `STEP14_RUN_ID` marker for synthetic events

## Artifacts to produce (when authorized)

- `docs/evidence/stage-e-step-14/step-14-lease-recovery-certification.md`
- `step-14-failure-injection.json`
- `step-14-recovery-reconciliation.json`
- `step-14-event-manifest.json`

---

**Status:** PREP ONLY — await explicit Step 14 execution authorization.
