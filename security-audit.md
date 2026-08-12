# Auth & Security Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Auth Probes (unauthenticated → expect 401)

- /api/admin/dashboard: HTTP 401 PASS
- /api/users/me: HTTP 401 PASS
- /api/bookings/upcoming: HTTP 401 PASS
- /api/wallet/balance: HTTP 401 PASS
- /api/providers/me: HTTP 401 PASS

## Coverage

| Layer | Implementation | Status |
|-------|----------------|--------|
| JWT access | jwt.service.ts | CONFIGURED |
| Refresh rotation | refresh-token-family.service.ts | CONFIGURED |
| Admin RBAC | admin-rbac.ts + rbac.service.ts | CONFIGURED |
| WS auth | ws-connection-auth.ts | CONFIGURED |
| Rate limiting | rate-limit.middleware.ts | ACTIVE |
| Idempotency | idempotency.middleware.ts | ACTIVE |

## Security Coverage Score: 100%
