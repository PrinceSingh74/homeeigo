# Integration Matrix

**Audit date:** 2026-06-10  
**Statuses:** CONNECTED | PARTIALLY CONNECTED | BROKEN

---

## Matrix

| Integration | Status | Execution Evidence |
|-------------|--------|-------------------|
| **Frontend ↔ Backend** | PARTIALLY CONNECTED | Web :3001 live; APIs return data; e2e signup FAIL; 404 probe FAIL |
| **Mobile ↔ Backend** | PARTIALLY CONNECTED | Typecheck PASS; no device API calls |
| **Admin ↔ Backend** | PARTIALLY CONNECTED | API smoke 12/12 + finance 18/18; UI :3003 down |
| **Provider ↔ Backend** | PARTIALLY CONNECTED | API smoke 21/21; UI :3002 down; booking mutations untested |
| **Backend ↔ Database** | CONNECTED | health ok; orphans 0; 480 tests PASS |
| **Backend ↔ Razorpay** | BROKEN (live) | `configured: false`; dev mock orders only |
| **Backend ↔ Email** | BROKEN (live) | `email.configured: false` |
| **Backend ↔ SMS/Twilio** | BROKEN (live) | `sms.configured: false` |
| **Backend ↔ Push (Expo)** | PARTIALLY CONNECTED | SDK integrated; no device delivery test |
| **Backend ↔ Redis** | CONNECTED | health ok; smoke 17/17 |
| **Backend ↔ Queue/Scheduler** | PARTIALLY CONNECTED | In-process jobs run; no failure injection |
| **Backend ↔ S3** | PARTIALLY CONNECTED | Code exists; not configured/tested |
| **Backend ↔ WebSockets** | CONNECTED | Admin/partner WS smoke close 1000 |
| **Monitoring ↔ Backend** | PARTIALLY CONNECTED | `/metrics` emits; Prometheus not scraping live |

---

## Visual Summary

```
CONNECTED (5):        DB, Redis, WS, (dev payment mock), audit logs
PARTIAL (8):          Web, Mobile, Admin UI, Provider UI, Push, Queue, S3, Monitoring
BROKEN (3):           Razorpay live, Email, SMS
```

---

## Blockers to CONNECTED

1. Configure Razorpay + webhook secret → re-run payment + k6 tests
2. Configure Resend + Twilio → re-run signup e2e
3. Start :3002/:3003 → run admin/partner e2e
4. Mobile device smoke on Expo
5. Deploy Prometheus/Grafana stack
6. Execute `p2:dr` drill
