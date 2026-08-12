# Executive Intelligence Report — HOMIGO V5

**Scope:** Phase 1 — CEO Command Center. Real-data only. Runtime evidence: `tsc --noEmit` clean; `next build` → 56 routes compiled.

## Implemented (real data, wired in UI)

| KPI / Feature | Component | Backend source | Status |
|---|---|---|---|
| Today's / month / total revenue | `ExecutiveKpiGrid` | `GET /api/admin/dashboard` | ✅ live |
| GMV, Net Revenue | `ExecutiveKpiGrid` | `GET /api/admin/finance/dashboard` | ✅ live |
| Net / Platform Margin | `ExecutiveIntelligencePanel` | `GET /api/admin/finance/reports` → `platformMarginPct` | ✅ live |
| Contribution Margin | `ExecutiveIntelligencePanel` | `GET /api/admin/finance/analytics/unit-economics` | ✅ live |
| Revenue Forecast (hr/day/wk/mo) | `ExecutiveIntelligencePanel` | `GET /api/geo-intel/revenue-forecast` | ✅ live |
| Booking Success Rate | `ExecutiveIntelligencePanel` | `GET /api/geo-intel/exec-kpis` → `completionRate` | ✅ live |
| Cancellation Rate | `ExecutiveIntelligencePanel` | `exec-kpis.cancellationRate` | ✅ live |
| Support SLA Compliance | `ExecutiveIntelligencePanel` | `GET /api/admin/support/analytics` → `slaBreached` | ✅ live |
| Active Customers / Partners / online | `ExecutiveKpiGrid`, exec-kpis | `dashboard`, `exec-kpis` | ✅ live |
| Geographic revenue heatmap | `ExecutiveGeoPanel` | `GET /api/geo-intel/zone-scoring` → `revenue24h` | ✅ live |
| AI Briefings (Morning/Evening/Weekly/Monthly/Board/Investor) | `ExecutiveBriefs` | dashboard + finance dashboard + reports + unit-economics | ✅ live, deterministic (no LLM, no fabricated numbers) |

**Booking Success Rate** is served as `completionRate = completed / (completed + cancelled)` — a real definition. **Utilization** proxy uses zone demand/supply (`/api/geo/geofences/analytics`).

## Missing backend → proposed APIs (no fake data rendered; shown as `DataUnavailable`)

| Metric | Why missing | Proposed API | Integration path |
|---|---|---|---|
| **EBITDA** | No expense/GL feed; only revenue & commission exist | `GET /api/admin/finance/pnl?period=` → `{ revenue, cogs, opex, ebitda }` | Add `LedgerExpense` model (migration, additive) + monthly opex ingestion; compute EBITDA = net revenue − opex |
| **Burn Rate** | No expense ledger | `GET /api/admin/finance/burn` → `{ monthlyBurn, trailing3moAvg }` | Sum monthly `LedgerExpense` outflows; expose 3-month trailing average |
| **Cash Runway** | No cash-on-hand source | Extend `/api/admin/finance/burn` → `{ cashOnHand, runwayMonths }` | Manual/bank-feed `cashOnHand`; `runwayMonths = cashOnHand / monthlyBurn` |
| **Gross Margin** | No COGS split (only platform commission) | `GET /api/admin/finance/reports` add `grossMarginPct` | Define COGS (payment fees + partner payouts + support cost); `gross = (rev − COGS)/rev` |
| **Profit Forecast** | Revenue forecast exists; no cost model | `GET /api/geo-intel/profit-forecast` | Apply `platformMarginPct` to revenue forecast run-rate |
| **NPS** | No survey pipeline | `POST /api/surveys/nps` + `GET /api/admin/cx/nps?period=` | Add `NpsResponse` model; post-booking survey in customer app; score = %promoters − %detractors |
| **CSAT** | No survey pipeline | `POST /api/surveys/csat` + `GET /api/admin/cx/csat` | Add `CsatResponse` model; 1–5 post-service rating; CSAT = %(4–5) |
| **Complaint Trend** | Support has counts, not trend series | `GET /api/admin/support/analytics/trends?period=` | Group `SupportTicket` by day/category over window |
| **Customer/Partner/City growth-rate time-series** | Only 7-day booking/revenue charts + subscription trends | `GET /api/admin/growth/timeseries?entity=customer|partner|city&period=` | Group `User`/`Provider`/`Geofence` by `createdAt` bucket; compute period-over-period % |

## Runtime evidence
- Type-check: `npm run type-check` → exit 0.
- Build: `npm run build` → 56 routes, Executive HQ (`/`) First Load JS ~274 kB.
- All new panels are `dynamic()` code-split and render inside the existing `DashboardDOMBoundary` (deferred, no render storms).
