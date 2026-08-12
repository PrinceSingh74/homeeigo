# HOMIGO — Incident Response Report

**Date:** 2026-06-17 · severity + escalation encoded as alert labels (`monitoring/rules/homigo-enterprise-alerts.yml`), routed by `monitoring/alertmanager.yml`. promtool: **15 enterprise + 28 platform = 43 valid rules**.

## Severity ladder (alert `priority` label)
| Sev | Meaning | Example alerts | Team |
|---|---|---|---|
| **P0** | Payments / financial / DB down | `PaymentSuccessRateLow`, `FinancialIntegrityBelow100`, `WalletDriftSuspected` | L3 |
| **P1** | Dispatch / Redis / API errors | `DispatchFailureHigh`, `RedisDownP1`, `APIErrorRateHigh`, `DBConnectionsHigh`, `UnauthorizedAdminAccess` | L2/L3 |
| **P2** | External API / latency / abuse | `ProviderAcceptanceLow`, `APIP95LatencyHigh`, `GoogleMapsFailuresHigh`, `FailedLoginSpike`, `RateLimitViolationSpike`, `DBDuplicateBackendSuspected` | L2 |
| **P3** | Non-critical | `RedisHitRateLow` | L2 |

## Escalation matrix (alert `team` label → Alertmanager route)
| Level | Role | Trigger |
|---|---|---|
| **L1** | Support | first-line ack of P2/P3 |
| **L2** | Engineering | P1/P2 default owner |
| **L3** | Senior Engineering | P0 + financial/security |
| **L4** | CTO | P0 unacked / financial-integrity / wallet-drift |

## Incident flow
1. Prometheus rule fires → Alertmanager groups by `alertname,severity`.
2. Routed by `priority`: P0→escalation (0s, 15m repeat), P1→critical (10s), P2→warning, P3→info.
3. Backend webhook bridge records the alert in the **Admin Alert Center** (`/ws/admin-ops` live push — 48-frame delivery proven) for in-product visibility.
4. Runbooks attached via annotations (e.g. `FinancialIntegrityBelow100` → `scripts/recovery/validate-financial-integrity.ts`; `DBDuplicateBackendSuspected` → `scripts/recovery/detect-duplicate-process.ts`).

## Status
Severity ladder + escalation matrix + runbook links: **PASS** (rules promtool-valid, routes Alertmanager-valid). Ack-based time escalation (5m→L2…) depends on a PagerDuty/Opsgenie policy (see pager-escalation-report.md) — config present, account needed.
