# Evidence — Grafana Dashboard Coverage Report

Generated: 2026-06-25T11:12:31.208Z
Dashboards scanned: 6 · Emitted metrics: 60 · Coverage: **100%** (9/9 domains)

| Domain | Status | Metric | Emitted | Dashboarded | Alerted |
|---|---|---|:--:|:--:|:--:|
| API latency | COVERED | `http_request_duration_seconds` | ✅ | ✅ | ✅ |
| API latency | COVERED | `http_requests_total` | ✅ | ✅ | ✅ |
| Database metrics | COVERED | `http_request_duration_seconds` | ✅ | ✅ | ✅ |
| Database metrics | COVERED | `process_resident_memory_bytes` | ✅ | ✅ | ✅ |
| Wallet metrics | COVERED | `wallet_transfer_total` | ✅ | ✅ | — |
| Wallet metrics | COVERED | `wallet_debit_total` | ✅ | ✅ | — |
| Wallet metrics | COVERED | `hcoin_earned_total` | ✅ | ✅ | — |
| Wallet metrics | COVERED | `hcoin_redeemed_total` | ✅ | ✅ | — |
| Payment metrics | COVERED | `payment_success_total` | ✅ | ✅ | — |
| Payment metrics | COVERED | `payment_failed_total` | ✅ | ✅ | ✅ |
| Payment metrics | COVERED | `refund_total` | ✅ | ✅ | — |
| Provider metrics | COVERED | `provider_payout_total` | ✅ | ✅ | — |
| Provider metrics | COVERED | `assignment_queue_backlog` | ✅ | ✅ | ✅ |
| Booking metrics | COVERED | `http_requests_total` | ✅ | ✅ | ✅ |
| Booking metrics | COVERED | `assignment_queue_backlog` | ✅ | ✅ | ✅ |
| WebSocket metrics | COVERED | `ws_connections_total` | ✅ | ✅ | ✅ |
| Finance metrics | COVERED | `settlement_total` | ✅ | ✅ | — |
| Finance metrics | COVERED | `payout_total` | ✅ | ✅ | — |
| Finance metrics | COVERED | `chargeback_total` | ✅ | ✅ | ✅ |
| Finance metrics | COVERED | `reconciliation_mismatch_total` | ✅ | ✅ | ✅ |
| Integrity metrics | COVERED | `finance_integrity_failures_total` | ✅ | ✅ | ✅ |
| Integrity metrics | COVERED | `settlement_mismatch_total` | ✅ | ✅ | ✅ |
| Integrity metrics | COVERED | `reconciliation_mismatch_total` | ✅ | ✅ | ✅ |

## Missing Metrics Report
- None — all required metrics are emitted.

## Dashboard Gaps (emitted but not visualised)
- None.
