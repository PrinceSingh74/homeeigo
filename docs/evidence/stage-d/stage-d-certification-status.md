# Stage D — Real Staging Certification Status

**Date:** 2026-08-04  
**Step 7 gate:** PASS (Phase-0 schema certified)  
**Stage D status:** **PARTIAL PASS** — event pipeline proven; API lifecycle blocked on deferred schema  
**D-REMEDIATION:** Wave-1 certified — clean replay **31/31 PASS** @ RC `c31f154` — see `step-d-wave1-clean-replay-certification.md`

---

## Current state

| Gate | Status | Notes |
|------|--------|-------|
| Step 7 schema | PASS | 23/23 migrations, physical schema verified |
| Events on staging | **OFF** | Revision `00019-8hr` — baseline preserved |
| staging-safety opt-in | **COMMITTED** | `STAGING_EVENTS_CERTIFICATION=1` required |
| Certification harness | **COMMITTED** | `scripts/stage-d-staging-certification.ts` |
| Stage D deploy script | **COMMITTED** | `deploy/scripts/staging-gcp-deploy-stage-d.ps1` |
| Razorpay TEST keys | **BLOCKED** | `STAGING_RAZORPAY_KEY_ID` = PLACEHOLDER |
| Cloud Run deploy (Stage D) | **DONE** — revisions `00020-jxd` (outbox), `00021-h64` (consumers) |
| 30–60 min soak | **PENDING** — After deploy + harness PASS |

---

## Execution checklist (your flow)

| Step | Automated | Status |
|------|-----------|--------|
| Real staging user | Harness uses DB fixtures | Pending deploy |
| Real booking creation | `stage-d-staging-certification.ts` D2 | **BLOCKED** — P2022 deferred columns; apply Wave-1 |
| booking.created | Outbox verify | Ready |
| Partner assignment | D3 dispatch + accept | Ready |
| booking.assigned | Outbox verify | Ready |
| Partner dispatched | D3 | Ready |
| en_route | D4 tracking + `en_route_at` | Ready |
| arrived | D4 + `arrived_at`, `travel_duration_min` | Ready |
| booking.started | D5 | Ready |
| booking.completed | D5 | Ready |
| Razorpay TEST payment | Manual / API | **BLOCKED** (placeholder secrets) |
| Outbox persistence | D8 | Ready |
| Consumer processing | Harness + live processor | Ready after deploy |
| Duplicate delivery test | D6 idempotency | Ready |
| Idempotency proof | Unique index + D6 | Ready |
| Intentional failure → DLQ | D7 | Ready |
| Operator replay | D7 replayDeadLetterById | Ready |
| Multi-instance concurrency | Cloud Run min-instances=2 | Configured in deploy |
| Metrics / alerts | Prometheus rules exist | Manual soak watch |
| 30–60 min soak | Manual | Pending |
| STAGE D CERTIFIED | — | **NOT YET** |

---

## Next commands

### 1. Deploy Stage D (after commit on branch)

```powershell
$SHA = git rev-parse HEAD
D:\homigo\deploy\scripts\staging-gcp-deploy-stage-d.ps1 -CommitSha $SHA
```

Incremental rollout (outbox first):

```powershell
D:\homigo\deploy\scripts\staging-gcp-deploy-stage-d.ps1 -CommitSha $SHA -OutboxOnly
```

### 2. Run certification harness (Cloud Run Job or local with staging secrets)

```bash
STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
  bun --env-file=.env.staging run scripts/stage-d-staging-certification.ts
```

### 3. Configure Razorpay TEST (unblocks payment gate)

```powershell
# Replace with real rzp_test_* credentials from Razorpay dashboard
echo -n "rzp_test_XXXX" | gcloud secrets versions add STAGING_RAZORPAY_KEY_ID --data-file=- --project=homigo-497619
```

### 4. Soak (30–60 min)

See `stage-d-runbook.md` Phase 4.

---

## Rollback

```powershell
D:\homigo\deploy\scripts\staging-gcp-deploy.ps1 -CommitSha e459175c72b1ece6e6246e5d69f559f23cd0a23e
```

Restores events OFF on certified Phase-0 RC image.

---

## D-REMEDIATION (Wave-1)

Before full API E2E can pass, apply **8 deferred migrations** (not all 25):

1. Commit Wave-1 manifest migrations (exclude superseded `09260000`, `12000000`)
2. Clean DB replay proof → 31/31 migrations
3. PITR marker + apply to staging
4. Re-run harness D2–D8

Details: `docs/evidence/stage-d/step-d-remediation.md`  
Manifest: `docs/evidence/stage-d/wave-1-migration-manifest.json`

---

## References

- D-REMEDIATION: `docs/evidence/stage-d/step-d-remediation.md`
- Runbook: `docs/evidence/stage-d/stage-d-runbook.md`
- Step 7: `docs/evidence/stage-c-step-7/step-7-schema-certification.md`
- Event ops: `apps/backend/docs/intelligence/phase-0-event-foundation.md`
