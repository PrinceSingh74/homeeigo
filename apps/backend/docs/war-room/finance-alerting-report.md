# Finance Alerting Report

## Prometheus alerts added (`monitoring/rules/homigo-alerts.yml`)

| Alert | Condition | Severity |
|-------|-----------|----------|
| FinancialIntegrityBelow100 | `financial_integrity_score < 100` | critical |
| ReconciliationMatchRateLow | `payment_reconciliation_match_pct < 98` | critical |
| SettlementDelay48h | `settlement_delay_hours > 48` | warning |
| ProviderPayableDrift | `abs(provider_payable_drift_inr) > 0.01` | critical |
| WalletLiabilityDrift | `abs(wallet_liability_drift_inr) > 0.01` | critical |
| DuplicatePaymentDetected | `increase(duplicate_payment_total[1h]) > 0` | critical |
| SettlementMismatch | `increase(settlement_mismatch_total[24h]) > 0` | critical |

## Grafana

Dashboard: `monitoring/grafana/dashboards/homigo-observability.json`

## Sentry

Finance exceptions tagged via `recordFinancialMetric()` in reconciliation and settlement services.
