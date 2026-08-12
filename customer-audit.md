# Customer Panel Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Domain Verification

| Domain | UI Route | API | DB Models | Status |
|--------|----------|-----|-----------|--------|
| Authentication | /login, /signup, OAuth | /api/auth/* | User, RefreshToken, OTP | CONNECTED |
| Bookings | /bookings, /book | /api/bookings/* | Booking, Payment | CONNECTED |
| Membership | /membership | /api/subscriptions/* | UserSubscription, MembershipPlan | CONNECTED |
| Wallet | /wallet | /api/wallet/* | WalletTransaction | CONNECTED |
| Referrals | /referrals | /api/referrals/* | ReferralTransaction | CONNECTED |
| Payments | checkout hooks | /api/payments/* | Payment | CONNECTED |
| Notifications | /notifications | /api/notifications/* | Notification | CONNECTED |
| Tracking | track components | /api/tracking/*, WS | Tracking, LocationHistory | CONNECTED |
| Reviews | rating flows | /api/ratings/* | Rating | CONNECTED |
| Support | /support | /api/support/* | SupportTicket | CONNECTED |

## Runtime Probes

- /api/users/me → HTTP 401
- /api/bookings/upcoming → HTTP 401
- /api/wallet/balance → HTTP 401

## Pages: 26 | API-connected: 5
