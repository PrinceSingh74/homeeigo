# HOMIGO — Setup

See the root `README.md` for the full quick-start. This document tracks
environment-specific setup notes for Phase 1.

## Local prerequisites

- Bun (latest) — backend runtime
- Node.js 18+ — frontend tooling
- PostgreSQL 16 — database (Phase 1: config pending)
- Git

## Ports

- Frontend (Next.js): http://localhost:3001
- Backend (Elysia): http://localhost:3000
- Swagger docs: http://localhost:3000/swagger

## QA verification

- Latest integration verification report: [`docs/QA_VERIFICATION_REPORT.md`](./QA_VERIFICATION_REPORT.md)
- Staging deploy checklist: [`docs/STAGING_DEPLOY_CHECKLIST.md`](./STAGING_DEPLOY_CHECKLIST.md)

### Backend smoke scripts (API must be running)

```bash
cd apps/backend
npm run smoke:part3      # core REST (67 probes)
npm run smoke:partner    # partner-web stub routes
npm run smoke:provider   # vendor JWT APIs
npm run smoke:admin      # admin APIs + RBAC
npm run smoke:all        # all of the above + lifecycle E2E
```

Seed logins: `customer@homigo.demo`, `partner@homigo.demo`, `admin@homigo.demo` — password `Homigo@123` (after `npm run db:seed`).
