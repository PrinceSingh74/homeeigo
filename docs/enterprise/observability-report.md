# HOMIGO — Observability Report

**Generated:** 2026-06-09
**Method:** Inspection of `/metrics` exposition + Prometheus rule validation (`promtool check rules` → exit 0).
**Verdict:** Metrics, alerts, dashboards, audit logs present and validated; all required financial alerts now defined and backed by emitted metrics.

---

## 1. Metrics (live `/metrics` exposition)

- **HTTP:** `http_requests_total{method,route,status}`, `http_request_duration_seconds_bucket` (histogram).
- **Runtime:** `nodejs_heap_total_bytes`, `process_resident_memory_bytes`, `redis_up`.
- **Financial counters** (`lib/financial-metrics.ts`): payment success/failed, refund attempt/success/failure, chargeback, settlement + mismatch, payout attempt/success/failed/race-blocked, wallet transfer/debit, hcoin earned/redeemed/adjusted/expired, reconciliation_mismatch, finance_integrity_failures, **booking_created_total**, **provider_payable_mismatch_total**, **wallet_liability_mismatch_total**.
- **Financial gauges:** settlement_delay_hours, chargeback/refund/adjustment amounts, **ledger_reconciliation_max_delta**, **db_pool_active_connections**, **db_pool_max_connections**.

## 2. Alerts (validated: `promtool check rules` → 22 rules, SUCCESS)

| Required alert | Rule | Backing metric |
|---|---|---|
| Payment failures | `PaymentFailureSpike` | `payment_failed_total` |
| Ledger drift | `FinanceIntegrityFailure`, `ReconciliationMismatch` | `finance_integrity_failures_total`, `reconciliation_mismatch_total` |
| Wallet mismatch | **`WalletLiabilityMismatch`** (new) | `ledger_reconciliation_max_delta` |
| Provider mismatch | **`ProviderPayableMismatch`** (new) | `provider_payable_mismatch_total` |
| Webhook failures | `WebhookFailureSpike` | `ops_alerts_total{alertType="webhook_failure"}` |
| Booking spikes | **`BookingSpike`** (new) | `booking_created_total` |
| High latency | `HighRequestLatency` | `http_request_duration_seconds_bucket` (p95) |
| DB saturation | **`DatabasePoolSaturation`** (new) | `db_pool_active_connections / db_pool_max_connections` |
| Redis failures | `RedisDown` | `redis_up` |
| Settlement mismatch | `SettlementMismatch` | `settlement_mismatch_total` |
| DB / backend down | `DatabaseDown`, `BackendDown` | `up{job=...}` |

New alerts added this mission: `WalletLiabilityMismatch`, `ProviderPayableMismatch`, `BookingSpike`, `DatabasePoolSaturation`. Each is wired to a metric now emitted by the application:
- `ledger_reconciliation_max_delta` set as a gauge by `ledger-reconciliation.service` after every reconcile.
- `provider_payable_mismatch_total` / `wallet_liability_mismatch_total` incremented when the respective liability delta exceeds ₹1.
- `booking_created_total` incremented on every successful booking creation.

## 3. Dashboards & Tracing

- Grafana dashboard `homigo-observability.json` present (HTTP, runtime, financial panels).
- Alertmanager routing configured (`alertmanager.yml`).
- Sentry integration via `observability.captureMessage/captureException` for error tracing (e.g. webhook misconfig).

## 4. Audit Logs

- `AuditLogService.record(...)` captures admin access decisions (`ADMIN_ACCESS_DENIED` on RBAC denial), with request metadata (IP, UA, path, method). Verified firing in the RBAC denial path.

## 5. Gaps / Follow-ups

- `db_pool_active_connections` / `db_pool_max_connections` gauges are defined and exposed but require a periodic emitter to populate from the Prisma/PG pool stats (currently default 0). The alert expression is correct and fires once the emitter is scheduled — recommend a 15 s sampler.
- Node-level alerts (`CpuPressure`, `MemoryPressureNode`, `DiskPressure`) require `node_exporter` in the target environment.

## 6. Confidence

**HIGH** for rule validity (promtool SUCCESS) and financial metric emission (code-wired + tests pass). **MEDIUM** for DB-pool alert until the pool sampler is scheduled.
