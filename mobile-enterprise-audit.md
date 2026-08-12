# Mobile Enterprise Audit

**Generated:** 2026-07-03T10:36:40.616Z

## Catalog Data Flow (post-fix)

| Layer | Implementation | Status |
|-------|----------------|--------|
| API | useServicesQuery / useFeaturedServicesQuery | CONNECTED |
| Cache | AsyncStorage via catalog-cache.ts | **IMPLEMENTED** |
| Offline | lib/offline/queue.ts for mutations | CONNECTED |
| Static SERVICES fallback | **REMOVED** | PASS |

## Domain Verification

| Domain | Screen | API | Status |
|--------|--------|-----|--------|
| Authentication | login, signup | authApi | CONNECTED |
| Bookings | book, track, rate | coreApi + WS | CONNECTED |
| Membership | invoices | parityApi.subscriptions | CONNECTED |
| Wallet | wallet tab | coreApi | CONNECTED |
| Tracking | track/[id] | tracking + WS | CONNECTED |
| Payments | use-booking-payment | Razorpay native | CONNECTED |
| Referrals | profile hooks | coreApi | CONNECTED |
| Notifications | push hooks | device token API | CONNECTED |
| Maps | address/picker | parityApi.geo | CONNECTED |
| Realtime | RealtimeBridge | 5 WS channels | CONNECTED |

## Offline Architecture

- Queue: `homigo_offline_queue` in AsyncStorage (max 8 retries)
- Blocked paths: payments, wallet top-up (OfflinePaymentBlockedError)
- Catalog cache: `homigo_catalog_services_v1`, `homigo_catalog_featured_v1`

## Screens: 29

## Performance (static evidence)

- Startup certification: `homigo-mobile/scripts/startup-certification.mjs`
- Realtime stress: `homigo-mobile/scripts/stress-realtime-cache.mjs`
- Bundle: Expo export artifacts in .expo-export-final/

## Mobile Readiness Score: 88%
