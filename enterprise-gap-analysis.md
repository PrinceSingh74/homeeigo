# Enterprise Gap Analysis

**Generated:** 2026-07-03T09:56:49.523Z  
**Total gaps:** 4

## Priority Summary

| Priority | Count |
|----------|------:|
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 3 |
| P4 | 0 |

## Findings

### G-NOTIF-001 [P2] Email integration not configured

- **Root Cause:** RESEND_API_KEY or email provider unset
- **Impact:** Verification emails and transactional email degraded
- **Fix Plan:** Configure email provider in .env
- **Files:** apps/backend/.env.example

### G-API-001 [P3] 41 backend endpoints have no detected frontend consumer

- **Root Cause:** Admin-only, internal, or future APIs not referenced in client code scan
- **Impact:** Potential dead code or missing UI coverage
- **Fix Plan:** Review unused endpoint list; wire UI or deprecate
- **Files:** apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts, apps/backend/src/routes/admin.ts

### G-DB-002 [P3] 4 Prisma models with weak code references

- **Root Cause:** Models used only via raw SQL, migrations, or not yet wired
- **Impact:** Schema bloat; possible orphaned tables
- **Fix Plan:** Audit each model for actual DB usage
- **Files:** apps/backend/prisma/schema.prisma

### G-MOB-001 [P3] Mobile catalog falls back to static SERVICES when API empty

- **Root Cause:** useCatalogServices() in homigo-mobile/src/hooks/use-catalog.ts
- **Impact:** Offline/demo appearance with stale service list
- **Fix Plan:** Show empty state instead of static fallback in production
- **Files:** homigo-mobile/src/hooks/use-catalog.ts

