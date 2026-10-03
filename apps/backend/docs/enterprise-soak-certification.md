# Enterprise Soak Certification

**Executed:** 2026-10-03T09:34:06.948Z
**Run ID:** `soak-mus71nir`
**Command:** `bun test src/__tests__/enterprise-soak-certification.test.ts`

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | 100 Customer Reschedules | **PASS** | 100/100 sequential reschedules succeeded {"ok":100,"fail":0,"finalSlot":"2026-10-14T17:00:00.000Z"} |
| 2 | 100 Concurrent Reschedules | **PASS** | 94/100 succeeded; 0 corrupt; 0 connection-pool errors {"ok":94,"corrupt":0,"poolErrors":0,"total":100} |
| 3 | 50 Partner Support Tickets | **PASS** | created=50 visible=50 {"created":50,"visible":50} |
| 4 | 50 Admin Replies | **PASS** | replies=50/50 customerSeesAdmin=true partnerSeesAdmin=true {"replies":50,"custAdminMsg":1,"partnerAdminMsg":1} |
| 5 | chain: Customer → Ticket → Admin Reply → Customer View | **PASS** | admin message in customer thread |
| 6 | chain: Partner → Ticket → Admin Reply → Partner View | **PASS** | admin message in partner thread |
| 7 | 50 Ticket Escalations | **PASS** | created=50/50 createErrors=0 escalated=50 priorityHigh=50 {"created":50,"createErrors":0,"escalated":50,"high":50} |
| 8 | Concurrent ticket create | **PASS** | created=20/20 uniqueNumbers=20 rejected=0 {"created":20,"unique":20,"rejected":0} |
| 9 | 50 Membership Coupon Applications | **PASS** | quotesWithDiscount=50/50 bookingsDiscounted=10/10 redemptions=10 {"quotesOk":50,"bookingsOk":10,"redemptions":10} |
| 10 | chain: Membership Coupon → Checkout → Discount → Payment | **PASS** | 10/10 bookings created with campaignDiscount > 0 |
| 11 | chain: Membership Coupon → Invoice | **NOT PROVEN** | Invoice generation not asserted in soak run (no invoice row check) |
| 12 | 50 Settings Updates | **PASS** | 50/50 updates persisted; final hours 08:00-19:00 {"ok":50} |
| 13 | WebSocket Delivery | **PASS** | 1 message(s) delivered to mock WS connection {"delivered":1} |
| 14 | chain: Customer → Reschedule → Partner Notification → Admin Visibility | **PASS** | http=200 slotOk=true notifDelta=1 adminSees=true |
| 15 | HTTP Customer support ticket chain | **PASS** | customer API shows admin reply |
| 16 | Playwright End-to-End | **NOT PROVEN** | Deferred to separate playwright run (see certification doc appendix) |

## E2E flow chains

- chain: Customer → Ticket → Admin Reply → Customer View: **PASS**
- chain: Partner → Ticket → Admin Reply → Partner View: **PASS**
- chain: Membership Coupon → Checkout → Discount → Payment: **PASS**
- chain: Membership Coupon → Invoice: **NOT PROVEN**
- chain: Customer → Reschedule → Partner Notification → Admin Visibility: **PASS**
- HTTP Customer support ticket chain: **PASS**
- Playwright End-to-End: **NOT PROVEN**
