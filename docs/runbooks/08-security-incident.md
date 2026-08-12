# Runbook 08 — Security Incident
**Trigger:** suspected key leak, auth bypass, abuse, data exfiltration.
1. **Contain:** rotate the affected secret immediately (JWT_SECRET, RAZORPAY keys, GOOGLE_MAPS key, DB creds). Force-logout users (`force-logout` admin route / bump auth epoch).
2. **Key exposure:** `grep -rE "AIza|sk_live|rzp_live" src/` must be empty. Google server key never client-side; client key must be referrer/IP-restricted in GCP.
3. **Auth/RBAC:** verify admin routes 401/403; WS rooms enforce `canAccessBookingWs`; no IDOR (ownership scoped).
4. **Payments:** webhook HMAC verified; replay blocked (401 on bad sig).
5. **Audit:** review `activity_logs`, `audit_log`; identify blast radius.
6. **Report:** per compliance policy; notify affected users if PII involved.
