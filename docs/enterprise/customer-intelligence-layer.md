# HOMIGO Customer Intelligence Layer (Phase-4 Track 3)

**Date:** 2026-06-20 · Runtime-verified on real data. Consumes existing services; rebuilds nothing.
`tsc` 0 errors.

> **Status: PASS (core).** Per-customer Health (RFM), CLV, Churn (30/60/90d), Recommendations,
> Rebook detection, and a transparent Smart-Match preview — all from real Postgres history, each
> with confidence + freshness. Required metrics + Grafana dashboard #15 live. BigQuery customer
> analytics views (CLV + churn features) created on the warehouse.

---

## API (`/api/customer-intel/*`)
| Endpoint | RBAC | Returns |
|----------|------|---------|
| `GET /me` | any authed (self) | combined profile: rfm, health, clv, churn, recommendations, rebook |
| `GET /:userId` | ADMIN | same profile for any customer |
| `GET /match?lat&lng&serviceId&limit` | any authed | ranked providers (matchScore + reasoning) |
| `POST /recommendation-click {kind}` | any authed | records `customer_recommendation_clicks_total` |

Service: `src/services/customer-intelligence.service.ts` — one booking-history load powers all scores.

## Coverage of the 9 sub-tracks
| Track | Built | Source |
|-------|:-----:|--------|
| A — Smart Matching | ✅ transparent score (distance/eta/rating/acceptance/completion/cancellation/workload) | Postgres providers |
| B — Smart ETA | ✅ (existing) | geo-intel `/eta` + weather |
| C — AI Assistant (Vertex) | 🟡 wired, blocked | Vertex Gemini model-access gate (project-level) |
| D — Recommendations | ✅ next category, frequent services, membership/subscription/upsell opps | booking history |
| E — Rebook | ✅ recurring detection + one-click candidate | booking history |
| F — Health Score | ✅ engagement/retention/risk/loyalty/value | RFM |
| G — CLV | ✅ lifetime + projected + retention probability | Postgres + BigQuery view |
| H — Churn | ✅ 30/60/90d probability + recommended action | recency vs cadence |
| I — Personalization | 🟡 scores ready; UI surfacing is a follow-up | consumes the above |

## Runtime evidence (real customers)
```
Active customer:  freq 96, recency 1.3d → CLV ₹8,739 · health[engage100 retain99 risk24 value87]
                  churn30 18% → "maintain"; rec next=cleaning, opps=[membership,subscription,upsell];
                  rebook eligible+recurring+due
Fresh customer:   freq 26, recency 0.2d → CLV ₹125,161, retProb 0.94, churn30 0%
Overdue customer: freq 14, recency 9.2d → CLV ₹2,878,  retProb 0.05, churn30 70%
Smart match:      #76 (0.2km, 4.3★, "very close, high acceptance") ranked over #48 (23.6km, 4.8★)
```
**Modeling fix found:** bursty test data (0.1-day interval) collapsed retention probability for active
customers → floored cadence at 1 day (a recurring home service is never sub-daily). retProb now tracks
engagement correctly (0.94 active vs 0.05 overdue).

## Observability (all metrics live + seeded at boot)
`customer_clv`, `customer_churn_probability`, `customer_health_score`, `customer_match_score`
(histograms) · `customer_ai_requests_total{endpoint}`, `customer_recommendation_clicks_total{kind}`
(counters). **Grafana #15 "Customer Intelligence"** (12 panels: avg CLV ₹25,608, avg churn, health,
match, AI usage by endpoint, recommendation CTR, trends) — verified serving.

## BigQuery pipeline (warehouse)
`vw_customer_clv` + `vw_customer_churn_features` (per `customer_hash`: bookings, completed,
lifetime_revenue, AOV, tenure, recency, avg_interval, **churned_30d label**). Verified: top customer
96 bookings/₹8,568; 14 customers, avg CLV ₹1,385.

## Honest gaps
1. **BQML CLV/churn models** — feature views are training-ready, but the dense test data has **0
   churned customers** (all recent) → a churn classifier would be degenerate. Train once real
   inactivity accrues (the `churned_30d` label + features are in place).
2. **Vertex AI customer assistant (Track C)** — SDK/auth verified; blocked on the project-level
   Generative-AI model-access gate (same as prior). Wire the existing `vertex-ai.service` narrative
   once enabled.
3. **Personalization UI (Track I)** — scores are exposed; surfacing them on the customer homepage/
   offers/notifications is a follow-up UI build.
