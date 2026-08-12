# Phase 16.3 — Geofencing Certification (Float + haversine, NO PostGIS)

**Date:** 2026-06-13 · execution-only against isolated `homigo_test`. Circular geofences (centre + radius); containment = haversine ≤ radius. Two **additive** tables (`geofences`, `geofence_events`) — no PostGIS, no change to existing location/booking tables.

## Migration (careful, additive)
- `prisma db push` → `homigo_test` (got both tables).
- **Live `homigo_db`:** applied the two `CREATE TABLE IF NOT EXISTS` + indexes via **surgical SQL** — deliberately NOT via `db push`, because a full push wanted to add an unrelated `wallet_transactions.idempotency_key` unique constraint (pre-existing drift on a financial table). Geofence tables only; financial tables untouched. Verified: `\dt geofence*` → `geofences`, `geofence_events`.

## Service (`geofence.service.ts`)
- `containsPoint` / `findContaining` — haversine circle test.
- `isServiceable(lat,lng,category)` — opt-in gating: serviceable iff inside an active SERVICE_ZONE (category-matched); **defaults to serviceable when no zones are configured** (never silently blocks bookings). Returns `surgeMultiplier`.
- `evaluate(subject, lat, lng)` — diffs current zone membership vs the subject's last events, appends ENTER/EXIT, emits a best-effort WS `geofence_event`. **Advisory-locked per subject** (`pg_advisory_xact_lock`) → no duplicate ENTER under concurrent pings.
- Admin CRUD: `create / list / update / remove`.

## Routes
- Customer: `GET /api/geo/serviceable` (401 auth-gated ✅), `POST /api/geo/checkin` (rate-limited 120/min ✅).
- Admin (RBAC-gated `/api/admin`): `GET/POST/PATCH/DELETE /api/admin/geofences` (401 ✅).

## Execution evidence
| Test | Result |
|---|---|
| Containment (inside 70 m vs outside 20 km of a 500 m circle) | inside ✅ / outside ✅ |
| Enter → stay → exit | ENTER=1, stay emits 0, EXIT=1 ✅ |
| **Concurrency 50 / 100 / 250** concurrent `evaluate` (subject entering) | **exactly 1 ENTER each — no duplicate** ✅ |
| Serviceability (inside serviceable / outside not when configured) | ✅ |
| Admin update + list | radius 500→1000, surge 1.5, listed ✅ |

## RULE #4
TypeScript clean ✅ · concurrency (no duplicate ENTER) ✅ · additive migration (no financial-table change) ✅ · cert report ✅.

**Verdict: 16.3 PRODUCTION-READY.** Rollback: `DROP TABLE geofence_events, geofences;` + `git checkout -- src/services/geofence.service.ts src/routes/geo.ts src/routes/admin.ts` + revert schema append.
