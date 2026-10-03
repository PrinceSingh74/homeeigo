# HOMEEIGO Partner Presence + Dispatch — Final Certification (Phase 3 Closure Loop)

**Certification subject (revision lock):**

| Field | Value |
|-------|-------|
| `git rev-parse HEAD` | `104a3f77402eb3ad541a56336dcc61b04d04ce63` |
| Working tree | Dirty — Phase 3 bypass closure in `booking.service.ts`, `admin-booking-operations.service.ts`, `dispatch-eligibility.service.ts`, `assignment-engine.service.ts`, `partner-presence.service.ts`, `routes/admin.ts`, tests, docs |
| Phase 3 code delta (committed paths) | `booking.service.ts` +17, `admin-booking-operations.service.ts` +59 |
| Migration | `prisma/migrations/20260907120000_partner_presence_foundation/migration.sql` |
| Test config | `NODE_ENV=test`, `.env.test`, `homigo_test` DB (local Windows host) |
| Prisma client | 6.19.3 |

**Certification labels (unchanged — do not inflate):**

| Label | Status |
|-------|--------|
| **IMPLEMENTATION ALIGNED** | **YES** |
| **PRODUCT-SURFACE PROVEN** | **PARTIAL** |
| **FOUR-AXIS CERTIFIED** | **NO** |

---

## A. Implementation Alignment

Authoritative dispatch safety formula enforced on all audited assignment paths:

```
ACTIVE + AVAILABLE + PRESENCE FRESH + LOCATION FRESH + gates
→ FINAL REVALIDATION (assertOfferEligible) → LOCK → OFFER / ASSIGN
```

| Path | Gate | Status |
|------|------|--------|
| Matching → assignment engine | `assertOfferEligible` before `assignmentAttempt.create` | **ALIGNED** |
| Direct booking + `providerId` | `assertOfferEligible` inside booking tx | **CLOSED (Phase 3)** |
| Admin reassign | `assertOfferEligible` inside tx + governed override | **CLOSED (Phase 3)** |
| Admin force dispatch / repair dispatch branch | Routes through assignment engine | **ALIGNED** |
| Partner accept | `assertAcceptEligible` | **ALIGNED** |

Forensic inventory: [`docs/DISPATCH_BYPASS_FORENSIC.md`](./DISPATCH_BYPASS_FORENSIC.md)

No client-supplied `dispatchEligible` trusted. Server derives eligibility only (`dispatch-eligibility.service.ts`).

---

## B. Presence Foundation (Phase 1)

| Suite | Historical | This closure loop |
|-------|------------|-------------------|
| `partner-presence.unit.test.ts` (8) | 8/8 PASS | **NOT RE-RUN** — Bun 1.3.14 segfault / silent exit on Windows when run in isolation |
| `partner-presence.integration.test.ts` (14) | 14/14 PASS | **NOT RE-RUN** — same toolchain instability |
| Docker CI (`homigo-ci-pg`) | — | **BLOCKED** — `partner_presence` table missing (migration not applied to CI test DB); 20 integration failures |

**Pure unit evaluation (no DB):** 8 tests exist; Docker run confirmed pure evaluation paths pass when file loads.

**Action required before FOUR-AXIS CERTIFIED:** Apply `20260907120000_partner_presence_foundation` to CI/staging test DB; re-run 8/8 + 14/14 on locked revision.

---

## C. Dispatch Eligibility (Phase 2)

| Suite | Expected | Evidence |
|-------|----------|----------|
| `dispatch-eligibility.test.ts` | 13/13 | **13/13 PASS** — prior closure-loop run 2026-09-07 10:24 UTC; **BLOCKED** on immediate re-run (Bun silent crash after Phase 3 suite) |

Command (when toolchain stable):

```bash
cd apps/backend && NODE_ENV=test bun test --max-concurrency 1 src/__tests__/dispatch-eligibility.test.ts
```

---

## D. Bypass Closure (Phase 3)

### Targeted suite — historical (preserved)

| Run | Result | Scope |
|-----|--------|-------|
| 2026-09-07 session 1 | **19/19 PASS** | Phase 2 (13) + Phase 3 original (6) |

### Targeted suite — current (expanded)

| Run | Result | Scope |
|-----|--------|-------|
| 2026-09-07 10:27 UTC | **8/8 PASS** | `phase3-dispatch-bypass-closure.test.ts` |
| Combined with Phase 2 | **21/21** when both run green | 13 + 8 (2 new security tests added) |

**Phase 3 bypass tests (8):**

1. Direct booking rejects `STALE_PRESENCE` → `PROVIDER_UNAVAILABLE`
2. Direct booking allowed when fresh + eligible
3. Admin reassign rejects `SUSPENDED`
4. Admin reassign rejects stale without override
5. Admin reassign succeeds when eligible
6. Emergency override with full `DISPATCH_ELIGIBILITY_OVERRIDE` audit
7. **NEW:** Override rejected when `emergencyOverride.adminId` ≠ acting admin
8. **NEW:** Override does **not** bypass `SUSPENDED` lifecycle

Metrics wired: `direct_assignment_rejections{reason}`, `admin_reassignment_rejections{reason}`, `final_revalidation_failures{reason}`.

---

## E. Emergency Override Governance

| Control | Status |
|---------|--------|
| Explicit request body only (`POST /admin/bookings/:id/reassign`) | **YES** |
| Admin route auth required | **YES** (existing admin auth) |
| Bypass scope limited to presence/location codes | **YES** — `isPresenceLocationOnlyBlock()` |
| Audit event `DISPATCH_ELIGIBILITY_OVERRIDE` | **YES** — verified in test |
| Tampered actor rejected | **YES** — test 7 |
| Lifecycle not bypassable | **YES** — test 8 |
| Hidden endpoint setting override without auth | **NONE FOUND** |

Override does **not** bypass: lifecycle, capacity, skill, risk, payment, ownership.

---

## F. Load / Scale

| Requirement | Status |
|-------------|--------|
| 100 / 500 / 1000 partner heartbeat load | **NOT RUN** |
| Dispatch load 10/50/100/500 | **NOT RUN** |
| k6 / staging server | **NOT AVAILABLE** — `k6` not on PATH; `run-load-suite.ts` requires `LOAD_TEST_MODE=1` backend on `:3000` |

**Scale design review (code, not load-proven):**

- `PartnerPresence` is snapshot upsert — no per-heartbeat history table
- Location on heartbeat updates `Location` row + optional dedupe — separate from job `LocationHistory`
- Eligibility events deduped (Redis + memory) — not per heartbeat
- Redis presence keys TTL-bounded

---

## G. Security

| Suite | Status |
|-------|--------|
| Full security regression | **NOT RUN** |
| Phase 3 override security (tests 7–8) | **PASS** |
| `dispatchEligible` client trust | **NONE** — server-only |
| Admin reassign without auth | Route-level admin auth (not re-pen-tested this loop) |

---

## H. Concurrency

| Suite | Status |
|-------|--------|
| `assignment-dispatch-lock.test.ts` | **8/8 PASS** — earlier this loop (duplicate offer P2002, broadcast, distributed lock) |
| Re-run after Phase 3 | **BLOCKED** — Bun silent crash |
| Same-partner race during stale transition | **NOT RUN** (dedicated scenario) |

---

## I. Correlated E2E

| Suite | Status |
|-------|--------|
| `customer-partner-admin-correlated-e2e.test.ts` | **FAIL** (pre-fix) — matching excluded partner without fresh presence; **FIX APPLIED** (presence seed in `beforeAll`) — **NOT RE-RUN** (Bun crash) |
| Stale partner scenario (3K) | Covered by Phase 2/3 integration tests |
| Stale location scenario (3L) | Covered by Phase 2 pure + integration |

---

## J. Partner Web

**NOT RUN** — no Partner Web regression executed this loop. Backend remains authoritative.

---

## K. Admin

| Item | Status |
|------|--------|
| Reassign API + `emergencyOverride` body | **IMPLEMENTED** |
| Admin regression suite | **NOT RUN** |
| Eligibility display in admin UI | **NOT VERIFIED** this loop |

---

## L. Mobile

| Item | Status |
|------|--------|
| Mobile API regression | **NOT RUN** |
| Native mobile (`adb`/emulator/device) | **NOT RUN — ENVIRONMENT LIMITATION** |
| Mobile source uses heartbeat/session/location | **YES** (Phase 1 implementation — not re-certified this loop) |

---

## M. Four-Axis Proof

| Gate | Status |
|------|--------|
| 51/51 FSM | **NOT RUN** this loop |
| 12/12 orthogonality (`partner-four-axis-orthogonality.test.ts`) | **NOT RUN** — presence seed fix applied; prior run failed at accept without presence |
| MONEY_DRIFT = 0 | **NOT RUN** this loop |
| Stale presence ≠ SUSPENDED / job / money | **PROVEN** in Phase 2 integration test (historical + code path) |
| Job ≠ EARNINGS_POSTED | **ARCHITECTURE LOCK** — unchanged |

---

## N. Observability

| Metric | Status |
|--------|--------|
| `dispatch_eligibility_pass_total` | Seeded |
| `dispatch_eligibility_reject_total{reason}` | Seeded (bounded reason enum) |
| `final_revalidation_failures{reason}` | Added |
| `direct_assignment_rejections{reason}` | Added |
| `admin_reassignment_rejections{reason}` | Added |
| Unbounded label values | **NONE** — block codes from fixed enum |

---

## O. Toolchain / Environment Limitations

1. **Bun 1.3.14 on Windows x64** — intermittent segfault / silent test-runner exit; suites pass when runner completes but re-run order affects stability.
2. **Docker CI Postgres** (`homigo-ci-pg`) — missing `partner_presence` migration; blocks containerized full revalidation.
3. **k6 / staging load** — not configured on this host.
4. **Native mobile** — no device farm / adb.

**Local test DB note:** Windows host `homigo_test` has `partner_presence` table (Phase 3 tests pass). CI Docker DB does not.

---

## P. Final Certification Decision

### FOUR-AXIS CERTIFIED gate checklist

| Gate | Status |
|------|--------|
| Phase 1 tests rerun and green | **NO** — blocked (toolchain + CI migration) |
| Phase 2 13/13 green | **YES** (prior run; re-run blocked) |
| Phase 3 targeted green | **YES** — 8/8 bypass + historical 19/19 preserved |
| All direct assignment paths audited | **YES** — see forensic doc |
| Direct `providerId` protected | **YES** |
| Admin reassign protected | **YES** |
| Emergency override governed | **YES** — including new security tests |
| Load 100/500/1000 | **NO** |
| Concurrency green | **PARTIAL** — 8/8 lock tests earlier; full race matrix not run |
| Security green | **PARTIAL** — override only |
| Full backend regression | **NO** |
| Partner Web / Admin regression | **NO** |
| Correlated E2E green | **NO** — fix pending re-run |
| 51/51 FSM / 12/12 orthogonality / MONEY_DRIFT | **NO** |
| Global four-axis scan clean | **YES** (assignment paths); full repo scan not exhaustive |
| Native mobile | **NOT RUN** |
| No P0/P1 | **UNKNOWN** — full regression not run |

### Decision

**DO NOT CERTIFY** for production four-axis release.

Maintain:

- **IMPLEMENTATION ALIGNED = YES**
- **PRODUCT-SURFACE PROVEN = PARTIAL**
- **FOUR-AXIS CERTIFIED = NO**

### Next actions (ordered)

1. Apply `20260907120000_partner_presence_foundation` to `homigo-ci-pg` / staging test DB.
2. Re-run Phase 1 (8+14) + Phase 2 (13) + Phase 3 (8) in Linux CI or Docker after migration.
3. Re-run `customer-partner-admin-correlated-e2e.test.ts` and `partner-four-axis-orthogonality.test.ts` with presence seed.
4. Execute load suite on staging with k6 + `run-load-suite.ts`.
5. Run full backend / security / Partner Web / Admin regression on locked revision.
6. Record native mobile status or obtain device evidence.

---

## Reproducibility commands

```bash
# Targeted Phase 3 (local homigo_test with partner_presence table)
cd apps/backend
NODE_ENV=test bun test --max-concurrency 1 src/__tests__/phase3-dispatch-bypass-closure.test.ts

# Full targeted Phase 2+3 (when Bun stable)
NODE_ENV=test bun test --max-concurrency 1 \
  src/__tests__/dispatch-eligibility.test.ts \
  src/__tests__/phase3-dispatch-bypass-closure.test.ts

# Concurrency lock proof
NODE_ENV=test bun test --max-concurrency 1 src/__tests__/assignment-dispatch-lock.test.ts

# Docker (after migration applied to homigo-ci-pg)
docker run --rm --network homigo-cert4 -v "$(pwd)/apps/backend:/app" -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1 src/__tests__/dispatch-eligibility.test.ts
```
