# Growth Intelligence Report — HOMIGO V5

**Scope:** Phase 2 — Growth War Room. Real-data only.

## Implemented (real data, wired in `GrowthHqDashboard`)

| Feature | Backend source | Status |
|---|---|---|
| CAC | `GET /api/admin/finance/analytics/unit-economics` → `cac` | ✅ (env-gated, see below) |
| LTV (avg) | unit-economics `avgLtv`; `GET /api/admin/membership/analytics` | ✅ live |
| LTV:CAC ratio | derived from above | ✅ live |
| Contribution margin, revenue efficiency | unit-economics | ✅ live |
| Membership upgrade funnel | `membership/analytics` → `upgradeFunnel` | ✅ live |
| Cohort retention (last 12) | `membership/analytics` → `cohorts`, `retentionRatePct` | ✅ live |
| Retention/churn time-series | `GET /api/admin/membership/analytics/trends` | ✅ wrapped (`adminApi.membershipTrends`) |
| Campaign performance (redemptions, discount, revenue, conversion impact) | `GET /api/admin/campaigns/analytics` | ✅ live |
| Referral program (qualified, commission, leaderboard, fraud rate) | `GET /api/admin/referrals/analytics` | ✅ live |

### CAC caveat (documented, not hidden)
`cac = (MARKETING_SPEND_MONTHLY × days/30) / newCustomers`. If the env var is unset it returns **0**; the UI then shows "set MARKETING_SPEND_MONTHLY" rather than a misleading number.

## Missing backend → proposed APIs

| Feature | Why missing | Proposed API | Integration path |
|---|---|---|---|
| **ROAS** | No ad-spend/channel-revenue feed | `GET /api/admin/growth/roas?period=` → per-channel `{ spend, attributedRevenue, roas }` | Ingest ad-platform spend (Google/Meta) via `AdSpend` model; attribute revenue via touchpoints (below) |
| **First/Last/Multi-touch Attribution** | No touchpoint capture (UTM/channel) | `POST /api/attribution/touch` (client) + `GET /api/admin/growth/attribution?model=first|last|multi` | Add `AttributionTouch` model (userId, channel, utm, ts); capture on landing/signup; run attribution models server-side |
| **Payback Period** | Needs CAC (real) + monthly margin per customer | `GET /api/admin/growth/payback` → `paybackMonths` | `paybackMonths = CAC / (ARPU × grossMargin)` once CAC & gross margin land |
| **Full funnel: Visitor→Signup→Booking→Repeat→Membership→Referral** | Visitor stage not tracked; rest partial | `GET /api/admin/growth/funnel?period=` | Add web/app analytics event for `visitor`; join `User` (signup), `Booking` (first/repeat), `Subscription`, `Referral` counts |
| **Campaign true ROI (cost-based)** | Campaign cost/spend not stored | Extend `campaigns/analytics` with `cost`, `roi` | Add `cost` field to `Campaign` (migration, additive); `roi = (revenue − cost)/cost` |

## Visual funnel
Membership upgrade funnel is rendered today (real). The full acquisition funnel is blocked on the visitor-stage event source above; UI scaffold shows the stages that have real data and marks visitor as pending.

## Runtime evidence
- `GrowthHqDashboard` is `dynamic()`-imported on `/hq/growth`; queries use `staleTime: 120s`, no polling.
- Type-check clean; build includes `/hq/[section]` (5.77 kB route chunk).
