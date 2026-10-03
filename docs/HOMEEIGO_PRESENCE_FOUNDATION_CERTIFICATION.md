# HOMEEIGO Presence Foundation — Phase 1 Forensic Certification

**Date:** 2026-09-07  
**Revision:** `104a3f77402eb3ad541a56336dcc61b04d04ce63`  
**Runtime:** Linux Docker `oven/bun:1.3` (authoritative); Windows Bun 1.3.14 unstable for isolated runs  
**Database:** `homigo-ci-pg` / `homigo_test` / `connection_limit=8`  
**Migration:** `20260907120000_partner_presence_foundation` (applied to CI DB this loop)

---

## Certification Labels

| Label | Status |
|-------|--------|
| **PHASE 1 IMPLEMENTATION** | **ALIGNED** |
| **PHASE 1 PROOF** | **GREEN** (Docker Linux, migrated DB) |
| **FOUR-AXIS CERTIFIED** | **NO** — full product surface (load, mobile native, full backend) not in Phase 1 scope |

---

## Required Evidence (Phase 1I)

| Suite | Expected | Result | Command |
|-------|----------|--------|---------|
| Presence unit | 8/8 | **8 PASS / 0 FAIL** | See bundle below |
| Presence integration | 14/14 | **14 PASS / 0 FAIL** | See bundle below |
| FSM bundle | 51/51 | **51 PASS / 0 FAIL** | See FSM command |
| Four-axis orthogonality | 12/12 | **12 PASS / 0 FAIL** | See orthogonality command |
| MONEY_DRIFT | 0 | **0** | Orthogonality JSON output |
| Negative transition tests | PASS | **PASS** | Orthogonality `product-surface negatives` |
| Security (presence) | PASS | **PASS** | Integration: session, device, rate limit, audit |
| Load baseline | — | **NOT RUN** | No staging/k6 on this host |

### Authoritative Docker commands (2026-09-07)

**Phase 1 presence + FSM (63 tests in first bundle):**

```bash
docker run --rm --network homigo-cert4 \
  -v "$(pwd)/apps/backend:/app" -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1 \
  src/__tests__/partner-presence.unit.test.ts \
  src/__tests__/partner-presence.integration.test.ts \
  src/__tests__/partner-four-axis.test.ts \
  src/__tests__/partner-lifecycle-fsm.test.ts \
  src/__tests__/partner-availability-fsm.test.ts \
  src/__tests__/partner-job-fsm.test.ts \
  src/__tests__/partner-finance-fsm.test.ts
```

**Result:** 63 pass / 0 fail / 206 expects / 8.26s

**Canonical 51 FSM:**

```bash
docker run --rm --network homigo-cert4 \
  -v "$(pwd)/apps/backend:/app" -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1 \
  src/__tests__/partner-four-axis.test.ts \
  src/__tests__/partner-lifecycle-fsm.test.ts \
  src/__tests__/partner-availability-fsm.test.ts \
  src/__tests__/partner-job-fsm.test.ts \
  src/__tests__/partner-finance-fsm.test.ts \
  src/__tests__/section03-job-action-policy.test.ts \
  src/__tests__/partner-career-policy.test.ts
```

**Result:** 51 pass / 0 fail / 1.51s

**Four-axis orthogonality + MONEY_DRIFT:**

```bash
docker run --rm --network homigo-cert4 \
  -v "$(pwd)/apps/backend:/app" -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1 \
  src/__tests__/partner-four-axis-orthogonality.test.ts \
  src/__tests__/section03-job-action-policy.test.ts
```

**Result:** 17 pass / 0 fail / 180 expects / 11.74s  
**Orthogonality:** 12/12  
**MONEY_DRIFT:** 0 (`RUN_ID: p13ax-mtr3ppd9`)

---

## Phase 1B — Database Orthogonality

| Check | Status | Evidence |
|-------|--------|----------|
| `PartnerPresence` 1 row per provider (upsert) | ✅ | Integration heartbeat test |
| No heartbeat row explosion | ✅ | Upsert only; duplicate location idempotent |
| Stale session cannot overwrite active | ✅ | Session B promotion rejects session A |
| Wrong partner rejected | ✅ | Integration test |
| Device mismatch rejected | ✅ | Audit `DEVICE_MISMATCH` |
| Invalid coords / timestamps rejected | ✅ | Unit + integration |
| Presence never writes lifecycle | ✅ | Integration axis non-contamination |
| ACTIVE + stale presence ≠ SUSPENDED | ✅ | No code path in presence service |
| Job COMPLETED ≠ EARNINGS_POSTED | ✅ | Orthogonality + section03 |

**Schema:** `PartnerPresence` fields match baseline (`providerId` unique, session, device, heartbeat, location snapshot, app metadata).

---

## Phase 1C — Session Security

Order enforced in `partner-presence.service.ts`:

```
Auth (route) → Partner ownership → Session → Device → Timestamp → Rate limit → Write → Audit/metrics
```

| Control | Status |
|---------|--------|
| Login/refresh promotes `activeSessionId` | ✅ |
| Stale session heartbeat rejected | ✅ `STALE_SESSION` |
| Invalid session rejected | ✅ |
| Rate limit per partner | ✅ |
| Security audit on device mismatch | ✅ |

---

## Phase 1D — Freshness Engine

| Function | Boundaries tested |
|----------|-------------------|
| `derivePresenceFreshness` | FRESH / STALE / EXPIRED |
| `deriveLocationFreshness` | FRESH / EXPIRED |
| `isOperationallyLive` | Requires `isOnline` + non-expired heartbeat |

**Fail-closed:** null heartbeat → EXPIRED; null location → not fresh.

**Not conflated:** `isOnline` (availability) ≠ presence freshness ≠ dispatch eligibility.

---

## Phase 1E — API Contract

| Route | Status |
|-------|--------|
| `POST /api/providers/me/presence/heartbeat` | ✅ Auth, validation, idempotent duplicate location |
| `GET /api/providers/me/presence` | ✅ Read-only snapshot |

Response uses `presenceFreshness` / `locationFreshness` / `operationallyLive` — **no merged axis status**.

---

## Phase 1F — Client Contract

| Client | Methods | Status |
|--------|---------|--------|
| Partner Web | `presenceSnapshot()`, `presenceHeartbeat()` | ✅ API stubs in `partner-api.ts` |
| Partner Mobile | Same | ✅ API stubs in `homigo-partner-mobile` |

Native UI proof: **NOT RUN — ENVIRONMENT LIMITATION**

---

## Phase 1G — Four-Axis Negative Testing

Proven in orthogonality suite:

- Lifecycle rejects: `KYC_PENDING`, `VERIFICATION`, `APPROVED`, `COMPLETED`, `EARNINGS_POSTED`, `AVAILABLE`
- `APPLIED + isApproved` not dispatch-eligible
- `Availability.SUSPENDED` does not exist in canonical availability vocab
- Job never `EARNINGS_POSTED`

---

## Infrastructure Remediation (This Loop)

| Issue | Root cause | Fix |
|-------|------------|-----|
| Docker CI integration failures | `partner_presence` table missing on `homigo-ci-pg` | Applied migration SQL; added to `setup-test-db.ts` `LATE_ADDITIVE` |
| Windows Bun segfault | Toolchain bug 1.3.14 | Run proof in Docker Linux; record BLOCKED on Windows isolated runs |
| Correlated/orthogonality matching | Tests lacked presence seed post-Phase-2 | Added `PartnerPresence` upsert in `beforeAll` |

---

## Open Gates (Phase 1)

1. **Load baseline** — NOT RUN (no k6/staging)
2. **Native mobile heartbeat proof** — NOT RUN
3. **Full backend regression** — NOT RUN (Phase 1 targeted proof only)
4. **Windows-local Bun** — BLOCKED for reliable isolated test execution

---

## Sign-Off

Phase 1 **implementation and targeted proof** are **GREEN** on Linux Docker with migrated `homigo_test`.

Phase 1 is **not** full product certification — load and native mobile remain open.

**Certified by:** Phase 1 Forensic Closure Loop — 2026-09-07
