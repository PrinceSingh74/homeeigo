# HOMIGO Platform Architecture

Three **independent frontends** share one **backend** (Bun + Elysia + PostgreSQL + Redis).

## Systems & URLs

| System | App folder | Production URL | Port (dev) |
|--------|------------|----------------|------------|
| Customer | `apps/web` → alias `customer-web` | homigo.com | 3001 |
| Partner / Vendor | `apps/partner-web` | partner.homigo.com | 3002 |
| **Business HQ (Admin)** | `apps/admin-panel` | admin.homigo.com | 3003 — poora company: vendors, GMV, fraud, payouts |
| API | `apps/backend` | api.homigo.com | 3000 |

Mobile: `apps/mobile` (customer), `homigo-mobile` / future `mobile-partner`.

## Separation rules

- **No shared page routes** between customer and partner apps.
- **No shared UI theme** — customer = light Aurora luxury; partner = dark ops (`#071028`).
- Shared code lives only in optional `packages/*` (types, API client) — never customer components in partner.

## Backend (shared)

```
apps/backend/src/
├── index.ts
├── plugins/          # cors, jwt, redis, ws
├── modules/
│   ├── auth/         # customer + partner + admin roles
│   ├── vendors/
│   ├── bookings/
│   ├── payments/     # Razorpay
│   ├── tracking/     # WebSockets + Redis geo
│   ├── wallets/
│   ├── ai/
│   └── admin/
└── ws/               # live tracking, request push
```

## Data model (high level)

- `User` — customers
- `Vendor` — partners (KYC, categories, availability)
- `Booking` — status machine (requested → assigned → en_route → in_progress → completed)
- `Payment`, `WalletLedger`, `Payout`
- `Review`, `VendorMetrics`
- `AdminUser`, `AuditLog`

## Partner app routes

| Route | Feature |
|-------|---------|
| `/login` | Phone OTP, KYC onboarding |
| `/` | Dashboard (earnings, jobs, AI insights) |
| `/requests` | Live booking requests (accept/reject) |
| `/map` | Live navigation & tracking |
| `/wallet` | Earnings, withdraw |
| `/ai` | Vendor AI assistant |
| `/analytics` | Performance charts |
| `/reviews` | Customer reviews |
| `/availability` | Online/offline |
| `/profile` | KYC, docs, categories |

## Deployment

Each app builds independently (`next build`). Reverse proxy routes by host:

- `homigo.com` → customer
- `partner.homigo.com` → partner-web
- `admin.homigo.com` → admin-panel
- `api.homigo.com` → backend

## Environment

```env
# partner-web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_APP_ROLE=partner
```
