# Monitoring Enterprise Report — HOMIGO V5

**Scope:** Phase 5 — Site Reliability Center. Real-data only.

## Implemented (real data, wired in `MonitoringHqDashboard`)

| Feature | Backend source | Status |
|---|---|---|
| Service health grid (DB, Redis, WebSocket, Queue, Payments, Finance) | `GET /api/admin/observability/health` → `serviceHealth.*` | ✅ live |
| DB latency, Redis hitRate/clients, WS conns/rooms, queue backlog | same | ✅ live |
| Sentry enabled | `health.sentry.enabled` | ✅ live |
| Logs (24h / total) | `health.logs` | ✅ live |
| Ops alerts open | `health.alerts.opsOpen` | ✅ live |
| Tracing buffer + spans by domain | `health.tracing` | ✅ live |
| Log search + CSV export | `GET /api/admin/observability/logs[/export.csv]` | ✅ available |

Confirmed real health fields also include `wallet: { pendingTopups, stalePendingTopups }` and `finance: { lastIntegrityStatus, openAlerts }`.

## Missing backend (REST) → proposed APIs

Backup and DR data **exist as operational artifacts** but are not exposed via an admin JWT REST API.

| Feature | Current state | Proposed API | Integration path |
|---|---|---|---|
| **Backup Health / Last Backup / Success %** | Prometheus gauges only: `backup_total`, `backup_size_bytes`, `backup_last_success_timestamp`, `backup_retention_deleted_total` (from `scripts/lib/backup-metrics.ts`) | `GET /api/admin/backup/status` → `{ lastSuccessAt, sizeBytes, successRate7d, failures7d }` | Read the same gauges the sampler already populates, or query the backup job log table; surface via admin route |
| **Restore Validation** | `scripts/verify-backup-restore.ts` produces a report (incl. `rtoSeconds`) | `GET /api/admin/backup/restore-validation` | Persist verify-restore report JSON to a table/object store; expose latest |
| **DR Readiness / RTO / RPO** | Docs + scripts only (`docs/enterprise/disaster-recovery-*.md`) | `GET /api/admin/dr/readiness` → `{ score, rtoSeconds, rpoSeconds, lastDrillAt }` | Compute from last drill artifacts + backup cadence (RPO = backup interval) |
| **Recovery Simulator (DB/Redis/Queue/API/Region failure)** | No simulation API (chaos scripts may exist externally) | `POST /api/admin/dr/simulate { target }` (guarded, non-prod) | Orchestrate against a staging environment; return projected impact + recovery steps. **Must be environment-gated** to avoid production disruption |

## Datadog/Grafana parity
`MonitoringHqDashboard` renders a status-dot service grid + live tracing sparkline — a Datadog-style SRC view. Backup/DR sections show `DataUnavailable` with exact gauge names and the proposed REST route (no fabricated backup percentages).

## Runtime evidence
Type-check clean; `MonitoringHqDashboard` code-split on `/hq/monitoring`; health query `refetchInterval: 60s`, `refetchIntervalInBackground: false` (no background polling storm).
