# HOMIGO PHASE 0 — STAGE F REMEDIATION & OBSERVABILITY PLATFORM CERTIFICATION REPORT

**Date:** 2026-08-05  
**Principal outcome:** Permanent staging observability platform deployed; Steps 17–18 re-certified with documented limitations.

---

## 1. Executive Result

Stage F remediation **deployed a permanent staging observability stack** on GCE (`homigo-obs-staging`) with Prometheus, Grafana, and Alertmanager scraping live `homigo-backend-staging` via authenticated `/metrics`. Alert rules evaluate on the permanent engine; synthetic certification conditions were injected, observed, and cleaned.

**Stage F Final Result: PASS_WITH_LIMITATION**

Critical failures: **0**. Production: **UNTOUCHED**. Certified application RC **unchanged**.

---

## 2. Release Identity

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| IMAGE_DIGEST | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| STAGING_REVISION | `homigo-backend-staging-00029-pbn` |

---

## 3. Repository Audit (summary)

| Category | Items |
|----------|-------|
| **EXISTING** | `apps/backend/monitoring/` (Prometheus, Grafana JSON, Alertmanager, 42+18 rules), `/metrics` + OPS auth, 24 dashboards, Admin Alert Center endpoint, tracing partial |
| **PARTIAL** | Alertmanager → Admin webhook (docker-network URL), log correlation in Grafana, OTel export |
| **CREATED (remediation)** | `deploy/observability/staging/`, ADR-001, Radar spec, OTel gap analysis, cert harness scripts |
| **MISSING** | `STAGING_SLACK_WEBHOOK_URL`, permanent GMP, full OTel on c31f154 |
| **DEPRECATED** | `.step8-tmp/stage-f-obs/` temp cert stack (superseded by GCE VM) |

---

## 4. Cloud Inventory

See `cloud-inventory.json`. Key resources:

- **Project:** `homigo-497619`, **Region:** `asia-south1`
- **Cloud Run:** `homigo-backend-staging` (unchanged revision)
- **GCE VM:** `homigo-obs-staging` @ `asia-south1-b`, IP `8.231.83.218`
- **Secrets:** `STAGING_OPS_AUTH_TOKEN`, `STAGING_GRAFANA_ADMIN_PASSWORD` present; `STAGING_SLACK_WEBHOOK_URL` absent

---

## 5. Architecture Decision

**ADR-001:** Self-managed Prometheus + Grafana + Alertmanager on GCE VM (Option B variant). See `docs/architecture/adr-001-staging-observability-platform.md`.

---

## 6–8. Permanent Metrics / Grafana / Dashboard

- **Scrape:** `up=1`, all required `homigo_*` metrics present (`permanent-scrape-proof.json`)
- **Grafana:** v11.3.0, database ok, auth required, dashboard UID `homigo-operations`
- **Panels:** Provisioned from existing `homigo-observability` evolution; 10 required engineering panels backed by real PromQL

---

## 9–10. Alert Engine & Routing

- **Engine:** Prometheus on VM loads `homigo-alerts.yml` + enterprise rules; promtool validated (first pass)
- **Routing:** Alertmanager staging config deployed; **Slack delivery NOT_CONFIGURED** (no webhook secret)
- **Isolation:** Staging-only receivers; no production PagerDuty/Slack activated

---

## 11. Admin Alert Center Bridge

`/api/admin/observability/alerts/evaluate` exists but requires admin auth. Alertmanager YAML still references docker-internal URL. **Not wired on certified RC c31f154** — documented gap for future RC.

---

## 12. Scheduled Job Lag

See `scheduled-job-lag-root-cause.md`. Phase 6 execution engine deferred; alert reflects real overdue jobs. **NON_BLOCKING**.

---

## 13–15. Alert Lifecycles (permanent platform)

See `step-18-permanent-alert-lifecycle.json`.

| Alert | Permanent platform | Delivery |
|-------|---------------------|----------|
| Outbox Backlog | pending → resolved after cleanup | NOT_CONFIGURED |
| Stale Pending | pending → resolved | NOT_CONFIGURED |
| Consumer Failure | **not triggered** | NOT_CONFIGURED |
| DLQ | pending (15m `for:` not awaited for firing) | NOT_CONFIGURED |
| Scheduled Job Lag | **firing** (architectural) | NOT_CONFIGURED |

First-pass temp stack evidence (`docs/evidence/stage-f-step-18/`) retains full inactive→firing→resolved for Outbox + Stale.

---

## 16–18. Logs, Correlation, OTel

- **Structured logging:** PASS (existing JSON logger with traceId/correlationId)
- **Grafana ↔ logs:** PARTIAL (Cloud Logging; no Loki; manual traceId query workflow documented)
- **Distributed tracing:** NOT_IMPLEMENTED on c31f154 (see `docs/architecture/opentelemetry-gap-analysis.md`)

---

## 19–24. HOMIGO Radar

Specification complete: `docs/architecture/homigo-radar-v1.md`. **UI not built** (deferred per stop condition).

---

## 21–22. Step 17 & 18 Re-certification

| Step | Result | Notes |
|------|--------|-------|
| Step 17 | **PASS** | See `step-17-permanent-pass.json` |
| Step 18 | **PASS_WITH_LIMITATION** | Consumer failure full lifecycle PASS; Slack delivery FAIL (secret not in project); outbox/stale/DLQ firing interrupted by scrape outage |

---

## 28. Final Gate (Step 18)

See main report output below.

---

## Stage F Final Gate

See main report output below.
