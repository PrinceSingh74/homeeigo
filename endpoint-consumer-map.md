# Endpoint Consumer Map

**Generated:** 2026-07-03T09:56:49.523Z  
**Total endpoints:** 292 (287 HTTP + 5 WS)

## Summary

| Classification | Count |
|----------------|------:|
| Referenced by frontend | 244 |
| System/Infrastructure | 7 |
| Unused (no frontend consumer detected) | 41 |

## Runtime Probes (public)

| Path | HTTP Status | OK |
|------|------------:|-----|
| /health | 200 | ✓ |
| /api/v1/status | 200 | ✓ |
| /api/services | 200 | ✓ |
| /api/stats/overview | 200 | ✓ |
| /api/subscriptions/plans | 200 | ✓ |
| /api/bookings/cancellation-policy | 200 | ✓ |

## Auth Gate Probes (expect 401)

| Path | Status | Pass |
|------|-------:|------|
| /api/admin/dashboard | 401 | ✓ |
| /api/users/me | 401 | ✓ |
| /api/bookings/upcoming | 401 | ✓ |
| /api/wallet/balance | 401 | ✓ |
| /api/providers/me | 401 | ✓ |

## All Endpoints

| Method | Route | Auth | Consumer Status | Consumers | Source |
|--------|-------|------|-----------------|-----------|--------|
| GET | /api/admin/dashboard | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/users | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/providers | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/heatmap | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/ops-map | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/app/(console)/alerts/page.tsx | apps/backend/src/routes/admin.ts |
| GET | /api/admin/bookings | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/bookings/:id | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/cancel | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/reschedule | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/reassign | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/dispatch | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/complete | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/repair | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/refund | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/bookings/:id/refund/retry | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/withdrawals/:id/approve | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/withdrawals/:id/reject | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/withdrawals/:id/process | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/settlements | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/chargebacks | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/dashboard | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/liabilities | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/liabilities/snapshot | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/audit-export/:kind | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/adjustments | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/adjustments/:id/execute | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/backfill/history | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/backfill/issues | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/hcoins/expiry/report | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reconciliation | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reconciliation/issues | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/reconciliation/run | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/reconciliation/gateway/run | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reconciliation/gateway | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reconciliation/gateway/issues | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/settlements | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/settlements/:id | varies | Referenced | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/settlements/:id/export | varies | Referenced | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/payouts | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/batch | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/batch/:id/submit | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/batch/:id/approve | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/batch/:id/reject | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/batch/:id/process | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/payouts/batch/:id | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/payouts/:id/retry | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/fraud-cases | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/migrations | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/migrations/verify | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks/:id | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/assign | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/respond | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/close | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/request-evidence | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/resolve | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks/:id/evidence-certificate | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks/:id/evidence-package | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/sla-check | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/:id/evidence | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/chargebacks/evidence/:evidenceId/download-token | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks/evidence/download/:token | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/chargebacks/:id/export | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/settlement-sync | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/run | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/discrepancies/:id/resolve | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/discrepancies/:id/assign | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/discrepancies/:id/investigate | JWT | Referenced | — | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/discrepancies/:id/escalate | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/settlement-sync/discrepancies/:id/notes | JWT | Referenced | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/settlement-sync/health | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reports | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/reports/export | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/integrity | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/integrity/run | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/integrity/validate | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/refunds | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/refunds/request | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/refunds/:id/approve | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/refunds/:id/reject | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/risk | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/risk/cases/:id/escalate | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/risk/holds/:userId/lift | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/analytics/unit-economics | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/gmv | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/intelligence | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/config | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/finance/config/history | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| PATCH | /api/admin/finance/config | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/finance/validation/run | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/cx/intelligence | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/growth/intelligence | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/risk/intelligence | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/platform/intelligence | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| PATCH | /api/admin/platform/flags | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/recovery/status | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/recovery/simulate | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/account-deletions | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/services | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| DELETE | /api/admin/services/:id | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/subscriptions/plans | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/subscriptions/subscribers | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/subscriptions/revenue | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/analytics/trends | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/analytics/export | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/insights | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/cashback/dashboard | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/cashback/liability | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/cashback/reports | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/queue/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/assignment/metrics | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/matching/analytics | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/campaigns | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/campaigns/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/coupons | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/coupons/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/membership/coupons/export | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/support/tickets | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/support/tickets/:id | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/support/analytics | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/referrals/analytics | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/overview | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/high-risk-users | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/review-queue | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/alerts | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/analytics/monthly | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/fraud/decisions | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/hcoins/analytics | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/hcoins/rules | JWT | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/transfers | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/giftcards | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/invoices | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/invoices/export.csv | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/revenue-report | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/health | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/alerts | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/observability/alerts/:source/:id/resolve | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/observability/alerts/evaluate | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/logs | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/logs/export.json | varies | Unused | — | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/logs/export.csv | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/observability/archival/strategy | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| POST | /api/admin/observability/validation/run | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/rbac/me | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/rbac/roles | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/admin/rbac/admins | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/admin.ts |
| GET | /api/ai/conversations | JWT | Unused | — | apps/backend/src/routes/ai.ts |
| GET | /api/ai/conversations/latest | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/ai.ts |
| GET | /api/ai/conversations/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/ai.ts |
| DELETE | /api/ai/conversations/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/ai.ts |
| POST | /api/auth/refresh | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:apps/web/src/services/auth/api-client.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/send-otp | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:apps/partner-web/src/services/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/verify-otp | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:apps/partner-web/src/services/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/google/authorize | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/google/callback | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/apple/authorize | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/apple/callback | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/forgot-password | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/reset-password | varies | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/verify-email | Public | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/send-verification-email | JWT | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| GET | /api/auth/sessions | JWT | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/auth.ts |
| DELETE | /api/auth/sessions | JWT | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/auth.ts |
| DELETE | /api/auth/sessions/others | JWT | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| DELETE | /api/auth/sessions/:id | JWT | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:homigo-mobile/src/services/auth/auth-api.ts | apps/backend/src/routes/auth.ts |
| POST | /api/auth/change-password | JWT | Referenced | client:apps/web/src/services/auth/auth-api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/auth.ts |
| GET | /api/bookings/upcoming | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/bookings.ts |
| GET | /api/bookings/cancellation-policy | Public | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/bookings.ts |
| GET | /api/bookings/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/bookings.ts |
| GET | /api/compliance/requests | JWT | Unused | — | apps/backend/src/routes/compliance.ts |
| GET | /api/compliance/admin/requests | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/compliance.ts |
| GET | /api/compliance/admin/retention/report | varies | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/compliance.ts |
| GET | /api/customer-intel/me | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/customer-intelligence.ts |
| GET | /api/customer-intel/match | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/customer-intelligence.ts |
| POST | /api/customer-intel/recommendation-click | JWT | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/customer-intelligence.ts |
| GET | /api/customer-intel/:userId | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/customer-intelligence.ts |
| GET | /api/digital-twin/cities | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/digital-twin.ts |
| GET | /api/digital-twin/:city | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/digital-twin.ts |
| GET | /api/digital-twin/:city/insights | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/digital-twin.ts |
| POST | /api/digital-twin/:city/simulate | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/digital-twin.ts |
| GET | /api/geo-intel/demand-forecast | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/surge | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/eta | Admin RBAC | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/zone-scoring | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/provider-density | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/revenue-forecast | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/fraud | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo-intel/exec-kpis | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo-intelligence.ts |
| GET | /api/geo/config | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/geo.ts |
| GET | /api/geo/reverse | JWT | Unused | — | apps/backend/src/routes/geo.ts |
| GET | /api/geo/autocomplete | JWT | Unused | — | apps/backend/src/routes/geo.ts |
| GET | /api/geo/place/:placeId | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/geo.ts |
| GET | /api/geo/eta | JWT | Unused | — | apps/backend/src/routes/geo.ts |
| GET | /api/geo/serviceable | JWT | Unused | — | apps/backend/src/routes/geo.ts |
| GET | /api/geo/geofences | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo.ts |
| GET | /api/geo/geofences/analytics | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo.ts |
| DELETE | /api/geo/geofences/:id | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo.ts |
| GET | /api/geo/geofence-events | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/geo.ts |
| GET | /api/giftcards/denominations | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/gift-cards.ts |
| GET | /api/giftcards/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/gift-cards.ts |
| GET | /api/hcoins/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/hcoins.ts |
| GET | /api/hcoins/history | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/hcoins.ts |
| GET | /api/legal/policies | varies | Unused | — | apps/backend/src/routes/legal.ts |
| GET | /api/mlops/registry | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/mlops.ts |
| GET | /api/mlops/data-quality | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/mlops.ts |
| GET | /api/mlops/health | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/mlops.ts |
| PUT | /api/notifications/:id/read | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/notifications.ts |
| DELETE | /api/notifications/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/notifications.ts |
| GET | /ready | varies | System | — | apps/backend/src/routes/observability.ts |
| GET | /metrics | varies | System | — | apps/backend/src/routes/observability.ts |
| POST | /api/partner/nav/telemetry | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/partner-nav.ts |
| GET | /api/partner/registration-status | Provider | Unused | — | apps/backend/src/routes/partner-register.ts |
| GET | /api/partner/documents | Provider | Unused | — | apps/backend/src/routes/partner-register.ts |
| DELETE | /api/partner/documents/:documentId | Provider | Referenced | partner:apps/partner-web/src/services/partner-registration-api.ts | apps/backend/src/routes/partner-register.ts |
| GET | /api/payments/history | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/payments.ts |
| GET | /api/payments/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/payments.ts |
| GET | /api/payments/:id/invoice | JWT | Referenced | — | apps/backend/src/routes/payments.ts |
| GET | /api/pricing/quote | JWT | Unused | — | apps/backend/src/routes/pricing.ts |
| GET | /api/pricing/surge-forecast | JWT | Unused | — | apps/backend/src/routes/pricing.ts |
| GET | /api/pricing/experiment | JWT | Unused | — | apps/backend/src/routes/pricing.ts |
| GET | /api/providers/me | Provider | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/route/optimize | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/bookings | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/dashboard | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/earnings | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/withdrawals | Provider | Unused | — | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/payouts | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/invoices | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/tax-summary | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/earnings/:id/invoice | Provider | Referenced | — | apps/backend/src/routes/providers.ts |
| GET | /api/providers/me/reviews | Provider | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/nearby | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/:id/reviews | varies | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/providers/:id/availability | varies | Referenced | — | apps/backend/src/routes/providers.ts |
| GET | /api/providers/:id | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/providers.ts |
| GET | /api/ratings/:bookingId | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/ratings.ts |
| GET | /api/referrals/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/referrals.ts |
| GET | /api/referrals/history | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/referrals.ts |
| GET | /api/referrals/leaderboard | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/referrals.ts |
| GET | /api/services/featured | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/services.ts |
| GET | /api/services/category/:category | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/services.ts |
| GET | /api/services/:id | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/services.ts |
| GET | /api/stats/overview | varies | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/stats.ts |
| GET | /api/subscriptions/plans | Public | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/me | Public | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/invoices | Public | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/entitlements | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/benefit-usage | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/cashback/history | JWT | Unused | — | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/insights | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/subscriptions/coupons | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/subscriptions.ts |
| POST | /api/subscriptions/cancel | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/subscriptions.ts |
| GET | /api/support/tickets | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/support.ts |
| GET | /api/support/tickets/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/support.ts |
| GET | /api/tracking/:bookingId | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/tracking.ts |
| GET | /uploads/ratings/:name | varies | Unused | — | apps/backend/src/routes/uploads.ts |
| GET | /api/users/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/users.ts |
| GET | /api/users/me/export | JWT | Unused | — | apps/backend/src/routes/users.ts |
| DELETE | /api/users/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/users.ts |
| GET | /api/users/addresses | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/users.ts |
| DELETE | /api/users/addresses/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/users.ts |
| POST | /api/users/addresses/:id/set-default | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/users.ts |
| GET | /api/users/bookings | JWT | Unused | — | apps/backend/src/routes/users.ts |
| GET | /api/users/bookings/:id | JWT | Referenced | — | apps/backend/src/routes/users.ts |
| GET | /api/users/ratings | JWT | Unused | — | apps/backend/src/routes/users.ts |
| GET | /api/users/me/devices | JWT | Unused | — | apps/backend/src/routes/users.ts |
| DELETE | /api/users/me/devices/:deviceId | JWT | Referenced | client:homigo-mobile/src/services/core/api.ts; mobile:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/users.ts |
| GET | /api/users/me | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/users.ts |
| GET | /api/wallet/balance | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/wallet.ts |
| GET | /api/wallet/transactions | JWT | Referenced | client:apps/partner-web/src/services/partner-api.ts; partner:apps/partner-web/src/services/partner-api.ts | apps/backend/src/routes/wallet.ts |
| GET | /api/wallet/offers | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/wallet.ts |
| GET | /api/wallet/transfers | JWT | Referenced | client:apps/web/src/services/core/api.ts; client:homigo-mobile/src/services/core/api.ts | apps/backend/src/routes/wallet.ts |
| GET | /api/wallet/payment-methods | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/wallet.ts |
| DELETE | /api/wallet/payment-methods/:id | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/wallet.ts |
| POST | /api/wallet/payment-methods/:id/set-default | JWT | Referenced | client:apps/web/src/services/core/api.ts; customer:apps/web/src/services/core/api.ts | apps/backend/src/routes/wallet.ts |
| GET | /api/weather/config | JWT | Unused | — | apps/backend/src/routes/weather.ts |
| GET | /api/weather/admin/overview | Admin RBAC | Referenced | client:apps/admin-panel/src/services/admin-api.ts; admin:apps/admin-panel/src/services/admin-api.ts | apps/backend/src/routes/weather.ts |
| GET | / | Public | System | — | apps/backend/src/index.ts |
| GET | /health | Public | System | — | apps/backend/src/index.ts |
| GET | /api/v1/status | Public | System | — | apps/backend/src/index.ts |
| GET | /api/v1/ws/stats | Admin RBAC | Unused | — | apps/backend/src/index.ts |
| GET | /ready | Ops | System | — | apps/backend/src/routes/observability.ts |
| GET | /metrics | Ops | System | — | apps/backend/src/routes/observability.ts |
| POST | /api/vitals | Public | Referenced | customer:apps/web/src/components/WebVitalsReporter.tsx; mobile:homigo-mobile/src/lib/observability/telemetry-queue-core.ts | apps/backend/src/routes/vitals.ts |
| POST | /api/ux-signals | Public | Referenced | mobile:homigo-mobile/src/lib/observability/startup-telemetry.ts; mobile:homigo-mobile/src/lib/observability/telemetry-queue-core.ts | apps/backend/src/routes/ux-signals.ts |
| WS | /ws/tracking/:bookingId | JWT+ACL | Unused | — | apps/backend/src/websocket/tracking.ws.ts |
| WS | /ws/notifications | JWT+ACL | Unused | — | apps/backend/src/websocket/notifications.ws.ts |
| WS | /ws/booking/:bookingId | JWT+ACL | Unused | — | apps/backend/src/websocket/booking.ws.ts |
| WS | /ws/earnings/:providerId | JWT+ACL | Unused | — | apps/backend/src/websocket/earnings.ws.ts |
| WS | /ws/admin-ops | JWT+ACL | Unused | — | apps/backend/src/websocket/admin-ops.ws.ts |

## Unused Endpoints (sample)

- `POST /api/admin/finance/liabilities/snapshot` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/finance/audit-export/:kind` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/finance/reconciliation/gateway` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/finance/fraud-cases` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/finance/reports/export` (apps/backend/src/routes/admin.ts)
- `POST /api/admin/finance/refunds/request` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/membership/analytics/export` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/membership/cashback/liability` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/membership/cashback/reports` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/membership/assignment/metrics` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/membership/matching/analytics` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/fraud/decisions` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/hcoins/rules` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/invoices/export.csv` (apps/backend/src/routes/admin.ts)
- `GET /api/admin/observability/logs/export.json` (apps/backend/src/routes/admin.ts)
- `GET /api/ai/conversations` (apps/backend/src/routes/ai.ts)
- `GET /api/compliance/requests` (apps/backend/src/routes/compliance.ts)
- `GET /api/geo/reverse` (apps/backend/src/routes/geo.ts)
- `GET /api/geo/autocomplete` (apps/backend/src/routes/geo.ts)
- `GET /api/geo/eta` (apps/backend/src/routes/geo.ts)
- `GET /api/geo/serviceable` (apps/backend/src/routes/geo.ts)
- `GET /api/legal/policies` (apps/backend/src/routes/legal.ts)
- `GET /api/partner/registration-status` (apps/backend/src/routes/partner-register.ts)
- `GET /api/partner/documents` (apps/backend/src/routes/partner-register.ts)
- `GET /api/pricing/quote` (apps/backend/src/routes/pricing.ts)
