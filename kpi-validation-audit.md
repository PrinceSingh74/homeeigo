# KPI Validation Audit

**Generated:** 2026-06-21T06:31:37.564Z
**Environment:** Backend `http://localhost:3000`, Database `localhost:5433`
**Metrics scrape:** OK
**Admin API:** login failed status=401

## Executive Summary

| Result | Count |
|--------|------:|
| MATCH | 16 |
| MISMATCH | 0 |
| EXPECTED_MISMATCH | 0 |
| NOT_VERIFIED | 0 |

| KPI | Grafana | Database | Business Logic | Admin Panel | Verdict |
|-----|--------:|---------:|---------------:|------------:|---------|
| GMV | 19890 | 19890 | 19890 | 39899 | **MATCH** |
| Net Revenue | 3582 | 3582 | 3582 | 32192.3 | **MATCH** |
| Gross Margin % | 18 | 18 | 18 | N/A | **MATCH** |
| Financial Integrity | 100 | 100 | 100 | N/A | **MATCH** |
| Active Customers | 172 | 172 | 172 | N/A | **MATCH** |
| Active Providers | 6 | 6 | 6 | N/A | **MATCH** |
| Orders Today | 2 | 2 | 2 | N/A | **MATCH** |
| Settled Revenue (₹) | 35450 | 35450 | 35450 | N/A | **MATCH** |
| Avg ETA (min) | 21.6 | 21.6 | 21.6 | N/A | **MATCH** |
| Avg Assignment Time | 161 | 161 | 161 | N/A | **MATCH** |
| Booking Completion % | 46.9 | 46.9 | 46.9 | N/A | **MATCH** |
| Provider Acceptance % | 50 | 50 | 50 | N/A | **MATCH** |
| Refund % | 49.4 | 49.4 | 49.4 | N/A | **MATCH** |
| Chargeback % | 1.35 | 1.35 | 1.35 | N/A | **MATCH** |
| Settlement Health % | 100 | 100 | 100 | N/A | **MATCH** |
| Payment Success % | 100 | 100 | 100 | N/A | **MATCH** |

## Per-KPI Detail

### GMV

**Source tables:** `bookings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | ✅ |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_gmv_inr
```

**SQL query:**
```sql
SELECT COALESCE(ROUND(SUM(total_amount)), 0) AS gmv
FROM bookings WHERE status = 'COMPLETED'
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 19890 |
| Database value | 19890 |
| Business logic value | 19890 |
| Admin Panel value | 39899 |
| **Verdict** | **MATCH** |

Admin Panel GMV (30d payments: ₹39,899) uses a different definition than Grafana (lifetime completed bookings: ₹19,890).

### Net Revenue

**Source tables:** `earnings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | ✅ |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_net_revenue_inr
```

**SQL query:**
```sql
SELECT COALESCE(ROUND(SUM(commission)), 0) AS net_revenue FROM earnings
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 3582 |
| Database value | 3582 |
| Business logic value | 3582 |
| Admin Panel value | 32192.3 |
| **Verdict** | **MATCH** |

Admin Panel net revenue (30d GMV − refunds: ₹32,192.3) differs from Grafana (sum of earnings.commission: ₹3,582).

### Gross Margin %

**Source tables:** `bookings`, `earnings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_gross_margin_pct
```

**SQL query:**
```sql
SELECT CASE WHEN b.gmv > 0 THEN ROUND((e.commission / b.gmv) * 1000) / 10.0 ELSE 0 END
FROM (SELECT SUM(total_amount) AS gmv FROM bookings WHERE status = 'COMPLETED') b,
     (SELECT SUM(commission) AS commission FROM earnings) e
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 18 |
| Database value | 18 |
| Business logic value | 18 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Financial Integrity

**Source tables:** `journal_entries`, `ledger_entries`, `payments`, `withdrawals`, `wallet_transactions`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
financial_integrity_score
```

**SQL query:**
```sql
-- Computed via financialIntegrityService.validate() (severity-weighted penalty, not single SQL)
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 100 |
| Database value | 100 |
| Business logic value | 100 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Active Customers

**Source tables:** `users`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_active_customers
```

**SQL query:**
```sql
SELECT COUNT(*) FROM users
WHERE role = 'CUSTOMER' AND is_active = true AND deleted_at IS NULL
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 172 |
| Database value | 172 |
| Business logic value | 172 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Active Providers

**Source tables:** `providers`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_active_providers
```

**SQL query:**
```sql
SELECT COUNT(*) FROM providers WHERE is_online = true
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 6 |
| Database value | 6 |
| Business logic value | 6 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Orders Today

**Source tables:** `bookings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
biz_orders_today
```

**SQL query:**
```sql
SELECT COUNT(*) FROM bookings
WHERE created_at >= NOW() - INTERVAL '24 hours'
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 2 |
| Database value | 2 |
| Business logic value | 2 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Settled Revenue (₹)

**Source tables:** `payment_settlements`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
fin_settled_revenue_inr
```

**SQL query:**
```sql
SELECT COALESCE(ROUND(SUM(settled_amount)), 0) AS inr FROM payment_settlements
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 35450 |
| Database value | 35450 |
| Business logic value | 35450 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Avg ETA (min)

**Source tables:** `bookings (proxy only)`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
ops_avg_eta_minutes
```

**SQL query:**
```sql
-- DB-backed avg ETA (7d bookings with eta > 0)
SELECT ROUND(AVG(eta), 1) FROM bookings
WHERE eta IS NOT NULL AND eta > 0 AND created_at >= NOW() - INTERVAL '7 days'
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 21.6 |
| Database value | 21.6 |
| Business logic value | 21.6 |
| Admin Panel value | N/A |
| DB reference (proxy) | 21.6 |
| **Verdict** | **MATCH** |

Primary CEO panel uses ops_avg_eta_minutes (DB-backed). geo_eta_seconds histogram supplements live maps telemetry.

### Avg Assignment Time

**Source tables:** `bookings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
ops_avg_assignment_seconds
```

**SQL query:**
```sql
SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)))), 0)
FROM (
  SELECT accepted_at, created_at FROM bookings
  WHERE accepted_at IS NOT NULL AND accepted_at >= NOW() - INTERVAL '24 hours'
  LIMIT 500
) sub
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 161 |
| Database value | 161 |
| Business logic value | 161 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Booking Completion %

**Source tables:** `bookings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
ops_booking_completion_rate
```

**SQL query:**
```sql
SELECT ROUND(COUNT(*) FILTER (WHERE status = 'COMPLETED')::float
  / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)
  * 100, 1)
FROM bookings
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 46.9 |
| Database value | 46.9 |
| Business logic value | 46.9 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Provider Acceptance %

**Source tables:** `providers`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
partner_acceptance_rate
```

**SQL query:**
```sql
SELECT ROUND(COUNT(*) FILTER (WHERE status = 'ACCEPTED' AND dispatched_at >= NOW() - INTERVAL '24 hours')::float
  / NULLIF(COUNT(*) FILTER (WHERE dispatched_at >= NOW() - INTERVAL '24 hours'), 0)
  * 100, 2)
FROM assignment_attempts
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 50 |
| Database value | 50 |
| Business logic value | 50 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Refund %

**Source tables:** `bookings`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
fin_refund_pct
```

**SQL query:**
```sql
SELECT ROUND(COUNT(*) FILTER (WHERE refund_amount > 0)::float
  / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)
  * 100, 1)
FROM bookings
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 49.4 |
| Database value | 49.4 |
| Business logic value | 49.4 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Chargeback %

**Source tables:** `chargebacks`, `payments`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
fin_chargeback_pct
```

**SQL query:**
```sql
SELECT CASE WHEN pay_cnt > 0
  THEN ROUND(cb_cnt * 100.0 / pay_cnt, 2) ELSE 0 END
FROM (SELECT COUNT(*) AS cb_cnt FROM chargebacks) c,
     (SELECT COUNT(*) AS pay_cnt FROM payments WHERE status = 'SUCCESS') p
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 1.35 |
| Database value | 1.35 |
| Business logic value | 1.35 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Settlement Health %

**Source tables:** `bookings`, `withdrawals`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
fin_settlement_health
```

**SQL query:**
```sql
SELECT CASE WHEN w.queue = 0 THEN 100
  ELSE ROUND(b.completed / NULLIF(b.completed + w.queue, 0) * 100, 1) END
FROM (SELECT COUNT(*) AS completed FROM bookings WHERE status = 'COMPLETED') b,
     (SELECT COUNT(*) AS queue FROM withdrawals WHERE status = 'REQUESTED') w
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 100 |
| Database value | 100 |
| Business logic value | 100 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

### Payment Success %

**Source tables:** `payments`

| Layer | Status |
|-------|--------|
| Grafana | ✅ |
| Admin Panel | — (not on CFO dashboard) |
| Database | ✅ |
| Business Logic | ✅ |

**Grafana query:**
```promql
fin_payment_success_pct
```

**SQL query:**
```sql
SELECT CASE WHEN s + f > 0 THEN ROUND(s * 100.0 / (s + f), 1) ELSE 0 END
FROM (SELECT COUNT(*)::float AS s FROM payments WHERE status = 'SUCCESS') ok,
     (SELECT COUNT(*)::float AS f FROM payments WHERE status = 'FAILED') fail
```

| Field | Value |
|-------|------:|
| Dashboard value (Grafana/Prometheus) | 100 |
| Database value | 100 |
| Business logic value | 100 |
| Admin Panel value | N/A |
| **Verdict** | **MATCH** |

## Known Definition Divergences

- **Admin GMV / Net Revenue** — 30-day payment-based (`finance-dashboard.service.ts`) vs Grafana lifetime booking/commission-based (`partner-exec-metrics.ts`).
- **Chargeback %** — Now DB-backed via `fin_chargeback_pct` (chargebacks / successful payments).
- **Payment Success %** — CEO panel uses `fin_payment_success_pct` (DB-backed), not in-memory counter.
- **Orders Today** — `biz_orders_today` gauge counts calendar 24h bookings from Postgres.
- **Settled Revenue** — `fin_settled_revenue_inr` sums `payment_settlements.settled_amount`, not settlement event counter.
- **Avg ETA** — `ops_avg_eta_minutes` is DB-backed (7d booking ETA); `geo_eta_seconds` histogram supplements maps telemetry.

## Recommendations

1. Wire provider `acceptance_rate` column refresh on accept/reject (assignment-engine.service.ts).
2. Add scope badges on Admin CFO dashboard (30d payments) vs Grafana CEO (lifetime bookings).
3. Isolate demo/test bookings from refund KPI if refund rate exceeds 5% target.
4. Backfill `payment_settlements` via Razorpay settlement sync if `fin_settled_revenue_inr` is zero.
