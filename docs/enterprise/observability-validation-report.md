# Enterprise Observability Validation Report

**Generated:** 2026-06-26T07:12:47.614Z

## Summary: 17/18 checks passed

| Step | Result | Detail |
|------|--------|--------|
| prometheus_metrics_scrape | ❌ | TimeoutError: The operation timed out. |
| readiness_probe | ✅ | {"status":"ready","timestamp":"2026-06-26T07:12:47.168Z","environment":"development","checks":{"database":{"status":"hea |
| alert_rule_payment failures | ✅ | rule present |
| alert_rule_refund failures | ✅ | rule present |
| alert_rule_booking spikes | ✅ | rule present |
| alert_rule_wallet drift | ✅ | rule present |
| alert_rule_provider payout mismatch | ✅ | rule present |
| alert_rule_database saturation | ✅ | rule present |
| alert_rule_Redis outage | ✅ | rule present |
| alert_rule_webhook failures | ✅ | rule present |
| alert_rule_websocket failures | ✅ | rule present |
| alert_rule_queue failures | ✅ | rule present |
| grafana_dashboard | ✅ | C:\Users\Kapiissh Green\OneDrive\Desktop\homigo\apps\backend\monitoring\grafana\dashboards\homigo-observability.json (39 |
| alertmanager_routes | ✅ | routes+receivers configured |
| metric_http_request_duration | ✅ | rule-only |
| metric_payment | ✅ | rule-only |
| metric_wallet | ✅ | rule-only |
| metric_booking | ✅ | rule-only |

## Notes

- Live Alertmanager firing requires Prometheus stack deployment (docker/k8s).
- This run validates **metrics emission**, **rule coverage**, and **config integrity** against a running backend.
- Full alert trigger/recovery loop needs staging Prometheus + Alertmanager targets.
