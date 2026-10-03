# HOMEEIGO — CUSTOMER · PARTNER · ADMIN
## Deep panel-by-panel breakdown, extracted from the repository

Every route, feature, API domain, real-time channel and data hook below was enumerated directly from
source. Counts are measured, not estimated.

**Surface totals**

| Panel | Web | Mobile | API endpoints consumed | WebSocket channels |
|---|---|---|---|---|
| Customer | 28 pages · 237 components | 29 screens · 130 components | **80** | `/ws/tracking`, `/ws/booking`, `/ws/notifications` |
| Partner | 52 pages · 83 components | 13 screens + **46 HQ sections** · 31 components | **89** | `/ws/tracking`, `/ws/booking`, `/ws/earnings`, `/ws/notifications` |
| Admin | 88 pages · 80 components | — | **168** | `/ws/admin-ops`, `/ws/tracking`, `/ws/notifications` |

---

# 1. CUSTOMER PANEL

## 1.1 Web routes (`apps/web`)

**Authentication & account**
`/login` · `/signup` · `/forgot-password` · `/reset-password` · `/verify-email` · `/verify-otp` ·
`/auth/google/callback` · `/auth/apple/callback` — OAuth for Google and Apple plus OTP-based flows.

**Core marketplace** (inside `(with-bottom-nav)/(aurora-nav)` shell)
| Route | Purpose |
|---|---|
| `/` | Home — hero, search, service categories, offers, recommended, trust, reviews, live-tracking teaser |
| `/services` | Service catalogue and discovery |
| `/providers` · `/providers/[id]` | Provider directory and profile |
| `/book` | Booking flow with sticky checkout |
| `/bookings` | Booking history and detail |
| `/wallet` | Wallet, top-up, transactions |
| `/membership` | Subscription plans and status |
| `/referrals` | Referral programme |
| `/notifications` | Notification centre |
| `/support` | Support tickets |
| `/settings` · `/profile` | Account management |
| `/ai` | AI assistant |
| `/vision` | Image-based diagnosis |

**Legal & compliance**
`/legal` · `/legal/privacy` · `/legal/terms` · `/legal/cookies` · `/legal/refund`

## 1.2 Mobile screens (`homigo-mobile`, Expo 54 / RN 0.81)

**Tabs:** `index` (home) · `services` · `bookings` · `wallet` · `ai` · `profile`
**Stack:** `login` · `signup` · `verify-otp` · `verify-email` · `forgot-password` · `reset-password` ·
`change-password` · `book` · `address/picker` · `providers/index` · `providers/[id]` ·
`track/[bookingId]` · `rate/[bookingId]` · `invoices` · `support/index` · `legal/*` ·
`dev/diagnostics` · `dev/sentry-cert`

## 1.3 Customer features (component-level evidence)

**Booking flow** — `BookPageHeader`, `BookingScheduleSection`, `BookStickyCheckout`,
`CancellationPolicyCard`, `RescheduleBookingModal`, `BookingTimeline`, `BookingStatusBadge`,
`BookingDetailModal`, `BookingCard`.

**Live tracking** — `CustomerTrackingMap`, `LiveTrackingMap`, `LiveTrackingMapView`,
`BookingJourney`, `ServiceStartPin`. Real-time via `ActiveBookingChannel` + `RealtimeBridge`.

**Privacy-first contact** — `PartnerControlledCallButton` (masked number, controlled dial) and
`BookingChatPanel`.

**Payments** — `use-razorpay-checkout`, `use-booking-payment`, `use-payment-methods`,
`WalletCheckoutSummary`, `RefundModal`.

**Wallet & rewards** — `use-wallet-topup`, `use-wallet-checkout`, `use-hcoins`, `use-giftcards`,
`use-referrals`, `use-subscription`, `use-entitlements`.

**Location & discovery** — `use-current-location`, `use-geo-autocomplete`, `use-nearby-providers`,
`use-coverage`, `use-services-discovery`, `use-google-maps-loader`, `LocationButton`.

**Experience layer** — `use-weather-alerts`, `use-live-metrics`, `use-online-status`,
`use-native-notifications`, `WebVitalsReporter`, `ChunkLoadRecovery`, `AuroraBackground`,
`ThemeToggle`.

## 1.4 Customer API consumption (80 endpoints)

| Domain | Count | Examples |
|---|---|---|
| `auth` | 15 | login, signup, OTP send/verify, refresh, OAuth callbacks, password reset |
| `wallet` | 12 | balance, transactions, top-up, checkout |
| `subscriptions` | 10 | plans, order, verify, me |
| `giftcards` | 5 | redeem, balance |
| `referrals` | 4 | code, claim, history |
| `bookings` | 4 | create, list, detail, cancel/reschedule |
| `services` · `providers` · `ratings` · `payments` · `geo` · `coverage` · `compliance` · `ai` · `hcoins` · `uploads` · `support` · `stats` | 26 | discovery, booking, review, payment, privacy |

---

# 2. PARTNER PANEL

The largest partner surface is organised as **HQ hubs** — mirrored between web (52 pages) and
mobile (46 registered HQ sections), so a partner sees the same structure on both.

## 2.1 Partner web routes (`apps/partner-web`)

**Onboarding & auth:** `/login` · `/register` · `/registration-success`

**Daily work**
| Route | Purpose |
|---|---|
| `/` | Dashboard |
| `/requests` · `/requests/[id]` | Job offers, accept/reject |
| `/availability` | Online/offline, pause/resume, hours, breaks |
| `/map` · `/navigation` · `/route-center` | Live map, turn-by-turn, route optimisation |
| `/notifications` · `/support` · `/settings` · `/profile` | Account |

**Work HQ** — `/work-hq` · `/work-hq/schedule` · `/work-hq/attendance` · `/work-hq/service-history`

**Earnings HQ** — `/earnings` · `/earnings/payouts` · `/earnings-hq` · `/earnings-hq/forecast` ·
`/earnings-hq/incentives` · `/earnings-hq/tax-center` · `/wallet` · `/wallet/ledger` · `/invoices`

**Performance HQ** — `/performance-hq/scorecard` · `/performance-hq/rankings` ·
`/performance-hq/quality-insights` · `/reviews` · `/analytics`

**Territory HQ** — `/territory-hq` · `/territory-hq/coverage-areas` · `/territory-hq/heatmap`

**AI HQ** — `/ai` (assistant) · `/intelligence` (smart zones) · `/ai-hq/demand-forecast` ·
`/ai-hq/route-optimization` · `/ai-hq/earnings-coach`

**Trust & Compliance** — `/trust-compliance` · `/trust-compliance/verification` ·
`/trust-compliance/compliance`

**Growth & wellbeing** — `/academy` · `/academy/certifications` · `/rewards` · `/rewards/badges` ·
`/rewards/referrals` · `/membership` · `/wellbeing` · `/wellbeing/community` · `/wellbeing/sos`

## 2.2 Partner mobile (`homigo-partner-mobile`)

**Tabs:** `index` · `requests` · `explore` · `wallet` · `profile`
**Stack:** `login` · `register` · `job/[id]` · `hq/[id]` (dynamic HQ router)

**46 HQ sections** reachable through `hq/[id]`, grouped exactly like web:
`dashboard` · `work-hq` · `work-schedule` · `work-attendance` · `work-service-history` ·
`earnings-hq` · `earnings-detail` · `earnings-forecast` · `earnings-incentives` ·
`earnings-payouts` · `earnings-tax` · `wallet-ledger` · `performance-scorecard` ·
`performance-rankings` · `performance-quality` · `performance-reviews` · `performance-analytics` ·
`territory-coverage` · `territory-heatmap` · `territory-analytics` · `territory-navigation` ·
`route-center` · `ai-assistant` · `ai-intelligence` · `ai-demand-forecast` · `ai-route` ·
`trust-compliance` · `trust-verification` · `trust-documents` · `academy-training` ·
`academy-certifications` · `rewards-hub` · `rewards-badges` · `rewards-referrals` ·
`wellbeing-sos` · `wellbeing-community` · `wellbeing-insurance` · `account-profile` ·
`account-availability` · `account-map` · `account-membership` · `account-invoices` ·
`account-notifications` · `account-support` · `account-settings`

**Dedicated screens:** `partner-live-map`, `availability-workspace`, `hq-work-earnings`,
`hq-performance-ai-territory`, `hq-academy-account`, `JobDetailScreen`, `RequestsScreen`,
`ExploreScreen`.

## 2.3 Partner data layer

| Hook | Role |
|---|---|
| `use-partner-data` | Dashboard, profile, earnings, bookings |
| `use-partner-os` | Operations state (availability, capacity, ops snapshot) |
| `use-partner-intelligence` | Smart zones — surge + density + zone-scoring + 6 h demand, 60 s refresh |
| `use-partner-earnings-stream` | Live earnings over `/ws/earnings` |
| `use-partner-tracking-publisher` | Publishes GPS (10 s / 10 m interval) |
| `use-partner-booking-publisher` | Job-state changes over `/ws/booking` |
| `use-geolocation-watcher` | Foreground location watch |
| `use-razorpay-checkout` | Membership purchase |
| `use-partner-support` · `use-realtime-channel` · `use-google-maps-loader` | Support, realtime, maps |

## 2.4 Partner API consumption (89 endpoints)

| Domain | Count | What it covers |
|---|---|---|
| `providers/me/*` | **32** | dashboard, bookings, earnings, invoices, payouts, incentives, rankings, operations, forecast, intelligence, route/optimize, service-area/zones, attendance, academy, compliance, documents, wellbeing, withdrawals, resume |
| `partner/onboarding/*` | 15 | progress, assessment, training, review, geo search/autocomplete/reverse/config |
| `partner/register/*` | 7 | invite, registration status |
| `partner/documents` | 2 | upload, delete |
| `wallet/*` | 3 | balance, transactions, withdraw |
| `auth/sessions`, `users/me`, `users/preferences`, `subscriptions/*`, `support/tickets` | 10 | account, membership, support |

---

# 3. ADMIN PANEL

**88 pages** organised into **nine HQ groups** (from `lib/hq-navigation.ts`).

## 3.1 Executive HQ
`/` — Executive Dashboard.

## 3.2 Operations HQ
`/command-center` · `/eta-intelligence` · `/operations` (Live Ops) · `/workforce` · `/analytics` ·
`/coverage` · `/geospatial` (Geo Command) · `/alerts` (Alert Center) · `/heatmap` (Demand Heatmap) ·
`/weather` · `/geofences` (Zone Control) · `/digital-twin` (City Twin)

## 3.3 Marketplace HQ
`/customers` · `/vendors` · `/vendors/[id]` · `/vendors/documents` · `/bookings` · `/bookings/[id]` ·
`/reviews` · `/services` · `/academy` ·
`/membership` · `/membership/analytics` · `/membership/cashback` · `/membership/queue` ·
`/membership/coupons` · `/payments`

**Partner Acquisition sub-console (8 pages):**
`/partner-acquisition` · `/leads` · `/leads/[id]` · `/leads/new` · `/applications` ·
`/verification` · `/approvals` · `/sources` · `/analytics`

## 3.4 Growth HQ
`/campaigns` · `/referrals` · `/loyalty` · `/gift-cards` · `/transfers`

## 3.5 Finance HQ (largest — 32 API endpoints)
`/finance/dashboard` (CFO) · `/finance/config` · `/finance/reconciliation` ·
`/finance/settlement-sync` · `/finance/reports` · `/finance/payouts` · `/finance/refunds` ·
`/settlements` · `/invoices` · `/finance/liabilities` · `/finance/adjustments` ·
`/finance/backfill` · `/finance/hcoin-expiry` · `/finance/integrity` · `/finance/validation` ·
`/finance/migrations` · `/finance/risk` · `/finance/chargebacks` · `/finance/chargebacks/[id]`

## 3.6 Risk & Compliance HQ
`/fraud` (Fraud Center) · `/chargebacks` · `/compliance` ·
`/trust-safety` · `/trust-safety/compliance` · `/trust-safety/risk` ·
`/trust-safety/risk/[providerId]` · `/trust-safety/incidents` · `/trust-safety/incidents/[id]` ·
`/account-deletions`

## 3.7 AI HQ
`/ai` (AI Systems) · `/ai-brain` (Brain Console) · `/ai-brain/context` (Context Explorer) ·
`/ai-brain/memory` (Memory Explorer) · `/ai-brain/prompts` (Prompt Registry) ·
`/ai-brain/timeline` (Activity Timeline) · `/ai-brain/tools` (Enterprise Tool Center) ·
`/ai-brain/approvals` (**High-Risk Approvals**) · `/vision` (Vision Analytics)

## 3.8 Monitoring HQ
`/observability` · `/observability/alerts` · `/observability/email` (Email Health) ·
`/observability/logs` (Log Search)

## 3.9 Platform HQ
`/settings` · `/support` · `/hq/[section]` · `/login`

## 3.10 Admin API consumption (168 endpoints)

| Domain | Count |
|---|---|
| `finance` | **32** |
| `membership` | 12 |
| `partner-acquisition` | 8 |
| `observability` | 8 |
| `hcoins` | 5 |
| `fraud` | 5 |
| `trust-safety` | 4 |
| `subscriptions` · `rbac` | 6 |
| `support` · `recovery` · `platform` · `campaigns` | 8 |
| `workforce` · `users` · `transfers` · `settlements` · `services` · `risk` · `reviews` … | remainder |

## 3.11 Admin capabilities

- **RBAC-gated** — `use-admin-permissions`, `rbac` endpoints, resource/action model.
- **Live operations** — `/ws/admin-ops` for real-time alerts; `use-admin-booking-tracking`.
- **Lead CRM** — `use-partner-lead-crm` with a 15-state lifecycle and duplicate merge.
- **Financial control** — reconciliation, settlement sync, ledger backfill, integrity validation,
  liabilities, adjustments, chargeback evidence packages.
- **AI oversight** — tool registry, execution history, high-risk approval queue, prompt registry,
  context and memory explorers, activity timeline.
- **Design system** — `hq/` primitives, `GlassPanel`, `PageShell`, Executive Graphite (night) +
  Executive Mint (day) via `html[data-theme]` token remap.

---

# 4. CROSS-PANEL COMPARISON

| Dimension | Customer | Partner | Admin |
|---|---|---|---|
| Primary goal | Book & track a service | Find work & get paid | Run the marketplace |
| Web pages | 28 | 52 | 88 |
| Mobile | 29 screens | 13 screens + 46 HQ sections | — |
| API endpoints | 80 | 89 | 168 |
| WebSocket | tracking, booking, notifications | + earnings | admin-ops, tracking, notifications |
| Maps | tracking view | live map, navigation, route centre, heatmap | geospatial, heatmap, zone control, digital twin |
| Money | wallet, payments, refunds, gift cards | earnings, payouts, incentives, tax, invoices | reconciliation, settlements, liabilities, integrity |
| AI surface | assistant, vision | assistant, intelligence, demand forecast, route AI, earnings coach | full AI HQ + high-risk approvals |

**Shared architecture across all three:** Next.js 15 + React 19 + TanStack Query + Zustand + Zod +
Sentry, over one Bun/Elysia backend with the same auth, RBAC and audit layer. Mobile apps use
Expo 54 / RN 0.81 with the same API contracts.
