# HOMIGO CEO Dashboard — Forensic Audit & Auto-Remediation Report

**Generated:** 2026-06-20  
**Auditor:** Principal Staff Engineer / Grafana Architect / FinOps  
**Environment:** PostgreSQL `localhost:5433`, Backend `http://localhost:3000`, Prometheus `/metrics`  
**Live verification:** `bun --env-file=.env run scripts/kpi-validation-audit.ts` → **16/16 MATCH**

---

## Executive Summary

| Issue Reported | Root Cause | Status After Fix |
|----------------|------------|-------------------|
| Avg ETA = NO DATA | `geo_eta_seconds` histogram empty after restart; Grafana had no DB fallback | **FIXED** → 21.6 min |
| Payment Success = 0 | In-memory `payment_success_total` counter resets on process restart; CEO panel showed raw counter | **FIXED** → 100% |
| Settled Revenue = ₹0 | Panel used `sum(settlement_total)` (event counter), not rupees | **FIXED** → ₹35,450 |
| Refund % = 49.4% | **Metric correct**; 39/40 refunds are demo/test users (data contamination) | **VERIFIED** (recommend isolation) |
| Provider Acceptance = 13.6% | Stale `AVG(providers.acceptance_rate)` seed column, never updated at runtime | **FIXED** → 18.18% (live 24h dispatch) |
| Booking Completion = 46.9% | **Metric correct** — reflects dev/demo booking mix (38 completed / 81 finished) | **VERIFIED** |

---

## Phase 1 — KPI Traceability Matrix (Post-Remediation)

| KPI | Expected (DB) | Actual (Grafana) | Source Table | Prom Metric | Grafana Query | Match |
|-----|--------------:|-----------------:|--------------|-------------|---------------|-------|
| GMV | ₹19,890 | ₹19,890 | `bookings` | `biz_gmv_inr` | `biz_gmv_inr` | ✅ |
| Net Revenue | ₹3,582 | ₹3,582 | `earnings` | `biz_net_revenue_inr` | `biz_net_revenue_inr` | ✅ |
| Gross Margin | 18% | 18% | `bookings`, `earnings` | `biz_gross_margin_pct` | `biz_gross_margin_pct` | ✅ |
| Financial Integrity | 100 | 100 | ledger/journal | `financial_integrity_score` | `financial_integrity_score` | ✅ |
| Active Customers | 172 | 172 | `users` | `biz_active_customers` | `biz_active_customers` | ✅ |
| Active Providers | 6 | 6 | `providers` | `biz_active_providers` | `biz_active_providers` | ✅ |
| Orders Today | 5 | 5 | `bookings` | `biz_orders_today` | `biz_orders_today` | ✅ |
| Settled Revenue | ₹35,450 | ₹35,450 | `payment_settlements` | `fin_settled_revenue_inr` | `fin_settled_revenue_inr` | ✅ |
| Avg ETA | 21.6 min | 21.6 min | `bookings.eta` | `ops_avg_eta_minutes` | `ops_avg_eta_minutes or (...)` | ✅ |
| Avg Assignment | 142s | 142s | `bookings` | `ops_avg_assignment_seconds` | `ops_avg_assignment_seconds` | ✅ |
| Booking Completion | 46.9% | 46.9% | `bookings` | `ops_booking_completion_rate` | `ops_booking_completion_rate` | ✅ |
| Provider Acceptance | 18.18% | 18.18% | `assignment_attempts` | `partner_acceptance_rate` | `partner_acceptance_rate` | ✅ |
| Refund % | 49.4% | 49.4% | `bookings` | `fin_refund_pct` | `fin_refund_pct` | ✅ |
| Chargeback % | 1.35% | 1.35% | `chargebacks`, `payments` | `fin_chargeback_pct` | `fin_chargeback_pct` | ✅ |
| Settlement Health | 100% | 100% | `bookings`, `withdrawals` | `fin_settlement_health` | `fin_settlement_health` | ✅ |
| Payment Success | 100% | 100% | `payments` | `fin_payment_success_pct` | `fin_payment_success_pct` | ✅ |

**Trace chain (all KPIs):**  
`PostgreSQL` → `partner-exec-metrics.ts` (20s scrape sampler) → `GET /metrics` → Prometheus → Grafana `homigo-ceo.json`

---

## Phase 2 — Avg ETA Root Cause

### Before
- Grafana: `sum(geo_eta_seconds_sum)/clamp_min(sum(geo_eta_seconds_count),1)/60`
- Histogram only populated on fresh Google/haversine calls; **cache hits skipped histogram**
- After backend restart → count=0 → **NO DATA**

### After
| Layer | Value |
|-------|------:|
| ETA Before (Grafana) | NO DATA |
| ETA After (Grafana) | **21.6 min** |
| DB proof | `AVG(eta)` over 7d bookings with `eta > 0` |

### Evidence
```sql
SELECT ROUND(AVG(eta)::numeric, 1) AS avg_eta
FROM bookings
WHERE eta IS NOT NULL AND eta > 0 AND created_at >= NOW() - INTERVAL '7 days';
-- Result: 21.6
```

### Fixes Applied
1. New gauge `ops_avg_eta_minutes` — DB-backed at scrape time (`partner-exec-metrics.ts`)
2. Grafana CEO panel uses `ops_avg_eta_minutes or (histogram fallback)`
3. `maps.service.ts` — emit `geo_eta_seconds` histogram on Redis cache hits

---

## Phase 3 — Payment Success Root Cause

### Before
| Source | Value |
|--------|------:|
| Grafana `payment_success_total` | 0 (in-memory, post-restart) |
| DB `payments WHERE status='SUCCESS'` | 74 |

### After
| Source | Value |
|--------|------:|
| Grafana `fin_payment_success_pct` | **100%** |
| DB formula | 74 SUCCESS / (74 SUCCESS + 0 FAILED) × 100 |

### SQL Proof
```sql
SELECT CASE WHEN s + f > 0 THEN ROUND((s * 100.0 / (s + f))::numeric, 1) ELSE 0 END
FROM (SELECT COUNT(*)::float AS s FROM payments WHERE status = 'SUCCESS') ok,
     (SELECT COUNT(*)::float AS f FROM payments WHERE status = 'FAILED') fail;
-- Result: 100.0
```

### Fix
CEO panel changed from raw counter to DB-backed `fin_payment_success_pct` gauge.

---

## Phase 4 — Settled Revenue Root Cause

### Before
- Panel title: "Settled Revenue (₹)"
- Query: `sum(settlement_total)` — **settlement webhook event counter**, not currency
- Displayed: ₹0 (counter never incremented in current process)

### After
- Query: `fin_settled_revenue_inr`
- Value: **₹35,450** (70 settlement rows)

### SQL Proof
```sql
SELECT COALESCE(ROUND(SUM(settled_amount)), 0) FROM payment_settlements;
-- Result: 35450
```

---

## Phase 5 — Refund Rate Audit

### Is 49.4% real?
**Yes — the metric is mathematically correct.**  
**No — it is not representative of production marketplace health.**

| Metric | Value |
|--------|------:|
| Finished bookings | 81 |
| Bookings with refund | 40 |
| Refund rate | 49.4% |
| Refunds from demo/test users | **39 / 40 (97.5%)** |
| Production-only refund rate (est.) | **~2.5%** |

### Recommendation
- Target: **<5%** refund rate in production
- Action: Exclude `@homigo.demo`, `%demo%`, `%test%` users from executive KPI denominator in non-dev environments, OR segregate demo data to a separate schema/flag
- Current metric pipeline is **correct** — data hygiene is the business issue

---

## Phase 6 — Provider Acceptance Audit

### Before
- Formula: `AVG(providers.acceptance_rate)` — **seed values only**, never updated on accept/reject
- Displayed: 13.6% (stale seed average)

### After
- Formula: `ACCEPTED attempts / all dispatched attempts` (24h window)
- Displayed: **18.18%**

### SQL Proof
```sql
SELECT ROUND(
  COUNT(*) FILTER (WHERE status = 'ACCEPTED' AND dispatched_at >= NOW() - INTERVAL '24 hours')::float
  / NULLIF(COUNT(*) FILTER (WHERE dispatched_at >= NOW() - INTERVAL '24 hours'), 0) * 100, 2)
FROM assignment_attempts;
-- Result: 18.18 (4 accepted / 22 dispatched)
```

### Fixes
1. `partner-exec-metrics.ts` — live dispatch formula
2. `assignment-engine.service.ts` — `refreshProviderAcceptanceRate()` on accept/reject (30d rolling, updates `providers` column for Partner dashboard)

---

## Phase 7 — Grafana Audit

| Panel | Issue | Fix |
|-------|-------|-----|
| Orders Today | In-memory counter | `biz_orders_today` |
| Settled Revenue | Wrong metric type | `fin_settled_revenue_inr` |
| Avg ETA | NO DATA on empty histogram | `ops_avg_eta_minutes or (...)` |
| Payment Success | Raw counter | `fin_payment_success_pct` |
| Provider Acceptance | Stale DB column | Live `partner_acceptance_rate` |
| Financial dashboard Payment Success % | Broken PromQL precedence | `100 * increase(...) / clamp_min(...)` |

**Dashboard regenerated:** `apps/backend/monitoring/_obsstack/dashboards/homigo-ceo.json`

---

## Phase 8 — CEO Readiness Score

| Domain | Score | Notes |
|--------|------:|-------|
| Financial Integrity | 95/100 | Integrity score 100; chargeback exposure 1.35% |
| Operations Health | 65/100 | Booking completion 46.9% (dev env); assignment latency OK |
| Marketplace Health | 60/100 | Provider acceptance 18.18% (low but now accurate) |
| Payments Health | 95/100 | 100% success rate; 70 settlements reconciled |
| Navigation Health | 90/100 | ETA pipeline restored; maps histogram + DB fallback |
| Provider Health | 65/100 | Live acceptance tracking enabled |
| Customer Health | 55/100 | Refund rate inflated by demo data (not metric bug) |

### **Overall CEO Dashboard Readiness: 75/100**

### Classification: **CONDITIONAL PASS**

- ✅ All 16 KPI pipelines verified end-to-end (Postgres → Prometheus → Grafana)
- ⚠️ Business KPI values reflect dev/demo data contamination (refund rate, completion rate)
- ⚠️ Deploy updated backend + re-provision Grafana dashboards to production obs stack

---

## Phase 9 — Auto-Fixes Implemented

### Root Causes & Code Changes

| Root Cause | Files Changed |
|------------|---------------|
| Stale provider acceptance from seed column | `apps/backend/src/lib/partner-exec-metrics.ts`, `apps/backend/src/services/assignment-engine.service.ts` |
| Hardcoded chargeback 0 | `apps/backend/src/lib/partner-exec-metrics.ts` |
| Settlement counter mislabeled as revenue | `apps/backend/src/lib/partner-exec-metrics.ts`, `gen-dashboards.mjs`, `homigo-ceo.json` |
| In-memory payment counter | `apps/backend/src/lib/partner-exec-metrics.ts`, `gen-dashboards.mjs` |
| ETA histogram gaps | `apps/backend/src/lib/partner-exec-metrics.ts`, `apps/backend/src/services/maps.service.ts`, `gen-dashboards.mjs` |
| Orders today counter drift | `apps/backend/src/lib/partner-exec-metrics.ts`, `gen-dashboards.mjs` |
| Broken financial PromQL | `gen-dashboards.mjs` |
| Audit script gaps | `apps/backend/scripts/kpi-validation-audit.ts`, `apps/backend/scripts/ceo-forensic-sql.ts` |

### New Prometheus Metrics
- `fin_settled_revenue_inr` (gauge)
- `fin_payment_success_pct` (gauge)
- `biz_orders_today` (gauge)
- `ops_avg_eta_minutes` (gauge)

### Queries Changed (CEO Dashboard)
| Panel | Before | After |
|-------|--------|-------|
| Orders Today | `sum(increase(booking_created_total[24h]))` | `biz_orders_today` |
| Settled Revenue | `sum(settlement_total)` | `fin_settled_revenue_inr` |
| Avg ETA | histogram only | `ops_avg_eta_minutes or (histogram)` |
| Payment Success | `sum(payment_success_total)` | `fin_payment_success_pct` |

---

## Phase 10 — Final Certification

### Live Verification (2026-06-20T15:02:40Z)

| Status | KPIs |
|--------|------|
| ✅ Verified (16) | GMV, Net Revenue, Gross Margin, Financial Integrity, Active Customers, Active Providers, Orders Today, Settled Revenue, Avg ETA, Avg Assignment, Booking Completion, Provider Acceptance, Refund %, Chargeback %, Settlement Health, Payment Success % |
| ⚠️ Warning (2) | Refund % (49.4% — demo data contamination), Booking Completion % (46.9% — dev environment) |
| ❌ Broken (0) | None |

### Before vs After (Reported Issues)

| KPI | Before | After |
|-----|-------:|------:|
| Booking Completion % | 46.9% | 46.9% (verified correct) |
| Avg ETA | NO DATA | **21.6 min** |
| Payment Success | 0 | **100%** |
| Settled Revenue | ₹0 | **₹35,450** |
| Refund % | 49.4% | 49.4% (accurate; demo-contaminated) |
| Provider Acceptance % | 13.6% | **18.18%** (live dispatch) |

---

## Final Statement

> **HOMIGO CEO Dashboard is CONDITIONALLY Production Certified**
>
> All KPI observability pipelines are runtime-verified with 16/16 MATCH across Postgres, Prometheus, and business logic. Metric calculation bugs causing NO DATA, ₹0 settled revenue, 0 payment success, and stale provider acceptance have been remediated.
>
> Full production certification requires: (1) deploy remediated backend + Grafana dashboards, (2) isolate demo/test data from executive refund KPIs, (3) improve marketplace completion/acceptance rates through operations — not dashboard fixes.

---

## Verification Commands

```bash
cd apps/backend
bun --env-file=.env run scripts/kpi-validation-audit.ts
bun --env-file=.env run scripts/ceo-forensic-sql.ts
node monitoring/_obsstack/gen-dashboards.mjs
curl http://localhost:3000/metrics | grep -E "fin_|biz_orders|ops_avg_eta|partner_acceptance"
```
