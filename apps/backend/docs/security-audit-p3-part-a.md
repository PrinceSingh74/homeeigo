# HOMIGO P3 Enterprise Hardening — Part A Security Audit (Phases 1–2)

**Date:** 2026-06-09  
**Scope:** Backend API (`apps/backend`), admin panel surface, auth, wallet, payments, WebSockets  
**Status:** Phase 1 documented; Phase 2 RBAC implemented

---

## Executive Summary

The HOMIGO backend has a solid foundation: JWT auth, role-based route guards (`UserRole.ADMIN`), structured audit logging via `ActivityLog`, and financial transaction logging. However, a principal-level review identified **10 high-impact gaps** where a single compromised admin credential or stolen token could cause disproportionate harm.

Phase 2 addresses **Vulnerability 1** (no fine-grained admin RBAC). Remaining items are scheduled for Part B.

---

## Existing Security Controls (Baseline)

| Area | Implementation | Location |
|------|----------------|----------|
| Authentication | JWT access + refresh tokens | `jwt.service.ts`, `auth.ts` |
| Admin gate | `requireRole("ADMIN")` on `/api/admin/*` | `admin.ts`, `auth.plugin.ts` |
| Audit trail | `AuditLogService` → `activity_logs` | `audit-log.service.ts` |
| Rate limiting | Global API rate limits | `api-rate-limit.middleware.ts` |
| Security headers | Applied on every response | `security.middleware.ts` |
| Financial atomicity | Ledger + idempotent webhooks | `financial-ledger.service.ts` |

---

## Attack Surface & Vulnerability Register

### V1 — No Fine-Grained Admin RBAC ✅ MITIGATED (Phase 2)

| Field | Detail |
|-------|--------|
| **Current** | Single `UserRole.ADMIN` grants full `/api/admin` access |
| **Risk** | Admin compromise = full system access; no separation of duties |
| **Attack** | Privilege escalation, lateral movement across finance/ops |
| **Mitigation** | 6-tier `AdminRoleType` + `AdminPermission` matrix; route-level enforcement |

### V2 — No Token Revocation ✅ MITIGATED (Part B, Phase 3)

| Field | Detail |
|-------|--------|
| **Current** | JWT valid until `exp`; logout clears refresh token only |
| **Risk** | Stolen access token usable until expiry |
| **Mitigation** | Token blacklist (Redis) on logout / password change / admin force-logout |

### V3 — No Refresh Token Family Tracking ✅ MITIGATED (Part B, Phase 4)

| Field | Detail |
|-------|--------|
| **Current** | Refresh tokens stored independently |
| **Risk** | Reuse of rotated refresh token undetected |
| **Mitigation** | Token family ID + reuse detection → revoke family |

### V4 — WebSocket Token Expiry Not Re-Validated ✅ MITIGATED (Part B, Phase 5)

| Field | Detail |
|-------|--------|
| **Current** | WS auth at connection time only |
| **Risk** | Expired token may continue streaming until disconnect |
| **Mitigation** | Periodic JWT re-validation + connection teardown |

### V5 — WebSocket Channel Authorization Gaps ✅ MITIGATED (Part B, Phase 6)

| Field | Detail |
|-------|--------|
| **Current** | JWT proves identity; channel membership not always role-scoped |
| **Risk** | Cross-role data exposure (e.g. earnings vs notifications) |
| **Mitigation** | Per-channel role + resource ownership checks |

### V6 — Gift Card Brute Force ⏳ Part B (Phase 7)

| Field | Detail |
|-------|--------|
| **Current** | Redemption endpoints lack dedicated brute-force limits |
| **Risk** | Gift card code enumeration |
| **Mitigation** | Per-IP + per-user rate limits, lockout after N failures |

### V7 — Campaign Redemption Abuse ⏳ Part B (Phase 8)

| Field | Detail |
|-------|--------|
| **Current** | Redemption limits depend on campaign rules enforcement |
| **Risk** | Unlimited discount exploitation |
| **Mitigation** | Per-user redemption caps + idempotent redemption keys |

### V8 — Backup Restore Not Verified ⏳ Part B (Phase 9)

| Field | Detail |
|-------|--------|
| **Current** | `backup-db.ts` creates dumps; no automated restore drill |
| **Risk** | RTO unknown; restore may fail in incident |
| **Mitigation** | Scheduled restore validation to isolated DB |

### V9 — Backup Automation Gaps ⏳ Part B (Phase 10)

| Field | Detail |
|-------|--------|
| **Current** | Manual / ad-hoc backups |
| **Risk** | Data loss window between backups |
| **Mitigation** | Hourly automated backups + retention policy |

### V10 — Audit Logs Not Tamper-Protected ⏳ Part B (Phase 11)

| Field | Detail |
|-------|--------|
| **Current** | `activity_logs` is a standard mutable table |
| **Risk** | Insider can alter/delete audit evidence |
| **Mitigation** | Append-only table, hash chain, or WORM storage |

---

## Phase 2 Implementation Summary

### Data Model

- `AdminRole` — 6 role types (`SUPER_ADMIN` … `ANALYTICS_ADMIN`)
- `AdminPermission` — `(resource, action)` tuples per role
- `AdminUser` — links `User` to scoped role with grant/revoke audit fields

### Services & Middleware

- `rbac.service.ts` — permission checks, grant/revoke, bootstrap
- `admin-rbac.ts` — Elysia plugin; enforces permissions on every `/api/admin` route
- `admin-route-permissions.ts` — declarative route → permission map

### Backward Compatibility

- Existing `User.role === ADMIN` without `AdminUser` row: **full access** (legacy super-admin)
- On boot: `rbacService.bootstrap()` seeds roles and promotes legacy admins to `SUPER_ADMIN`

### New Admin API Endpoints

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/admin/rbac/me` | `ADMIN_USERS.READ` |
| GET | `/api/admin/rbac/roles` | `ADMIN_USERS.READ` |
| GET | `/api/admin/rbac/admins` | `ADMIN_USERS.READ` |
| POST | `/api/admin/rbac/grant-role` | `ADMIN_USERS.CREATE` |
| POST | `/api/admin/rbac/revoke-role` | `ADMIN_USERS.DELETE` |

### Audit Events Added

`ADMIN_ACCESS_DENIED`, `ADMIN_PERMISSION_GRANTED`, `ADMIN_PERMISSION_REVOKED`, `ADMIN_ACTION`

---

## Verification Checklist

- [ ] Run migration: `bun run db:migrate` (or `prisma migrate deploy`)
- [ ] Confirm roles seeded on server start
- [ ] Login as `admin@homigo.demo` — full access retained
- [ ] Create `FINANCE_ADMIN` user — verify finance routes only
- [ ] Attempt `/api/admin/users` as finance admin — expect 403 + audit log
- [ ] Grant/revoke role as super admin — verify `activity_logs` entries

---

## Part B Implementation Summary (Phases 3–6)

### Phase 3 — Access Token Revocation
- `TokenBlacklist` + `UserAuthEpoch` models
- `token-revocation.service.ts` — per-`jti` blacklist + epoch bump for mass invalidation
- `auth.plugin.ts` + logout/password-reset wired to revoke tokens
- Hourly cleanup via `maintenance.ts`

### Phase 4 — Refresh Token Family
- `RefreshToken.familyId`, `parentTokenId`, `revokedReason`, `createdBy`
- `refresh-token-family.service.ts` — reuse-attack detection invalidates entire family
- Rotation on every `/api/auth/refresh`

### Phase 5 — WebSocket Token Hardening
- `lib/ws-connection-auth.ts` — exp + revocation + optional nonce + DB role lookup
- All `/ws/*` handlers updated

### Phase 6 — WebSocket Role Validation
- `lib/ws-channel-access.ts` — per-channel role/ownership checks
- Audit: `WEBSOCKET_CONNECTED`, `WEBSOCKET_UNAUTHORIZED`, `REVOKED_TOKEN_USED`

### New Admin Endpoint
- `POST /api/admin/users/:id/force-logout` — requires `USERS.FORCE_LOGOUT`

---

## Part C Implementation Summary (Phases 7–10)

### Phase 7 — Gift Card Brute Force Protection
- `GiftCardRedemptionAttempt` model + IP/user/device throttling
- `gift-card-protection.service.ts` — 5 attempts / 15 min, progressive lockout
- `/api/giftcards/redeem` returns `429 RATE_LIMITED` when blocked

### Phase 8 — Campaign Redemption Limits
- `maxRedemptionsPerUser` on `Campaign` (default 1)
- `campaign-limits.service.ts` — per-user caps via existing `CouponUsage`
- `campaign.service.validateForUser` + `recordRedemption` enforce limits

### Phase 9 — Restore Script
- `scripts/restore-postgres.ts` — checksum verify, safety backup, pg_restore, row-count validation
- `scripts/restore-postgres.sh` wrapper (`RESTORE_CONFIRM=yes` required)

### Phase 10 — Hourly Backups
- `backup-db.ts` — SHA256 sidecar, 30-day retention default
- Maintenance scheduler: hourly when `ENABLE_SCHEDULED_BACKUPS=true`
- `scripts/backup-postgres.sh`, `scripts/cleanup-backups.sh` for cron

### Tests
- `src/__tests__/p3-security.test.ts` — unit tests for lockout math, RBAC routes, WS roles

---

## Remaining (Future)

Append-only audit log hardening (tamper-evident `activity_logs`).
