# PHASE 15 - Production Runtime

# STATUS: `RELEASE_BLOCKED_RUNTIME`

There is no deployed production runtime. This document says exactly what to deploy, and corrects an
assumption the release checklist makes about the architecture.

---

## A. Measured state

```
application ports listening (3000/3001/3002/4000/8080) : 0
GET /health on each                                     : no response
```

`homigo_db` holds real data. Nothing serves it.

## B. There is ONE deployable unit, not four

The checklist asks separately about the runtime, the workers, the scheduler and event processing.
**They are the same process.**

```
src/index.ts
  -> lib/maintenance.ts  -> startScheduledJobProcessor()
  -> event bus consumers (metrics.v1, ai-context-indexer.v1, automation-trigger.v1)
  -> workflow engine
Dockerfile CMD: ["bun", "run", "src/index.ts"]
```

There is no worker entrypoint anywhere in the repository. Confirmed by observation, not by reading:
booting the real entry point against a migrated clone brought all four up together -

```
Server: http://localhost:3399
scheduled_job_processor_started  {"intervalMs":10000,"batchSize":25}
event_consumer_ok                metrics.v1 / ai-context-indexer.v1 / automation-trigger.v1
workflow_instance_started        workflowId=checkout_recovery
security:LEDGER_BACKFILL_RUN     scanned=444 backfilled=0 skipped=444 failed=0
```

**Consequences for release:**

- Deploying "the backend" deploys the scheduler, the event processor and the workflow engine too.
  There is no second thing to forget.
- One process failure takes all four down at once. There is no bulkhead between them.
- Horizontal scaling multiplies the schedulers as well as the HTTP servers. The job processor must
  be safe to run concurrently, or `minScale`/replica count must stay at 1 for the scheduler role.
  **This is not verified and should be settled before scaling past one instance.**

## C. Artifacts, inspected

| Artifact | State |
|---|---|
| `apps/backend/Dockerfile` | 3-stage build on `oven/bun:1.3-slim`; `EXPOSE 8080`; `HEALTHCHECK` every 30 s, 4 s timeout, 20 s start period, 3 retries; `CMD bun run src/index.ts` |
| `deploy/cloud-run/service.yaml` | `minScale 1` (no cold start), `maxScale 50`, 1 CPU / 1 Gi, `containerPort 8080`. **`REGION` and `PROJECT_ID` are placeholders and must be filled** |
| `apps/backend/deploy/homigo-backend.service` | systemd alternative; `Type=simple`, `Restart=always`, `KillSignal=SIGTERM`, `TimeoutStopSec=10` so the app drains Prisma/Redis |

`minScale: 1` with an in-process scheduler means at least one scheduler always runs - which is what
you want - and `maxScale: 50` means up to fifty may. See the caveat in section B.

## D. Boot verification, already performed

Against a clone with the full release applied: HTTP server up, scheduler started, event consumers
processing, workflow instances starting, ledger reconciliation completing. The workflow fingerprint
gate passed - it blocks instance creation when definitions do not match, and instances started.

Two real defects surfaced during that boot, both now addressed or recorded:

- **audit rows silently discarded for system actors** - fixed, with a runtime test.
- **financial integrity score 84 with two HIGH drifts** - pre-existing, recorded, not repaired
  (repairing a ledger drift is a production write).

## E. To deploy, when authorized

1. Fill `REGION` and `PROJECT_ID` in `deploy/cloud-run/service.yaml`.
2. Build and push the image; pin the exact commit SHA rather than `:latest`.
3. Ensure the runtime's secrets resolve - `lib/secrets.ts` reads Google Secret Manager and the
   service account needs `roles/secretmanager.secretAccessor`.
4. Deploy. Confirm `/health` responds and the healthcheck passes.
5. Confirm in the logs that `scheduled_job_processor_started` and the event consumers appear. **A
   healthy HTTP endpoint does not prove the scheduler started** - it is the same process, but a
   partial boot is possible.
6. Settle the concurrent-scheduler question before raising the instance count.
