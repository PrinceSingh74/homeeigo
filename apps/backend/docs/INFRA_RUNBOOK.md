# HOMIGO Backend — Infrastructure & DR Runbook

Covers the observability + resilience surface added in the infra-hardening work.
Everything under **Verified** has been exercised against real services on the dev
box; everything under **Deploy template** is correct-by-construction config that
has **NOT** been run in a live cluster here — validate it in staging first.

---

## 1. Operational endpoints (Verified ✅)

| Endpoint | Purpose | Gates on | Notes |
|---|---|---|---|
| `GET /health` | Liveness | DB reachability | `{database, redis}` summary. Redis `disabled` when no `REDIS_URL`. |
| `GET /ready` | Readiness | **DB + (optional) RSS only** | Redis/integrations reported but do NOT gate — app serves via fallback. 503 when not ready. |
| `GET /metrics` | Prometheus exposition | — | `http_requests_total`, `http_request_duration_seconds`, `process_*`, `nodejs_heap_*`, `redis_up`, `redis_connected_clients`, `redis_hit_rate`. |

Readiness deliberately does not fail on a missing Resend/Twilio key or a Redis
outage: the service is still correct without them (console email in dev, in-memory
cache/limit fallback). Gating on them would eject a healthy pod.

Under Bun, `heapUsed` can exceed `heapTotal` (JavaScriptCore), so memory readiness
uses **RSS vs `MAX_RSS_MB`** and only gates when that env var is set.

---

## 2. Redis (Verified ✅ against real redis:7)

`src/lib/redis.ts` — node-redis, optional & fail-safe (no `REDIS_URL` ⇒ in-memory
fallback everywhere). Capabilities: `get/set/del`, atomic `consume` (rate limit),
`publish/subscribe` (WS fan-out), `getMetrics` (INFO), periodic health loop.

- `bun run smoke:redis` → 17/17 (set/get, TTL expiry, atomic limit allow→block,
  pub/sub round-trip, INFO metrics) — requires `REDIS_URL`.
- **Cross-instance WebSocket fan-out:** `bun run smoke:ws-fanout` → 7/7 (remote
  delivery, loop-guard on own echo, user fan-out, no double-delivery).

**Topology:** code is topology-agnostic. The supported production path is a single
**managed HA endpoint** (Upstash / ElastiCache / Redis Cloud) via `REDIS_URL`.
`REDIS_TOPOLOGY=cluster` is a reporting label only. Self-managed cluster manifests
are out of scope (managed Redis is the recommendation).

---

## 3. Sentry (Verified: wiring ✅ / delivery NOT VERIFIED ⚠️)

`src/lib/observability.ts` — `@sentry/bun`, no-op unless `SENTRY_DSN` set. Captures
only 5xx + DB-503 (not 4xx noise). Init/capture/flush proven not to throw in both
no-DSN and DSN-set modes. **Actual event delivery to a Sentry project is NOT
VERIFIED** (no real DSN provisioned). To verify: set `SENTRY_DSN`, trigger a 500,
confirm the issue appears.

---

## 4. Backups (Verified ✅) & Restore (procedure)

`scripts/backup-db.ts` — `pg_dump -Fc` (compressed, parallel-restore-capable) +
integrity check (`pg_restore --list`) + retention. Runs on Windows/Linux (Bun).

```bash
# Local (dump runs inside the Postgres container)
BACKUP_DOCKER_CONTAINER=homigo-postgres bun run backup:db
# Production (pg_dump on PATH, dumps DATABASE_URL target)
bun run backup:db
# With offsite copy (requires aws CLI + creds)
AWS_S3_BUCKET=s3://homigo-backups bun run backup:db
```
Verified: a 248 KB dump of `homigo_db` was produced and passed integrity check.
**S3 upload is NOT VERIFIED here** (no AWS creds) — gated behind `AWS_S3_BUCKET`.

**Restore procedure** (NOT executed here — would overwrite data):
```bash
# 1. Stop writers (scale API to 0).
# 2. Restore into a fresh DB:
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/homigo_<ts>.dump
# 3. Verify table counts, then scale API back up.
```

**RPO/RTO targets:** hourly snapshots ⇒ RPO ≈ 1h; restore of this DB size ⇒ RTO
minutes. RPO→0 requires a streaming replica (managed-Postgres feature, not app code).

---

## 5. Disaster-recovery scenarios

| Scenario | Mitigation | Owner action |
|---|---|---|
| App pod crash | k8s `livenessProbe` → `/health` restarts it | none (automatic) |
| Pod not serving | `readinessProbe` → `/ready` removes from LB | none (automatic) |
| Redis outage | App auto-falls back to in-memory; `redis_up` alert fires | investigate Redis; no data loss |
| DB outage | `/health` & `/ready` → 503; 5xx/DB-503 → Sentry | failover/restore managed Postgres |
| Data loss/corruption | Restore latest good dump (§4) | run restore procedure |

---

## 6. Deploy templates (NOT VERIFIED — validate in staging ⚠️)

### Kubernetes probes
```yaml
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 20
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /ready, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 2
```

### Prometheus scrape
```yaml
scrape_configs:
  - job_name: homigo-backend
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["homigo-backend:3000"]
```

### Alert rules (reference the real metric names emitted by /metrics)
```yaml
groups:
  - name: homigo
    rules:
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status=~"5.."}[5m]))
              / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels: { severity: critical }
      - alert: RedisDown
        expr: redis_up == 0
        for: 2m
        labels: { severity: warning }   # warning, not critical: app degrades gracefully
      - alert: HighMemory
        expr: process_resident_memory_bytes > 1.5e9
        for: 5m
        labels: { severity: warning }
```

### Backup CronJob
```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: homigo-db-backup }
spec:
  schedule: "0 * * * *"   # hourly → ~1h RPO
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: <homigo-backend-image>   # has bun + pg_dump
              command: ["bun", "run", "backup:db"]
              envFrom: [{ secretRef: { name: homigo-backend-secrets } }]
```

Alerting transport (Slack/PagerDuty via Alertmanager) and log aggregation
(the logger already emits JSON in prod — ship stdout to your platform) are
deployment-environment choices; no app code change required.
