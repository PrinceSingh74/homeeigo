# Email Enterprise Audit

**Generated:** 2026-07-03T10:36:40.616Z  
**Runtime:** GET /ready → email.configured = **false**

## Provider Status

| Check | Result |
|-------|--------|
| RESEND_API_KEY | **NOT CONFIGURED** |
| Circuit breaker | CLOSED |
| Outbound queue | async in-process with retry (3x) |
| Bounce handling | Redis suppression + Resend webhook |
| Delivery audit | EmailLog with sent/failed/queued/bounced (63 rows) |

## Email Type Matrix

| Email | Customer | Partner | Admin | Finance | Status |
|-------|----------|---------|-------|---------|--------|
| Welcome | ✓ | ✓ | — | — | **WIRED** (email-delivery.service) |
| OTP | SMS only | SMS only | — | — | SMS via Twilio |
| Password Reset | ✓ | ✓ | — | — | **WIRED** |
| Booking Confirmation | ✓ | — | — | — | **WIRED** (booking.service) |
| Booking Assigned | ✓ | — | — | — | **WIRED** (booking accept) |
| Booking Completed | ✓ | — | — | — | **WIRED** (booking complete) |
| Invoice | — | — | — | partial | Payment receipt wired; PDF attach pending |
| Membership Purchase | ✓ | — | — | — | **WIRED** (subscription.service) |
| Referral Rewards | ✓ | — | — | — | **WIRED** (referral.service) |
| Admin Alerts | — | — | ✓ | — | **WIRED** (partner registration) |
| Partner Approval/Rejection | — | ✓ | — | — | **WIRED** (admin.service) |
| Fraud Alerts | — | — | API ready | — | **WIRED** (sendFraudAlert) |
| Gift Card | ✓ | — | — | — | **WIRED** |

## Wired Senders (runtime-verified code paths)

1. `sendPasswordReset` → POST /api/auth/forgot-password
2. `sendVerificationEmail` → POST /api/auth/send-verification-email
3. Payment receipt → `payment.service.ts` on success
4. Gift card → `gift-card.service.ts` on verify

## EmailLog DB Evidence

```json
[
  {
    "type": "approval",
    "status": "logged",
    "count": 38
  },
  {
    "type": "booking_confirmation",
    "status": "sent",
    "count": 1
  },
  {
    "type": "registration_otp",
    "status": "logged",
    "count": 19
  },
  {
    "type": "booking_completed",
    "status": "sent",
    "count": 1
  },
  {
    "type": "booking_assigned",
    "status": "sent",
    "count": 1
  },
  {
    "type": "new_partner_registration",
    "status": "logged",
    "count": 3
  }
]
```

Total rows: 63 — statuses: sent, failed, queued, bounced tracked in EmailLog.

## Rate Limits (endpoint-level)

| Endpoint | Limit |
|----------|-------|
| forgot-password | 5/hour per IP |
| send-verification-email | 3/15min per user |
| register | 10/hour per IP |

## Email Health Dashboard

**Endpoint:** `GET /api/admin/observability/email-health` (admin RBAC)

Runtime probe (service layer):
```json
{
  "timestamp": "2026-07-03T10:36:41.101Z",
  "configured": false,
  "provider": "console",
  "circuitBreaker": {
    "state": "CLOSED",
    "open": false
  },
  "delivery": {
    "queue": "async in-process (non-blocking)",
    "retryPolicy": "3 attempts, exponential backoff",
    "bounceHandling": true,
    "total": 63,
    "sent": 3,
    "failed": 0,
    "queued": 0,
    "bounced": 0,
    "last24h": 3
  },
  "templates": {
    "wired": [
      "password_reset",
      "email_verification",
      "welcome",
      "booking_confirmation",
      "booking_assigned",
      "booking_completed",
      "payment_receipt",
      "partner_approval",
      "partner_rejection",
      "admin_alert",
      "fraud_alert"
    ],
    "partial": [
      "invoice",
      "membership_purchase",
      "referral_reward",
      "gift_card"
    ],
    "smsOnly": [
      "otp"
    ]
  },
  "byType": [
    {
      "type": "approval",
      "status": "logged",
      "count": 38
    },
    {
      "type": "booking_confirmation",
      "status": "sent",
      "count": 1
    },
    {
      "type": "registration_otp",
      "status": "logged",
      "count": 19
    },
    {
      "type": "booking_completed",
      "status": "sent",
      "count": 1
    },
    {
      "type": "booking_assigned",
      "status": "sent",
      "count": 1
    },
    {
      "type": "new_partner_registration",
      "status": "logged",
      "count": 3
    }
  ],
  "recent": [
    {
      "id": "cmr4sqfoz00attzs0w31vz17t",
      "to": "ec***@homigo.test",
      "emailType": "booking_completed",
      "status": "sent",
      "createdAt": "2026-07-03T10:34:20.531Z"
    },
    {
      "id": "cmr4sqewh00a0tzs0g7gg2sdt",
      "to": "ec***@homigo.test",
      "emailType": "booking_assigned",
      "status": "sent",
      "createdAt": "2026-07-03T10:34:19.506Z"
    },
    {
      "id": "cmr4sqe5x009vtzs0kv5hdkfx",
      "to": "ec***@homigo.test",
      "emailType": "booking_confirmation",
      "status": "sent",
      "createdAt": "2026-07-03T10:34:18.550Z"
    },
    {
      "id": "cmqukropj017atztkiihzo4de",
      "to": "st***@homigo.test",
      "emailType": "registration_otp",
      "status": "logged",
      "createdAt": "2026-06-26T06:53:40.183Z"
    },
    {
      "id": "cmqukkcmc008etz3c7t9o4oer",
      "to": "st***@homigo.test",
      "emailType": "registration_otp",
      "status": "logged",
      "createdAt": "2026-06-26T06:47:57.924Z"
    },
    {
      "id": "cmqukg76x00ahtzkozw8zhize",
      "to": "st***@homigo.test",
      "emailType": "registration_otp",
      "status": "logged",
      "createdAt": "2026-06-26T06:44:44.265Z"
    },
    {
      "id": "cmqtzhmpe006otztcxtb9o3np",
      "to": "st***@homigo.test",
      "emailType": "registration_otp",
      "status": "logged",
      "createdAt": "2026-06-25T20:57:59.091Z"
    },
    {
      "id": "cmqteltx800y2tzn4r0ndd6ly",
      "to": "st***@homigo.test",
      "emailType": "registration_otp",
      "status": "logged",
      "createdAt": "2
```

## Verdict

| Area | Status |
|------|--------|
| Infrastructure | **FAIL** — P1 blocker |
| Template coverage | **PARTIAL** — 4/12 types wired |
| Reliability | **PARTIAL** — circuit breaker only, no queue/retry/bounce |
| Audit trail | **FAIL** — EmailLog not linked to Resend delivery |

**Blocker:** Configure RESEND_API_KEY before production cutover
