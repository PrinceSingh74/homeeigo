# Email Enterprise Audit

**Generated:** 2026-09-21T07:18:30.873Z  
**Runtime:** GET /ready → email.configured = **false**

## Provider Status

| Check | Result |
|-------|--------|
| RESEND_API_KEY | **NOT CONFIGURED** |
| Circuit breaker | CLOSED |
| Outbound queue | async in-process with retry (3x) |
| Bounce handling | Redis suppression + Resend webhook |
| Delivery audit | EmailLog with sent/failed/queued/bounced (1204 rows) |

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
    "type": "registration_otp",
    "status": "logged",
    "count": 283
  },
  {
    "type": "approval",
    "status": "logged",
    "count": 38
  },
  {
    "type": "email_verification",
    "status": "sent",
    "count": 1
  },
  {
    "type": "payment_receipt",
    "status": "sent",
    "count": 15
  },
  {
    "type": "booking_completed",
    "status": "sent",
    "count": 116
  },
  {
    "type": "welcome",
    "status": "sent",
    "count": 33
  },
  {
    "type": "booking_assigned",
    "status": "sent",
    "count": 262
  },
  {
    "type": "partner_rejection",
    "status": "sent",
    "count": 1
  },
  {
    "type": "new_partner_registration",
    "status": "logged",
    "count": 3
  },
  {
    "type": "password_reset",
    "status": "sent",
    "count": 6
  },
  {
    "type": "partner_approval",
    "status": "sent",
    "count": 6
  },
  {
    "type": "invoice",
    "status": "sent",
    "count": 15
  },
  {
    "type": "admin_alert",
    "status": "sent",
    "count": 90
  },
  {
    "type": "booking_confirmation",
    "status": "sent",
    "count": 335
  }
]
```

Total rows: 1204 — statuses: sent, failed, queued, bounced tracked in EmailLog.

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
  "timestamp": "2026-09-21T07:18:31.728Z",
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
    "total": 1204,
    "sent": 880,
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
      "otp"
    ],
    "smsOnly": [
      "otp"
    ]
  },
  "byType": [
    {
      "type": "registration_otp",
      "status": "logged",
      "count": 283
    },
    {
      "type": "approval",
      "status": "logged",
      "count": 38
    },
    {
      "type": "email_verification",
      "status": "sent",
      "count": 1
    },
    {
      "type": "payment_receipt",
      "status": "sent",
      "count": 15
    },
    {
      "type": "booking_completed",
      "status": "sent",
      "count": 116
    },
    {
      "type": "welcome",
      "status": "sent",
      "count": 33
    },
    {
      "type": "booking_assigned",
      "status": "sent",
      "count": 262
    },
    {
      "type": "partner_rejection",
      "status": "sent",
      "count": 1
    },
    {
      "type": "new_partner_registration",
      "status": "logged",
      "count": 3
    },
    {
      "type": "password_reset",
      "status": "sent",
      "count": 6
    },
    {
      "type": "partner_approval",
      "status": "sent",
      "count": 6
    },
    {
      "type": "invoice",
      "status": "sent",
      "count": 15
    },
    {
      "type": "admin_alert",
      "status": "sent",
      "count": 90
    },
    {
      "type": "booking_confirmation",
      "status": "sent",
      "count": 335
    }
  ],
  "recent": [
    {
      "id": "cmu9xu6yi00letz10f8kvv1i0",
      "to": "ss***@gmail.com",
      "emailType": "booking_confirmation",
      "status": "sent",
      "createdAt": "2026-09-20T14:55:11.802Z"
    },
    {
      "id": "cmu9xpwvh00ijtz10l7uaahst",
      "to": "pr***@gmail.com",
      "emailType": "booking_completed",
      "status": "sent",
      "createdAt": "2026-09-20T14:51:52.108Z"
    },
    {
      "id": "cmu9hqoe200k7tzd8i41ew4qr",
      "to": "pr***@gmail.com",
      "emailType": "booking_confirmation",
      "status": "sent",
      "createdAt": "2026-09-20T07:24:33.914Z"
    },
    {
      "id": "cmu8d4ev701aktzu0ci3puqbl",
      "to": "pr***@gmail.com",
      "emailType": "booking_assigned",
      "status": "sent",
      "createdAt": "2026-09-19T12:27:30.500Z"
    },
    {
      "id": "cmu8d36lw017wtzu08j871a1b",
      "to": "pr***@gmail.com",
      "emailType": "booking_confirmation",
      "status": "sent",
  
```

## Verdict

| Area | Status |
|------|--------|
| Infrastructure | **FAIL** — P1 blocker |
| Template coverage | **PARTIAL** — 4/12 types wired |
| Reliability | **PARTIAL** — circuit breaker only, no queue/retry/bounce |
| Audit trail | **FAIL** — EmailLog not linked to Resend delivery |

**Blocker:** Configure RESEND_API_KEY before production cutover
