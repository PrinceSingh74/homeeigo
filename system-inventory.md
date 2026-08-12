# HOMIGO System Inventory

**Generated:** 2026-07-03T09:56:49.523Z  
**Method:** Static scan + runtime probes (`http://localhost:3000`)

## Summary Counts

| Layer | Count | Runtime Status |
|-------|------:|----------------|
| Backend HTTP endpoints | 287 | UP |
| WebSocket channels | 5 | UP |
| Frontend routes/pages | 133 | Static scan |
| Prisma models | 125 | healthy |
| Redis | 1 cluster | healthy |

## 1. Backend (`apps/backend`)

- **Runtime:** Bun + Elysia on port 3000
- **ORM:** Prisma 6.19 → PostgreSQL 16 (Docker `homigo-postgres:5433`)
- **Route modules:** 33 files under `src/routes/`
- **Services:** 80+ domain services under `src/services/`
- **Auth:** JWT + refresh families, OAuth (Google/Apple), OTP (Twilio), Admin RBAC
- **Runtime evidence:** GET /health → 200, database=ok, redis=ok

## 2. Admin Panel (`apps/admin-panel`)

- **Stack:** Next.js 15.1, React 19, TanStack Query, Zustand
- **Port:** 3003
- **Pages:** 57
- **API client:** `src/services/admin-api.ts`
- **HQ sections:** Executive (/), Operations, Marketplace, Growth, Finance, Risk, AI, Monitoring, Platform

## 3. Customer Web (`apps/web`)

- **Stack:** Next.js 15.5, React 19
- **Port:** 3001
- **Pages:** 26
- **API client:** `src/services/core/api.ts`

## 4. Partner Web (`apps/partner-web`)

- **Stack:** Next.js 15.1
- **Port:** 3002
- **Pages:** 23
- **API client:** `src/services/partner-api.ts`

## 5. Mobile App (`homigo-mobile`)

- **Stack:** Expo 54, React Native 0.81, expo-router
- **Screens:** 27
- **Note:** `apps/mobile` is stub only; real app is `homigo-mobile/`
- **Payments:** react-native-razorpay

## 6. Shared Packages

**None.** No `packages/` workspace. Cross-app code duplicated (auth-api, realtime hooks, razorpay checkout).

## 7. Database

- **Schema:** `apps/backend/prisma/schema.prisma`
- **Models:** 125
- **Enums:** 71
- **Migrations:** 43 folders
- **Financial integrity score:** 100/100 (runtime)

## 8. Redis

- **Client:** `apps/backend/src/lib/redis.ts`
- **Uses:** cache, rate-limit, idempotency, WS fan-out, distributed scheduler
- **Runtime:** healthy (topology: standalone)

## 9. WebSocket Layer

| Channel | Path | File |
|---------|------|------|
| Tracking | /ws/tracking/:bookingId | tracking.ws.ts |
| Notifications | /ws/notifications | notifications.ws.ts |
| Booking | /ws/booking/:bookingId | booking.ws.ts |
| Earnings | /ws/earnings/:providerId | earnings.ws.ts |
| Admin Ops | /ws/admin-ops | admin-ops.ws.ts |

Fan-out via Redis pub/sub (`ws:fanout`).

## 10. Payment Layer

- **Gateway:** Razorpay only
- **Service:** `razorpay.service.ts`, `payment.service.ts`
- **Webhook:** POST /api/payments/webhook
- **Runtime:** razorpay configured=true

## 11. Notification Layer

- **In-app:** `notification.service.ts` + WS push
- **Push:** `push-delivery.service.ts` (Expo SDK)
- **SMS:** Twilio (configured=true)
- **Email:** NOT configured

## 12. Analytics Layer

- **Prometheus:** /metrics (615 metric lines, scrape OK)
- **Grafana:** 18 dashboards in `monitoring/_obsstack/dashboards/` (runtime: UP)
- **BigQuery:** `analytics/bigquery/01_schema.sql`
- **Sentry:** All apps + backend
