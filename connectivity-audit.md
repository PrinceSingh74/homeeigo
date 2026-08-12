# HOMIGO Connectivity Audit

**Generated:** 2026-06-12  
**Method:** Source-code trace + executed tests (no prior reports trusted)

## Architecture Overview

```
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│  apps/web   │  │ partner-web  │  │ admin-panel │
│  :3001      │  │  :3002       │  │  :3003      │
└──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │                │                  │
       └────────────────┼──────────────────┘
                        │ HTTP(S) + Bearer JWT
                        ▼
              ┌─────────────────────┐
              │  apps/backend       │
              │  Elysia :3000       │
              └─────────┬───────────┘
                        │
     ┌──────────────────┼──────────────────┐
     ▼                  ▼                  ▼
 PostgreSQL          Redis            Razorpay
 (Prisma)         (optional)         (payments)
     │                  │                  │
     └──────── WebSocket fan-out ─────────┘
              /ws/notifications
              /ws/booking
              /ws/tracking
              /ws/earnings
```

## Customer (`apps/web`) → Backend

| Domain | Client | API prefix | Status |
|--------|--------|------------|--------|
| Auth | `services/auth/api-client.ts` | `/api/auth/*` | **CONNECTED** |
| Catalog | `services/core/api.ts` | `/api/services/*` | **CONNECTED** |
| Bookings | `hooks/use-core-data.ts` | `/api/bookings/*` | **CONNECTED** (price-quote added) |
| Payments | `hooks/use-booking-payment.ts` | `/api/payments/*` | **CONNECTED** (amount server-derived) |
| Wallet | `services/core/api.ts` | `/api/wallet/*` | **CONNECTED** |
| Support | `hooks/use-support.ts` | `/api/support/*` | **CONNECTED** |
| Compliance | settings/export | `/api/compliance/*`, `/api/users/me/export` | **CONNECTED** |
| Referrals | `services/core/api.ts` | `/api/referrals/*` | **CONNECTED** |
| Gift cards | `services/core/api.ts` | `/api/giftcards/*` | **CONNECTED** |
| Membership | membership pages | `/api/subscriptions/*` | **CONNECTED** |
| AI | chat components | `/api/ai/*` | **CONNECTED** |
| WebSocket | (customer realtime bridge) | `/ws/notifications` | **CONNECTED** |

**Default API URL:** `NEXT_PUBLIC_API_URL` → `http://localhost:3000`

## Partner (`apps/partner-web`) → Backend

| Domain | Client | API prefix | Status |
|--------|--------|------------|--------|
| Auth (email + OTP) | `stores/partner-store.ts` | `/api/auth/*` | **CONNECTED** |
| Bookings lifecycle | `hooks/use-partner-data.ts` | `/api/bookings/*`, provider routes | **CONNECTED** |
| Earnings / wallet | `hooks/use-partner-data.ts` | `/api/wallet/*`, earnings WS | **CONNECTED** |
| Registration | `lib/registration-session.ts` | `/api/partner-register/*` | **CONNECTED** |
| WebSocket | `PartnerRealtimeBridge.tsx` | `/ws/notifications` | **CONNECTED** |

LAN dev: partner `api-client.ts` rewrites localhost API host to page hostname.

## Admin (`apps/admin-panel`) → Backend

| Domain | Client | API prefix | Status |
|--------|--------|------------|--------|
| Auth | `providers/AdminAuthProvider.tsx` | `/api/auth/login` | **CONNECTED** |
| Dashboard / ops | `services/admin-api.ts` | `/api/admin/*` | **CONNECTED** |
| Finance | finance pages | `/api/admin/finance/*` | **CONNECTED** |
| Membership / coupons | membership pages | `/api/admin/membership/*` | **CONNECTED** |
| Observability | observability pages | `/api/admin/observability/*` | **CONNECTED** |
| Log search | **NEW** `observability/logs/page.tsx` | `/api/admin/observability/logs` | **CONNECTED** (was missing UI) |
| Compliance | **NEW** `compliance/page.tsx` | `/api/compliance/admin/*` | **CONNECTED** (was missing UI) |
| Account deletions | `account-deletions/page.tsx` | `/api/admin/account-deletions` | **CONNECTED** (audit read-only) |
| RBAC | `AdminAuthGuard` | `/api/admin/rbac/me` | **CONNECTED** |

## Backend → PostgreSQL (Prisma)

- Entry: `apps/backend/src/lib/prisma.ts`
- Schema: `apps/backend/prisma/schema.prisma` (100+ models)
- Health: `GET /health` → `database: ok|down`
- Migrations: `prisma/migrations/*`
- **Status: CONNECTED** (verified via `bun test` DB integration suites)

## Backend → Redis

- Client: `apps/backend/src/lib/redis.ts`
- Uses: rate limiting, cache (`cache.service.ts`), assignment engine, WS fan-out (`roomManager.initRedisFanout`)
- Health: `GET /health` → `redis: ok|degraded|disabled`
- **Status: CONNECTED** (optional; degrades to in-memory when `REDIS_URL` unset)

## Backend → Razorpay

- Service: `apps/backend/src/services/razorpay.service.ts`
- Flow: `payment.service.createOrder` → `razorpayService.createOrder(booking.finalAmount)`
- Webhook: `POST /api/payments/webhook` (signature verified)
- **Status: CONNECTED** (dev mode uses mock order IDs when keys unset)

## Backend → WebSocket

| Channel | File | Auth |
|---------|------|------|
| Notifications | `websocket/notifications.ws.ts` | JWT query param |
| Booking | `websocket/booking.ws.ts` | Role-scoped |
| Tracking | `websocket/tracking.ws.ts` | Booking access |
| Earnings | `websocket/earnings.ws.ts` | Provider |

- Hub: `apps/backend/src/lib/websocket.ts` (`roomManager`)
- **Status: CONNECTED**

## Backend → Ledger

- Service: `financial-ledger.service.ts`, `financial-transaction-manager.ts`
- Triggered on: payment success, refund, payout, wallet debit/credit
- Reconciliation: `scripts/reconcile-ledger.ts`, admin finance integrity routes
- **Status: CONNECTED** (17/17 finance-finalization unit tests pass)

## Backend → Refunds

- Customer cancel: `booking.service.cancel` → `booking-refund.service.ts`
- Admin refund: `POST /api/payments/:id/refund` (RBAC `PAYMENTS.APPROVE`)
- Orchestrator: `refund-orchestrator.service.ts`, Razorpay + wallet paths
- **Status: CONNECTED** (14/14 refund unit tests pass)

## Backend → Membership

- Entitlements: `entitlement.service.ts` (discount, free delivery, premium gate)
- Subscriptions: `routes/subscriptions.ts`
- Coupons: `membership-coupon.service.ts`
- **Status: CONNECTED**

## Backend → Coupons / Campaigns

- Membership coupons: `membership-coupon.service.ts`
- Campaigns: `campaign.service.ts`
- Booking apply: `booking-pricing.service.ts` (single pricing authority)
- Admin CRUD: `/api/admin/membership/coupons`, `/api/admin/campaigns`
- Customer UI: book flow coupon field → `POST /api/bookings/price-quote` + create
- **Status: CONNECTED** (was disconnected on customer UI; fixed)

## Backend → Compliance

- Customer: `routes/compliance.ts` — export, delete, consent withdraw
- Admin: `/api/compliance/admin/requests` approve/reject
- Retention: `data-retention.service.ts`
- **Status: CONNECTED** (admin UI built)

## Backend → Referrals

- `routes/referrals.ts`, `referral.service.ts`
- Fraud signals: `fraud-signal.service.ts`
- **Status: CONNECTED**

## Backend → Gift Cards

- `routes/gift-cards.ts`, `gift-card.service.ts`
- Protection: `gift-card-protection.service.ts`
- **Status: CONNECTED**

## P0 Gap Summary (pre-fix)

| Issue | Gap | Fix applied |
|-------|-----|-------------|
| Price mismatch | UI packages/addons not in server pricing | `booking-pricing.service.ts` + `/price-quote` + web integration |
| Coupon disconnect | No customer coupon UI | Coupon field + quote API |
| Refund 403 | `RefundModal` called admin-only `/api/payments/:id/refund` | Routed to support tickets |
| Compliance UI | No admin approve/reject center | `/compliance` page |
| Admin log search | Sidebar link, no page | `/observability/logs` page |

## Test Evidence

```
bun test booking-pricing.test.ts membership-coupon.test.ts refund.test.ts finance-finalization.test.ts p4-compliance.test.ts
→ 44 pass, 0 fail
```
