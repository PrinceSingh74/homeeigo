# Investor Readiness Report — HOMIGO V5

**Scope:** Phase 9 — Investor Dashboard. Real-data only. UI: `InvestorDashboard` (Executive HQ → "Investor" view mode).

## Metrics wired with real data
| Metric | Backend source | Data quality |
|---|---|---|
| **GMV (30d)** | `GET /api/admin/finance/dashboard` (`payments.amountPaid`, SUCCESS) | Real DB |
| **Net Revenue** | finance dashboard (`GMV − refunds`) | Real DB |
| **MRR / ARR** | finance dashboard | Real DB (subscriptions) |
| **Customers / Partners** | `GET /api/admin/dashboard` | Real DB |
| **Avg LTV** | `GET /api/admin/finance/analytics/unit-economics` (`gmv/newCustomers`) | Real inputs, simplified formula |
| **LTV:CAC** | derived (LTV ÷ CAC) | Depends on CAC (below) |
| **Retention** | `GET /api/admin/membership/analytics` (`retentionRatePct`) | Real DB (subscription scope) |
| **Revenue trend** | `GET /api/admin/dashboard` (`charts.revenueByDay`) | Real DB |

## Known data-definition caveats (disclosed, not hidden)
- **GMV is defined differently across endpoints** (payments vs completed-bookings vs finalAmount). The investor view uses the **finance dashboard (payment-based, period-scoped)** definition consistently. Recommend standardizing on one canonical GMV definition before external reporting.
- **CAC** = `MARKETING_SPEND_MONTHLY (env) ÷ newCustomers`. If env unset → 0 → UI shows "CAC pending spend feed" (no fake ratio).
- **LTV** is a simplified `GMV/newCustomers`, not cohort-discounted lifetime value.

## Missing → proposed APIs (shown as `DataUnavailable`)
| Metric | Proposed API | Integration path |
|---|---|---|
| **Burn Rate** | `GET /api/admin/finance/burn` → `{ monthlyBurn }` | `LedgerExpense` model (additive migration) + monthly opex ingestion |
| **Cash Runway** | extend `/finance/burn` → `{ cashOnHand, runwayMonths }` | bank/manual `cashOnHand`; `runway = cash / burn` |
| **Cohort-based retention** | `GET /api/admin/growth/cohorts?basis=booking` | Cohort users by first-booking month; track repeat over N months (subscription retention already exists) |
| **Canonical GMV** | `GET /api/admin/finance/gmv?definition=payments` (single source) | Consolidate the 3 definitions into one service used everywhere |

## Investor packet readiness
| Section | Ready? |
|---|---|
| GMV, Revenue, MRR/ARR | ✅ real |
| Growth (customers/partners, revenue trend) | ✅ real (add explicit growth-rate series — see growth report) |
| Retention | ✅ (subscription) / cohort pending |
| LTV / CAC / LTV:CAC | ⚠️ real but formula-simplified; CAC needs spend feed |
| Runway / Burn | ❌ needs treasury feed (proposed API above) |

## Runtime evidence
`InvestorDashboard` renders under Executive HQ "Investor" mode; type-check clean; build passes. All figures trace to a documented endpoint; unavailable figures render an explicit notice with the proposed API.

## Verdict
**Investor dashboard is live with real GMV/revenue/MRR/ARR/LTV/retention.** Runway/burn and canonical-GMV consolidation are the two items blocking a fully external-grade investor packet; both have concrete, additive (non-breaking) API proposals.
