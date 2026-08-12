# HOMIGO Enterprise OS v4 — Admin Panel Transformation

Frontend-only rearchitecture. All existing routes, APIs, and business logic are preserved.

## Information Architecture (9 HQs)

| HQ | Dashboard Route | Purpose |
|----|----------------|---------|
| 👑 Executive HQ | `/` | Board-ready KPIs, AI briefing, growth charts |
| 🚀 Operations HQ | `/hq/operations` | Mission control, live ops, geo intelligence |
| 🏪 Marketplace HQ | `/hq/marketplace` | Customers, partners, bookings, catalog |
| 📈 Growth HQ | `/hq/growth` | Campaigns, retention, analytics, loyalty |
| 💰 Finance HQ | `/hq/finance` | CFO dashboard, settlements, wallets |
| 🛡️ Risk & Compliance HQ | `/hq/risk` | Fraud, chargebacks, compliance, KYC |
| 🤖 AI HQ | `/hq/ai` | AI systems, forecasting |
| 📡 Monitoring HQ | `/hq/monitoring` | Observability, logs, alerts |
| ⚙️ Platform HQ | `/hq/platform` | Settings, migrations, support |

## Route Mapping (Old → New HQ)

All URLs unchanged. Navigation grouping only.

### Executive HQ
| Route | Label |
|-------|-------|
| `/` | Executive Dashboard |

### Operations HQ
| Route | Label |
|-------|-------|
| `/command-center` | Command Center |
| `/operations` | Live Ops |
| `/geospatial` | Geo Command |
| `/alerts` | Alert Center |
| `/heatmap` | Demand Heatmap |
| `/weather` | Weather Center |
| `/geofences` | Geofences |
| `/digital-twin` | Digital Twin |

### Marketplace HQ
| Route | Label |
|-------|-------|
| `/customers` | Customers |
| `/vendors` | Partners |
| `/bookings` | Bookings |
| `/services` | Services |
| `/membership` | Membership |
| `/membership/cashback` | Cashback |
| `/membership/queue` | Priority Queue |
| `/membership/coupons` | Coupons |
| `/payments` | Payments |

### Growth HQ
| Route | Label |
|-------|-------|
| `/analytics` | Analytics |
| `/membership/analytics` | Membership Analytics |
| `/campaigns` | Campaigns |
| `/referrals` | Referrals |
| `/loyalty` | Loyalty |
| `/gift-cards` | Gift Cards |
| `/transfers` | Transfers |

### Finance HQ
| Route | Label |
|-------|-------|
| `/finance/dashboard` | CFO Dashboard |
| `/finance/reconciliation` | Reconciliation |
| `/finance/settlement-sync` | Settlement Sync |
| `/finance/reports` | Reports |
| `/finance/payouts` | Payouts |
| `/finance/refunds` | Refunds |
| `/settlements` | Settlements |
| `/invoices` | Invoices |
| `/finance/liabilities` | Liabilities |
| `/finance/adjustments` | Adjustments |
| `/finance/backfill` | Ledger Backfill |
| `/finance/hcoin-expiry` | H-Coin Expiry |

### Risk & Compliance HQ
| Route | Label |
|-------|-------|
| `/fraud` | Fraud Center |
| `/finance/chargebacks` | Chargebacks |
| `/chargebacks` | Chargeback Queue |
| `/finance/risk` | Risk Engine |
| `/finance/integrity` | Integrity |
| `/finance/validation` | Validation |
| `/compliance` | Compliance |
| `/account-deletions` | Account Deletions |

### AI HQ
| Route | Label |
|-------|-------|
| `/ai` | AI Systems |

### Monitoring HQ
| Route | Label |
|-------|-------|
| `/observability` | Observability |
| `/observability/alerts` | Ops Alerts |
| `/observability/logs` | Log Search |

### Platform HQ
| Route | Label |
|-------|-------|
| `/settings` | Settings |
| `/finance/migrations` | Migrations |
| `/finance/reports` | Exports & Reports |
| `/support` | Support |

**Detail routes** (not in sidebar, reached from list pages):
- `/bookings/[id]`
- `/finance/chargebacks/[id]`

## API Mapping (HQ Dashboard → Existing Endpoints)

All endpoints already existed. New frontend wrappers added in `admin-api.ts`:
`customerIntel`, `mlops`, `rbac`, `membershipTrends`.

| HQ Dashboard | Real APIs Consumed |
|--------------|--------------------|
| Executive `/` | `/api/admin/dashboard`, `/api/admin/finance/dashboard`, `/api/geo-intel/zone-scoring` |
| Operations `/hq/operations` | `/api/geo-intel/exec-kpis`, `/api/admin/ops-map` |
| Marketplace `/hq/marketplace` | `/api/admin/dashboard`, `/api/admin/membership/insights`, `/api/geo-intel/zone-scoring`, `/api/admin/ops-map` |
| Growth `/hq/growth` | `/api/admin/finance/analytics/unit-economics`, `/api/admin/campaigns/analytics`, `/api/admin/referrals/analytics`, `/api/admin/membership/analytics` |
| Finance `/hq/finance` | `/api/admin/finance/dashboard`, `/api/admin/finance/analytics/unit-economics` |
| Risk `/hq/risk` | `/api/admin/fraud/overview`, `/api/admin/fraud/high-risk-users`, `/api/geo-intel/fraud`, `/api/compliance/admin/requests` |
| AI `/hq/ai` | `/api/geo-intel/revenue-forecast`, `/api/geo-intel/demand-forecast`, `/api/geo-intel/surge`, `/api/mlops/health` |
| Monitoring `/hq/monitoring` | `/api/admin/observability/health` |
| Platform `/hq/platform` | `/api/admin/rbac/me`, `/api/admin/rbac/roles`, `/api/admin/rbac/admins` |

No new backend endpoints were created. No synthetic/fake data is rendered.

## Intentionally NOT Built (no backend data — no fake data policy)

| Feature | Reason |
|---------|--------|
| ROAS, marketing attribution | No ad-spend/UTM endpoint |
| NPS | No survey/score API (only avg rating) |
| Burn rate, cash position | No treasury/GL endpoint |
| Partner churn | No provider-churn model (customer churn exists) |
| Unified trust score | No composite score field |
| Feature flags, rollouts | No flag service (only pricing A/B) |
| Disaster recovery, backup | Only on Prometheus `/metrics` (ops-auth) |

Each of these renders a `DataUnavailable` notice explaining the missing source instead of fabricating numbers.

## HQ Dashboard Components

```
src/components/hq/
├── primitives.tsx           (StatTile, SparkBars, MeterBar, DataUnavailable, ...)
├── ExecutiveKpiGrid.tsx
├── ExecutiveGeoPanel.tsx    (revenue heatmap by zone)
├── AiBriefingPanel.tsx
├── ViewModeSwitcher.tsx
└── dashboards/
    ├── OperationsHqDashboard.tsx   (+ wall-screen fullscreen mode)
    ├── MarketplaceHqDashboard.tsx
    ├── GrowthHqDashboard.tsx
    ├── FinanceHqDashboard.tsx
    ├── RiskHqDashboard.tsx
    ├── AiHqDashboard.tsx
    ├── MonitoringHqDashboard.tsx
    └── PlatformHqDashboard.tsx
```

All dashboards are `dynamic()`-imported (code-split) and use TanStack Query with conservative staleTime/poll intervals — no new polling/WS storms.

## Component Tree

```
AdminShell
├── HqSidebar (collapsible 9-HQ nav)
├── MobileHqNav (tablet/mobile)
├── AdminTopBar (HQ breadcrumb + search)
└── <main>
    ├── / → ExecutiveHqPage
    │   ├── ExecutiveKpiGrid
    │   ├── AiBriefingPanel
    │   ├── ViewModeSwitcher
    │   ├── AdminDashboardCharts
    │   └── DataTable (recent bookings)
    └── /hq/[section] → HqLandingPage
        ├── HqLandingShell
        ├── KpiCard grid (contextual)
        └── HqQuickLinkGrid
```

## Design System

- **Tokens**: `globals.css` — `--color-biz-*`, glass panels, enterprise spacing
- **GlassPanel**: frosted cards with optional glow
- **biz-hq-link-card**: hover-animated quick links
- **biz-page-enter**: GPU-friendly page transition
- **View modes**: Live / Board / Investor / Weekly (Executive HQ)

## Key Files

| File | Role |
|------|------|
| `src/lib/hq-navigation.ts` | Single source of truth for HQ structure |
| `src/components/layout/HqSidebar.tsx` | Collapsible HQ sidebar |
| `src/components/hq/*` | Shared HQ components |
| `src/app/(console)/page.tsx` | Executive HQ dashboard |
| `src/app/(console)/hq/[section]/page.tsx` | HQ landing pages |

## Performance

- Collapsible nav reduces DOM vs flat 52-item virtualized list
- Existing memoization, dynamic imports, DOM boundaries preserved
- Route prefetch capped at 24 routes on idle
- No new polling or WebSocket subscriptions

## Migration Notes

1. Sidebar nav config moved from `AdminSidebar.tsx` → `hq-navigation.ts`
2. `AdminSidebar` re-exports `HqSidebar` for backward compatibility
3. E2E tests match "business overview" in Executive HQ subtitle
4. All 52+ routes remain accessible at original URLs
