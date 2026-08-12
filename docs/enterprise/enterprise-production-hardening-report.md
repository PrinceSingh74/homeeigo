# HOMIGO Enterprise Production Hardening Report

**Generated:** 2026-07-02  
**Scope:** Stability, scalability, WebSockets, auth bootstrap, React performance, observability  
**Method:** Runtime evidence only — no synthetic PASS claims

---

## Executive summary

| Phase | Verdict | Evidence |
|-------|---------|----------|
| 1 — Admin alert broadcast | **PASS** | Unit tests + `dispatchLiveAlerts` runtime (0 subscribers → no broadcast) |
| 2 — Certification idempotency | **PASS** | `ensureDir` × 3 without EEXIST |
| 3 — WebSocket lifecycle | **PASS** | Duplicate-join test; empty-room broadcast suppressed |
| 4 — Auth bootstrap gate | **IMPLEMENTED** | Code + gate on protected queries; full 401 timeline needs running stack |
| 5 — React hook warnings | **PASS** | `admin-panel` exhaustive-deps cleared; `web` lint clean |
| 6 — Observability | **PARTIAL** | New metrics seeded; full Prometheus scrape needs running backend |
| 7 — Ecosystem certification | **NOT PROVEN** | Backend not running on `:3000` at audit time |

---

## Phase 1 — Admin alert broadcast audit

### Finding (before)

- `opsMapService.emit()` called `roomManager.broadcast()` unconditionally
- Logs showed `ADMIN_ALERT sent to 0/0` with 84 active alerts and 0 subscribers
- Dedup existed but no subscriber guard, rate limit, or metrics

### Root cause

Alert dispatcher ran on maintenance interval regardless of WebSocket room occupancy. `broadcast()` always logged even when `room.size === 0`.

### Fix applied

| File | Change |
|------|--------|
| `src/lib/admin-alert-broadcast.ts` | **NEW** — subscriber guard, dedup, throttle (60s), batch cap (20/tick), metrics |
| `src/services/ops-map.service.ts` | Early return when `subscribers === 0`; uses `tryBroadcastAdminAlert` |
| `src/lib/websocket.ts` | Skip broadcast log + Redis fan-out when room empty |
| `src/lib/metrics-init.ts` | Seed `admin_alerts_*` counters |
| `monitoring/rules/homigo-alerts.yml` | `AdminAlertsNoSubscribers` alert |

### Metrics

| Metric | Type |
|--------|------|
| `admin_alerts_sent_total` | counter |
| `admin_alerts_skipped_total{reason}` | counter |
| `admin_alerts_deduplicated_total` | counter |
| `admin_alerts_rate_limited_total{kind}` | counter |

### Runtime evidence

**Before (observed):** `ADMIN_ALERT sent to 0/0`, `subscribers: 0`, `active alerts: 84`

**After — unit tests (`bun test src/__tests__/admin-alert-broadcast.test.ts`):**
```
(pass) skips broadcast when subscriber count is 0
(pass) deduplicates identical alert keys
(pass) prevents duplicate room joins
```

**After — dispatch with 0 subscribers:**
```json
{"active":0,"emitted":0,"skipped":0,"deduplicated":0,"rateLimited":0,"subscribers":0}
```
No `[Broadcast] ADMIN_ALERT sent to 0/0` log emitted.

**After — with 1 subscriber:** `[Broadcast] ADMIN_ALERT sent to 1/1 in admin:ops`

---

## Phase 2 — Ecosystem certification script hardening

### Finding (before)

```
EEXIST: .certification-evidence already exists
```
`mkdirSync(OUT_DIR, { recursive: true })` failed on Windows when path existed as file or on race.

### Fix applied

| File | Change |
|------|--------|
| `scripts/lib/safe-fs.ts` | **NEW** — `ensureDir()`, `pruneStaleEvidence()` |
| `scripts/ecosystem-enterprise-certification.ts` | Uses `ensureDir` + stale evidence cleanup |

### Runtime evidence

```
ensureDir x3 OK, pruned 1
```
Three consecutive `ensureDir` calls on `homigo-mobile/.certification-evidence` — **no EEXIST**.

**Full ecosystem cert:** `ConnectionRefused` on `http://localhost:3000/health` — backend not running. Re-run with `bun run dev` + `bun run cert:ecosystem` for end-to-end PASS.

---

## Phase 3 — WebSocket lifecycle audit

### Finding (before)

Repeated `[Room] user joined` / `left` logs — reconnect storms, no duplicate-join guard, broadcast noise on empty rooms.

### Fix applied

| File | Change |
|------|--------|
| `src/lib/websocket.ts` | Duplicate join detection + metric; empty-room broadcast skip |
| `src/lib/websocket-metrics-sampler.ts` | **NEW** — `websocket_room_count`, `websocket_connection_count` gauges |
| `src/index.ts` | Register WS metric sampler |
| Client `use-realtime-channel.ts` (web) | Already has exponential backoff + reconnect signal |

### Metrics

| Metric | Type |
|--------|------|
| `websocket_reconnect_total` | counter (seeded) |
| `websocket_duplicate_join_total{room}` | counter |
| `websocket_room_count` | gauge |
| `websocket_connection_count` | gauge |
| `websocket_heartbeat_failures` | counter (seeded) |

### Runtime evidence

```
(pass) prevents duplicate room joins
room size remains 1 after double addToRoom
```

---

## Phase 4 — Authentication bootstrap audit

### Finding (before)

401s on `/api/notifications`, `/api/bookings/price-quote` before auth refresh completed — queries could fire with stale persisted token while `status === "initializing"`.

### Fix applied

| File | Change |
|------|--------|
| `apps/web/src/lib/auth/bootstrap-gate.ts` | **NEW** — `waitForAuthBootstrap()`, timing metrics |
| `apps/web/src/stores/auth-store.ts` | Bootstrap start/complete markers |
| `apps/web/src/services/auth/api-client.ts` | Await bootstrap before `auth: true` requests |
| `apps/web/src/hooks/use-core-data.ts` | `isAuthReady` gate on notifications + price-quote |
| `apps/web/src/components/realtime/RealtimeBridge.tsx` | WS only when `authenticated`, not just token present |
| `apps/backend/src/routes/auth.ts` | `auth_refresh_total`, `auth_refresh_failures` counters |

### Metrics

| Metric | Source |
|--------|--------|
| `auth_bootstrap_duration_ms` | client gate (gauge seeded server-side) |
| `auth_refresh_total{outcome}` | `/api/auth/refresh` |
| `auth_refresh_failures` | `/api/auth/refresh` failures |
| `auth_startup_401_total` | client gate on 401 during init |

### Runtime evidence

**NOT PROVEN** for before/after 401 timeline — requires running web + backend with persisted session. Code path verified: protected queries use `enabled: isAuthReady && isAuthenticated`.

---

## Phase 5 — React performance audit

### Finding (before)

`admin-panel` exhaustive-deps warnings on finance pages (`queue`, `runs`, `issues`, `gwIssues` unstable in useMemo deps).

### Fix applied

| File | Change |
|------|--------|
| `finance/reconciliation/page.tsx` | Wrap `runs`, `issues`, `gwIssues` in `useMemo` |
| `finance/payouts/page.tsx` | Wrap `queue`, `batches` in `useMemo` |

### Runtime evidence

**Before:** 4 `react-hooks/exhaustive-deps` warnings in admin-panel lint  
**After:** `npm run lint` — **zero exhaustive-deps warnings** (admin-panel + web)

---

## Phase 6 — Enterprise observability

### Verified (code + seeds)

- Prometheus metrics seeded for admin alerts, WebSocket, auth refresh, backup (prior mission)
- Grafana/Prometheus configs unchanged; new alert rules added
- No duplicate metric names introduced
- Empty-room broadcast eliminates log spam

### NOT PROVEN at runtime

- `/metrics` scrape with new series (backend not running)
- Grafana dashboard panels for new metrics (not in scope)

---

## Files modified (summary)

### Backend
- `src/lib/admin-alert-broadcast.ts` (new)
- `src/lib/websocket-metrics-sampler.ts` (new)
- `src/services/ops-map.service.ts`
- `src/lib/websocket.ts`
- `src/websocket/admin-ops.ws.ts`
- `src/lib/maintenance.ts`
- `src/lib/metrics-init.ts`
- `src/index.ts`
- `src/routes/auth.ts`
- `scripts/lib/safe-fs.ts` (new)
- `scripts/ecosystem-enterprise-certification.ts`
- `monitoring/rules/homigo-alerts.yml`
- `src/__tests__/admin-alert-broadcast.test.ts` (new)

### Web
- `src/lib/auth/bootstrap-gate.ts` (new)
- `src/stores/auth-store.ts`
- `src/services/auth/api-client.ts`
- `src/hooks/use-core-data.ts`
- `src/components/realtime/RealtimeBridge.tsx`

### Admin panel
- `src/app/(console)/finance/reconciliation/page.tsx`
- `src/app/(console)/finance/payouts/page.tsx`

---

## Remaining risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Ecosystem cert needs live backend | Medium | Run `docker compose up -d` + `bun run dev` before `cert:ecosystem` |
| Auth 401 timeline not captured | Low | Capture HAR on next dev session with `bootstrap-gate` metrics |
| `partner-web` / `homigo-mobile` auth gate not ported | Medium | Apply same `bootstrap-gate` pattern |
| Admin panel has no WS reconnect telemetry | Low | Add telemetry module when admin realtime usage grows |
| 84 active ops alerts still computed when subscribers connect | Info | DB scan only runs when `subscribers > 0` after fix |

---

## Commands to verify locally

```bash
# Phase 1
cd apps/backend && bun test src/__tests__/admin-alert-broadcast.test.ts

# Phase 2
cd apps/backend && bun -e "import { ensureDir } from './scripts/lib/safe-fs.ts'; await ensureDir('../../homigo-mobile/.certification-evidence'); await ensureDir('../../homigo-mobile/.certification-evidence'); console.log('OK')"

# Phase 3-6 (needs backend)
cd apps/backend && bun run dev
curl http://localhost:3000/metrics | grep -E 'admin_alerts|websocket_|auth_refresh'

# Full ecosystem cert
bun --env-file=.env run scripts/ecosystem-enterprise-certification.ts
```
