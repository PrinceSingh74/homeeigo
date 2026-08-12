# Partner Panel Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Domain Verification

| Domain | Route | API | Status |
|--------|-------|-----|--------|
| Availability | settings, online toggle | PUT /api/providers/me/online | CONNECTED |
| Bookings | /requests | /api/providers/me/bookings, /api/bookings/* | CONNECTED |
| Earnings | /earnings | /api/providers/me/earnings, WS /ws/earnings | CONNECTED |
| Payouts | /earnings/payouts | /api/providers/me/payouts | CONNECTED |
| Tracking | /navigation | POST /api/tracking/location | CONNECTED |
| Ratings | /reviews | /api/providers/me/reviews | CONNECTED |
| Attendance | geofence checkin | POST /api/geo/checkin | CONNECTED |
| Documents | registration | /api/partner/documents/* | CONNECTED |

## Runtime Probe

- GET /api/providers/me (unauthenticated) → 401

## Pages: 23
