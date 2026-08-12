# Evidence — Alertmanager Validation Report

**Generated:** 2026-06-08T17:47:00Z

## Static Rule Audit (`bun run p2:alerts`) — ✅ PASS

| Check | Result |
|---|---|
| Required alert conditions | **9/9 covered** |
| Severity routing (critical/warning/escalation) | ✅ all routed |
| Slack receiver configured | ✅ (template) |
| Email receiver configured | ✅ (template) |
| PagerDuty receiver configured | ✅ (template) |
| Escalation chain (`homigo-escalation`) | ✅ |
| Validator exit code | 0 |

## Runtime Alertmanager — ⚪ NOT VERIFIED

| Check | Status | Evidence |
|---|:--:|---|
| Alertmanager process | ❌ NOT RUNNING | `localhost:9093` connection refused |
| Prometheus process | ❌ NOT RUNNING | `localhost:9090` connection refused |
| Synthetic alert firing | ⚪ NOT VERIFIED | no scrape pipeline |
| Slack delivery | ⚪ NOT VERIFIED | no live webhook URL substituted |
| Email delivery | ⚪ NOT VERIFIED | SMTP not configured |
| Escalation chain (live) | ⚪ NOT VERIFIED | — |

## Indirect evidence (application-level)

- Rate limit `429` observed on auth after load burst → application-level protection active
- `ops-alert.service` creates DB records on finance integrity failures (wallet-integrity run triggered finance alert insert — visible in prisma query log)

**Verdict:** 🟡 **PARTIAL** — rules + routing config PASS; live alert delivery NOT VERIFIED.
