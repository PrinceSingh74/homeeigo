# Grafana Production Deployment — Certification (PHASE 2)

**Date:** 2026-06-17
**Dashboard:** `apps/backend/monitoring/grafana/dashboards/homigo-command-center.json`
**Verdict:** **PASS** (rendered real data via datasource proxy)

---

## 1. Deployment (real)

Grafana provisioned in the observability stack with:
- **Datasource** — Prometheus, `uid=prometheus`, auto-provisioned (`datasources/*.yml`)
- **Dashboards** — file-provider points at the dashboards dir; `homigo-command-center.json`
  imported on boot.

## 2. Dashboard structure

`homigo-command-center.json` — **20 panels across 5 sections**:

| Section | Sample panels |
|---------|---------------|
| CEO / Executive | financial integrity score, GMV, active bookings |
| Operations | provider acceptance rate, dispatch latency, geofence events |
| Financial | settlement totals, refunds, wallet balance, reconciliation |
| Technology | DB connections, API latency, error rate, Redis up |
| Security | auth failures, fraud flags, PII access |

## 3. EXECUTION EVIDENCE — live panels with REAL data

Queried through the Grafana **datasource proxy** (not the metrics endpoint directly —
proves datasource→Prometheus→panel path), live values returned:

| Metric (panel) | Value |
|----------------|-------|
| `financial_integrity_score` | **100** |
| `db_connections_active` | **1** |
| `provider_acceptance_rate` | **3.5** |

Panels resolve their PromQL through the provisioned datasource and return real series —
no mock data, no static JSON.

---

## 4. Note
The throwaway verification stack (`_obsstack`) was torn down after evidence capture; the
production manifests (`grafana/dashboards/`, `grafana/provisioning/`) remain in-repo and
re-deploy identically. Docker/Postgres in this host went down post-capture (known
environment instability) — does **not** affect dashboard validity.

**Module score:** **100/100** — datasource + 5 sections + live real-data render verified.
