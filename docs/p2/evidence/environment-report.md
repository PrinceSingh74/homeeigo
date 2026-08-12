# Evidence — Environment Discovery Report

**Generated:** 2026-06-08T17:47:00Z  
**Host:** Windows 10 (win32 10.0.26200)  
**Workspace:** `c:\Users\Kapiissh Green\OneDrive\Desktop\homigo`

## Toolchain

| Tool | Status | Version / Path |
|---|---|---|
| Docker | ✅ Installed (daemon started mid-session) | 29.5.2 |
| Bun | ✅ | 1.3.14 |
| Node | ✅ | v22.22.0 |
| k6 | ❌ MISSING | — |
| pg_dump / pg_restore / psql (host) | ❌ MISSING | use `docker exec homigo-postgres` |
| aws CLI | ❌ MISSING | S3 SDK in app only |

## Running Services (verified via probe)

| Service | Port | Status | Evidence |
|---|---|:--:|---|
| **Backend** (Bun/Elysia) | 3000 | ✅ RUNNING | `GET /health` → 200; `GET /ready` → 200; `GET /metrics` → 200 (3732 bytes) |
| **PostgreSQL** | 5433 | ✅ HEALTHY | `homigo-postgres` container `Up (healthy)` |
| **Redis** | 6379 | ✅ HEALTHY | `homigo-redis` container `Up`; `/health` reports `redis: ok` |
| Customer Web | 3001 | ⚪ NOT RUNNING | connection refused |
| Partner Web | 3002 | ⚪ NOT RUNNING | connection refused |
| Admin Panel | 3003 | ⚪ NOT RUNNING | connection refused |
| Prometheus | 9090 | ⚪ NOT RUNNING | connection refused |
| Alertmanager | 9093 | ⚪ NOT RUNNING | connection refused |
| Grafana | (none local) | ⚪ NOT RUNNING | no instance deployed |

## Backend Health Snapshot

```json
{
  "status": "ok",
  "environment": "development",
  "services": { "database": "ok", "redis": "ok" },
  "timestamp": "2026-06-08T17:46:20.588Z"
}
```

## Application Versions

| App | package version | Framework |
|---|---|---|
| homigo-backend | 1.0.0 | Bun + Elysia + Prisma 6.19.3 |
| homigo-web | 0.1.0 | Next.js (port 3001) |
| homigo-partner-web | 0.1.0 | Next.js (port 3002) |
| homigo-admin-panel | 0.1.0 | Next.js (port 3003) |

## Database State

- Migrations: 22 found, **no pending** (`prisma migrate deploy` exit 0)
- Seed: **FAILED** (P2003 foreign-key constraint) — demo data partially present
- Record counts (source `homigo_db`):

| Table | Count |
|---|---:|
| users | 48 |
| bookings | 0 |
| payments | 0 |
| hcoin_wallets | 8 |
| user_subscriptions | 22 |

## Configuration Gaps

| Env var | Status | Impact |
|---|---|---|
| `AWS_S3_BUCKET` | unset | S3 validation NOT VERIFIED |
| `SENTRY_DSN` | unset | Sentry delivery NOT VERIFIED |
| `.env` | created from `.env.example` this session | dev secrets only |

## Dependency Status Summary

| Dependency | Reachable | Gates traffic |
|---|---|---|
| PostgreSQL | ✅ | yes (`/health`, `/ready`) |
| Redis | ✅ | no (degrades gracefully) |
| Razorpay | mock/dev | payments in dev mode |
| Sentry | disabled | — |
| S3 | disabled | — |
