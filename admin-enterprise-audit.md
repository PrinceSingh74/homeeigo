# Admin Panel Enterprise Audit

**Generated:** 2026-07-03T09:56:49.523Z  
**Runtime base:** http://localhost:3000

## HQ Dashboard Verification

| HQ | Route | API Endpoints | Data Source | Status |
|----|-------|---------------|-------------|--------|
| Executive | / | adminApi.dashboard, financeDashboard, geoIntel.execKpis | Real API | CONNECTED |
| Operations | /hq/operations | geoIntel.execKpis, opsMap | Real API | CONNECTED |
| Marketplace | /hq/marketplace | membership insights, zone-scoring, ops-map | Real API | CONNECTED |
| Growth | /hq/growth | growthIntelligence, campaigns, referrals | Real API | CONNECTED |
| Finance | /hq/finance | financeDashboard, unitEconomics, financeConfig | Real API | CONNECTED |
| Risk | /hq/risk | riskIntelligence, fraud overview | Real API | CONNECTED |
| AI | /hq/ai | revenueForecast, demandForecast, mlops | Real API | CONNECTED |
| Monitoring | /hq/monitoring | recovery status, observability health | Real API | CONNECTED |
| Platform | /hq/platform | platformIntelligence, RBAC | Real API | CONNECTED |

## KPI/Chart/Widget Audit

- **All HQ dashboards** use `useQuery` → `adminApi` — no page-level mock arrays detected
- **placeholderData** used on paginated lists only (UX, not fake data)
- **Command Center** polls geo-intel endpoints every 30s — real data
- **Finance pages** (17 routes) — all wired to /api/admin/finance/*

## Runtime Evidence

- GET /api/admin/dashboard (unauthenticated) → 401 (expect 401)
- Financial integrity: 100/100
- Admin pages total: 57

## Gaps

- Grafana dashboards runtime: UP
- Email notifications: NOT configured
