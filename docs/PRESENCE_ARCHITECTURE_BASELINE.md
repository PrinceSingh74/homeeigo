# Presence Architecture Baseline — Phase 1A Forensic Audit

**Date:** 2026-09-07  
**Scope:** Partner OS Presence + Location foundation (evidence subsystem only — not a fifth FSM)

---

## Executive Summary

Homigo has a **mature four-axis Partner OS** (`partner-four-axis.ts`) with canonical availability mutations in `partner-operations.service.ts` and **job-scoped live tracking** in `tracking.service.ts`. Phase 1 gaps:

| Signal | Current source | Problem |
|--------|----------------|---------|
| Online (availability) | `Provider.isOnline` (explicit toggle) | Authoritative for dispatch eligibility |
| Liveness (telemetry) | Redis `provider:{id}:online` (60s TTL) | Only refreshed during **active job** GPS pings |
| Last seen | `Provider.lastSeenAt` | Updated on availability FSM transitions, not heartbeats |
| Location | `Location` (1:1 per provider) | Stale when idle-online; matching may use weeks-old fixes |

**Phase 1 adds** a dedicated **Presence evidence subsystem** (`PartnerPresence` + heartbeat API + Redis liveness) without creating a fifth business state machine.

---

## Four-Axis Lock (Verified)

Source: `apps/backend/src/lib/partner-four-axis.ts`, `.cursor/rules/partner-four-axis.mdc`

```
PARTNER lifecycle  → APPLIED … REACTIVATED
AVAILABILITY       → OFFLINE … PAUSED
JOB                → OFFERED … COMPLETED
FINANCE            → EARNING_POSTED … PAID
```

Presence is **liveness evidence** — derived from timestamps + session identity. It must **never** write lifecycle, job, or finance axes.

---

## Current Implementation Map

### Provider / Partner Model

| Path | Role |
|------|------|
| `apps/backend/prisma/schema.prisma` — `Provider` | Canonical partner row (`isOnline`, `lastSeenAt`, `currentStatus`, `lifecycleState`) |
| `apps/backend/prisma/schema.prisma` — `Location` | Latest dispatch geo (1 row per provider) |
| `apps/backend/prisma/schema.prisma` — `LocationHistory` | Job tracking trail (per booking) |
| `apps/backend/prisma/schema.prisma` — `RefreshToken` | Auth sessions (`deviceId`, `lastActivityAt`) |
| `apps/backend/prisma/schema.prisma` — `UserDevice` | Push registry (`deviceId`, `lastSeenAt`) |

Naming: **Partner** (product/UI/events) vs **Provider** (Prisma/API `/api/providers`).

### Availability FSM (Reusable — Do Not Rewrite)

| Module | Purpose |
|--------|---------|
| `partner-availability-fsm.ts` | Derive operational status from flags + job phase |
| `partner-operations.service.ts` | Canonical mutator: `setOnline`, `pause`, `resume`, `snapshot` |
| `partner-lifecycle-fsm.ts` | Lifecycle axis (ACTIVE gates dispatch) |
| `partner-job-fsm.ts` / `partner-finance-fsm.ts` | Job and money axes |

Tests: `partner-availability-fsm.test.ts`, `partner-four-axis-orthogonality.test.ts`, `partner-operations.integration.test.ts`.

### Redis

| Path | Role |
|------|------|
| `apps/backend/src/lib/redis.ts` | Optional client; in-memory fallback; locks, rate limits, pub/sub |
| `tracking.service.ts` | `provider:{providerId}:online` TTL 60s (job pings only) |
| `ops-map.service.ts` | Admin map uses Redis presence via `trackingService.onlineProviderIds()` |

### Location Tracking (Job-Scoped — Keep Separate)

| Path | Role |
|------|------|
| `tracking.service.ts` | Throttle (10m/5s), Location upsert, ETA, geofence, WS broadcast |
| `routes/tracking.ts` | `POST /api/tracking/location` (requires `bookingId`) |
| `websocket/tracking.ws.ts` | `/ws/tracking/:bookingId` |
| Partner web/mobile publishers | Active job only (`use-partner-tracking-publisher.ts`) |

### Mobile / Partner API (Today)

| Endpoint | Purpose |
|----------|---------|
| `PUT /api/providers/me/online` | Availability toggle (authoritative) |
| `GET /api/providers/me/operations` | Ops snapshot |
| `POST /api/tracking/location` | Job GPS (requires booking) |

**Missing before Phase 1:** idle-online heartbeat, unified presence read, session-bound liveness.

### Authentication & Sessions

| Path | Role |
|------|------|
| `plugins/auth.plugin.ts` | JWT bearer; `requireProvider()` |
| `services/refresh-token.service.ts` | RefreshToken rows = durable sessions |
| `services/jwt.service.ts` | Access token may carry `deviceId` claim |

Session identity for presence: **RefreshToken.id** promoted to `PartnerPresence.activeSessionId` on login/refresh.

### WebSocket / Workers / Dispatch

| Component | Presence relevance |
|-----------|-------------------|
| `lib/heartbeat.ts` | WS transport keepalive — **not** partner presence |
| `maintenance.ts` | Assignment dispatch; ops-map alerts for missing Redis presence |
| `matching.service.ts` | Filters `isOnline`, uses `Location` / base coords — not Redis TTL |
| `assignment-engine.service.ts` | Dispatch queue |

---

## Duplicate Concepts (Risk)

| Concept | Location A | Location B | Risk |
|---------|-----------|-----------|------|
| Online | `Provider.isOnline` | Redis TTL | Dispatch vs ops-map divergence |
| Last seen | `Provider.lastSeenAt` | `Location.lastUpdated` | Roster fallback often stale |
| Session | `RefreshToken` | Onboarding `sessionId` | Different meanings |
| Heartbeat | WS `HeartbeatManager` | Agent `heartbeatAt` | Transport/agent lease |
| Presence | Start-job OTP “proof-of-presence” | Redis TTL | Same word, different domains |

---

## Missing Pieces (Phase 1 Targets) — Status 2026-09-07

| # | Target | Status |
|---|--------|--------|
| 1 | `PartnerPresence` durable snapshot | ✅ Implemented |
| 2 | Heartbeat API | ✅ `POST/GET /api/providers/me/presence/*` |
| 3 | Redis `partner:presence:{id}` | ✅ Configurable TTL |
| 4 | Session validation | ✅ `activeSessionId` promotion + stale rejection |
| 5 | Location layer separate from job history | ✅ |
| 6 | Derived FRESH/STALE/EXPIRED | ✅ No fifth FSM |
| 7 | Per-partner rate limiting | ✅ |
| 8 | Idle-online location refresh | ✅ Heartbeat upserts `Location` when coords sent |

---

## Phase 1A Violation Matrix (Forensic Rescan)

| Token / Pattern | Domain | Risk | Disposition |
|-----------------|--------|------|-------------|
| `KYC_PENDING`, `VERIFICATION`, `APPROVED` | Lead/onboarding aliases | Mapped to lifecycle `APPLIED` on read; rejected as lifecycle write targets | ✅ `partner-lifecycle-fsm` + orthogonality negatives |
| `SUSPENDED` | Lifecycle only | Must not appear as availability | ✅ `partner-four-axis.test.ts`; availability has no SUSPENDED |
| `ACCEPTING_JOB` | Non-canonical | Not in availability FSM | ✅ Rejected via `assertBelongsToAxis` |
| `EARNINGS_POSTED` | Job axis contamination | Job must stay `COMPLETED` | ✅ `section03-job-action-policy`, orthogonality |
| `dispatchEligible` | Server-derived only | Client must not supply | ✅ `partner-lifecycle.service` read projection only |
| `isOnline` vs presence freshness | Conflated concepts | Different gates | ✅ Documented; `isOperationallyLive` = both read-only |
| `provider:{id}:online` Redis | Legacy job ping TTL | Parallel to presence namespace | ✅ Both refreshed on heartbeat for ops-map compat |
| Presence heartbeat | Fifth FSM risk | Must not write lifecycle/job/money | ✅ Integration tests + code audit — no writes |

**No active cross-axis write path found in `partner-presence.service.ts`.**

---

## Recommended Integration Points

| Consumer | Integration |
|----------|-------------|
| `partner-operations.service.ts` | Availability remains authoritative; presence does not flip `isOnline` |
| `tracking.service.ts` | Job tracking unchanged; legacy Redis key refreshed on presence heartbeat for ops-map compat |
| `matching.service.ts` | Phase 2: consume presence location freshness |
| `ops-map.service.ts` | Reads Redis liveness (existing + new namespace) |
| `partner-intelligence.service.ts` | Align freshness thresholds with presence config |
| Auth login/refresh | Promote `activeSessionId` on new session |

---

## Risk Areas

1. **Supply undercount** — `demand-supply-warning.service.ts` documents gap: many `isOnline` partners lack fresh `Location`.
2. **False offline alerts** — Ops map flags assigned providers without Redis presence; idle-online never set keys.
3. **Axis contamination** — Presence failure must never set `lifecycleState = SUSPENDED` or mutate job/money.
4. **Redis optional** — Must work with in-memory fallback (single-instance dev).
5. **Homonym states** — Four-axis orthogonality tests must stay green.

---

## Reusable Modules (Build On — Do Not Rewrite)

```
partner-four-axis.ts
partner-availability-fsm.ts
partner-operations.service.ts
tracking.service.ts          (job axis only)
redis.ts
auth.plugin.ts
refresh-token.service.ts
audit-log.service.ts
consumeRateLimitSmart        (rate-limit.middleware.ts)
```

---

## Phase 1 Implementation Surface

```
NEW  partner-presence.config.ts       — configurable TTL thresholds
NEW  partner-presence-freshness.ts  — isPresenceFresh / isLocationFresh / isOperationallyLive
NEW  partner-presence-location.ts   — coordinate + timestamp validation
NEW  partner-presence.service.ts    — heartbeat, session, Redis, Postgres
NEW  PartnerPresence (Prisma)       — durable snapshot
NEW  POST /api/providers/me/presence/heartbeat
NEW  GET  /api/providers/me/presence
HOOK refresh-token.service.ts       — sessionId + promoteSession on login/refresh
```
