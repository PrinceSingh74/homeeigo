# HOMEEIGO Partner Presence + Four-Axis Dispatch
## Final Forensic Certification Loop — 2026-09-07

**FINAL DECISION:** `PARTIAL — IMPLEMENTATION COMPLETE, POLICY/ENVIRONMENT EVIDENCE REMAINS`

Master forensic closure (2026-09-07 evening) closed staging runtime, production Partner Web timer, Admin HQ production roster, customer API supply-truth, Redis-down chaos, and dedicated presence load 100/500/1000. It did **not** certify: native mobile, GitHub Actions CI, full backend (2034 pass / 36 fail), or customer production browser. No waiver exists.

Presence remains liveness evidence, not a fifth FSM. Stale presence fails closed on dispatch and does not mutate Partner / Availability / Job / Finance.

This loop does **not** convert `NOT RUN`, `BLOCKED`, or `SKIPPED` into `PASS`.

---

## A. EXACT REVISION

| Field | Value |
|---|---|
| HEAD | `104a3f77402eb3ad541a56336dcc61b04d04ce63` |
| Branch | `cursor/stage-e-step-13-certification` |
| Dirty tree | **YES** — do not reset. Snapshot at freeze: ~370 modified, 1 deleted, ~804 untracked. Presence/dispatch work is in the working tree, not this HEAD commit. |
| Backend runtime | `http://127.0.0.1:3000` — health `database=ok`, `redis=ok`, env `dev` |
| Test runner | Linux Docker `oven/bun:1.3` on network `homigo-cert4` / DB `homigo-ci-pg` / `homigo_test` |
| Windows Bun | **NOT** used as authority (historical segfaults) |

### Schema / migrations

Canonical model: `PartnerPresence` (`lastHeartbeatAt`, `lastLocationAt`, `lastLocationReceivedAt`, session/device, coords, sequence). Freshness `FRESH / STALE / EXPIRED` is derived, never stored.

| Database | `partner_presence` | `last_location_received_at` |
|---|---|---|
| `homigo_db` (local `homigo-postgres`) | **present** | **present** |
| `homigo_test` (local `homigo-postgres`) | **present** | **present** |
| `homigo_test` (`homigo-ci-pg`) | **present** | **present** |
| `homigo_staging_db` (`homigo-staging-postgres`) | **present** (`prisma migrate deploy` this loop) | **present** |

Migrations in tree:

- `prisma/migrations/20260907120000_partner_presence_foundation/migration.sql`
- `prisma/migrations/20260907170000_partner_presence_received_at/migration.sql`

Staging migrations applied this loop: `20260907120000_partner_presence_foundation` + `20260907170000_partner_presence_received_at`. Staging API on :3010 was not running — schema PASS, staging runtime **NOT RUN**.

---

## B. P0 BREAKAGE

### Original root cause

Backend matching / `assertOfferEligible` fail closed when there is no heartbeat evidence.

Neither Partner Mobile nor Partner Web published `POST /api/providers/me/presence/heartbeat`.

Therefore: **ACTIVE + AVAILABLE → zero heartbeat → zero presence → zero offers.**

### Exact fix (implementation)

| Surface | Publisher |
|---|---|
| Partner Mobile | `homigo-partner-mobile/src/hooks/use-partner-presence-heartbeat.ts` mounted in `app/_layout.tsx` |
| Partner Web | `apps/partner-web/src/hooks/use-partner-presence-heartbeat.ts` singleton runtime + `PartnerPresenceHeartbeat` in `src/app/layout.tsx` |

Cadence (both clients, source-inspected):

| Availability | Heartbeat | Location |
|---|---|---|
| OFFLINE | none | none |
| AVAILABLE | 25s | every 3rd beat |
| OFFERED / ACCEPTING / EN_ROUTE / ON_JOB | 25s | every beat |
| PAUSED | 25s | none |
| Hidden / background | ~2× interval | per plan |
| GPS denied | heartbeat continues | location omitted |

Copy (never raw `STALE` / `EXPIRED` / `SUSPENDED`):

- healthy: `You're visible for new jobs`
- reconnecting: `Connection lost — reconnecting…`
- long stale: `You're currently not receiving new jobs`

### Client-shaped HTTP proof (live API)

Command: `bun --env-file=.env run scripts/presence-p0-forensic-proof.ts`

Provider: `cmtr5h6wu0027tzb0l3yclwdn` (JWT minted via `RefreshTokenService`; password login **BLOCKED** — PII-encrypted emails).

| Gate | Status | Evidence |
|---|---|---|
| `POST .../presence/heartbeat` HTTP 200 accepted | **PASS** | `lastHeartbeatAt=2026-09-07T11:50:29.431Z` |
| Postgres write | **PASS** | row updated |
| `capturedAt` ≠ `receivedAt` | **PASS** | lag **2081 ms** |
| Redis key `partner:presence:{id}` | **PASS** | JSON payload after accepted beat |
| Independent `redis-cli` GET + TTL | **PASS** | TTL **66** (config 90s) |
| `GET .../dispatch-eligibility` | **PASS** | `eligible=true`, `blockedBy=null` |
| Backdate heartbeat only | **PASS** | `eligible=false`, `STALE_PRESENCE` only (location still fresh) |
| Lifecycle | **PASS** | `ACTIVE → ACTIVE` |
| Availability not rewritten to SUSPENDED | **PASS** | `isOnline=true`, `pausedAt=null` |
| Jobs untouched | **PASS** | `0 → 0` |
| Finance untouched | **PASS** | earnings `0 → 0` |
| Session B replaces A | **PASS** | A → `STALE_SESSION` |
| Session B heartbeat | **PASS** | HTTP 200 |
| Password login | **BLOCKED** | HTTP 401 Invalid email or password |

**P0 closure as an HTTP chain is proven.**

**CLIENT TIMER → HTTP** from a real Partner Mobile / Partner Web process: **NOT RUN** (no native device; demo password login blocked). Source timers exist; that is not the required live timer proof.

---

## C. PRESENCE

| Topic | Status | Notes |
|---|---|---|
| Heartbeat API | **PASS** | `POST /api/providers/me/presence/heartbeat` |
| Snapshot | **PASS** | `GET /api/providers/me/presence` returns `sessionId`, interval 25 |
| Location ping | **PASS** | `POST /api/providers/me/location/ping` does **not** advance `lastHeartbeatAt` |
| Device bind | **PASS** | `DEVICE_MISMATCH` 403 |
| Future timestamp | **PASS** | `TIMESTAMP_FUTURE` 400 |
| Old timestamp | **PASS** | rejected |
| Impossible jump | **PASS** | Mumbai vs Delhi → `IMPOSSIBLE_JUMP` |
| Sequence regression | **PASS** | unit + live (prior forensic run) |
| Duplicate location | **PASS** | integration: accepted, no Location write amplification |
| Redis TTL | **PASS** | 90s config; live TTL 66 remaining |
| Redis not used as eligibility source | **PASS** | eligibility reads Postgres timestamps |
| Monitor ~30s | **PASS** (source + unit) | emits stale/expired/location.stale; **no axis writes** |
| GPS deny still heartbeats | **PASS** (source) | `geoDenied` skips GPS only |
| Live GPS-deny on device | **NOT RUN** | no native environment |
| Hidden-tab 2× cadence | **PASS** (source) | Partner Web `intervalMs` doubles when `document.hidden` |
| Hidden-tab live browser | **NOT RUN** | auth blocked |

---

## D. FOUR AXES

Linux Docker, same 14-file bundle that includes the locked FSM files:

```
118 pass / 0 fail / 502 expects / 24.17s
```

| Suite | Status |
|---|---|
| 51/51 canonical FSM files (`partner-four-axis` + lifecycle + availability + job + finance + section03 job-action + career) | **PASS** |
| Orthogonality 12/12 | **PASS** |
| `MONEY_DRIFT` | **PASS** = **0** (orthogonality JSON) |
| Illegal alias writes | **PASS** |
| `Availability.SUSPENDED` impossible | **PASS** (vocab + FSM) |
| `Job.EARNINGS_POSTED` impossible | **PASS** |
| Presence never mutates axes (integration + live forensic + monitor source lock) | **PASS** |

Orthogonality `beforeAll` was hardened in this loop (Location row + isolate other `isOnline` partners on shared `homigo_test`). That is a **TEST FIXTURE** isolation fix, not a product mutation.

---

## E. DISPATCH PATH MATRIX

| PATH | ENTRY | GATE | FINAL REVALIDATION | LOCK | Status |
|---|---|---|---|---|---|
| Matching | `matching.service.findBestProviders` | SQL ACTIVE+online + `passesPresenceLocationGate` | n/a (candidate filter) | n/a | **PASS** |
| Auto offer | `assignment-engine.dispatchToNextProvider` | matching then `assertOfferEligible` | yes | `SELECT … FOR UPDATE` on provider | **PASS** |
| Accept | `booking.service.accept` | `assertAcceptEligible` (lifecycle + presence + location + capacity) | yes | `FOR UPDATE` booking + provider | **PASS** |
| Direct booking `providerId` | `booking.service.create` | `assertOfferEligible` inside tx | yes | booking tx | **PASS** |
| Admin reassign | `admin-booking-operations.reassignProvider` | `assertOfferEligible` | yes | tx | **PASS** |
| Emergency override | same, `emergencyOverride` | only `STALE_PRESENCE` / `STALE_LOCATION` / `LOCATION_INVALID` | remaining gates stay | audited `DISPATCH_ELIGIBILITY_OVERRIDE` | **PASS** |
| Override cannot bypass `SUSPENDED` | phase3 test | lifecycle still blocks | — | — | **PASS** |
| Force dispatch | `dispatchBookingNow` | same matching+offer path | yes | yes | **PASS** (code) |
| Hidden Prisma assign | search | accept restore writes `providerId` only after offer attempt, same tx as `assertAcceptEligible` | rollback on fail | **VALID** | |

Phase 3 suite: **8/8 PASS** (direct book stale blocked; fresh allowed; admin stale blocked; emergency audited; actor mismatch rejected; SUSPENDED not bypassed).

Failure matrix (pure evaluation **PASS**):

| Snapshot | Eligible |
|---|---|
| ACTIVE + AVAILABLE + LIVE + LOCATION_FRESH | true |
| ACTIVE + AVAILABLE + STALE_PRESENCE | false |
| ACTIVE + AVAILABLE + STALE_LOCATION | false |
| ACTIVE + OFFLINE | false |
| SUSPENDED + AVAILABLE | false |
| ACTIVE + AVAILABLE + LIVE + NO_CAPACITY | false |
| Stale heartbeat + fresh location (live forensic) | false (`STALE_PRESENCE` only) |

---

## F. SECURITY / RACE

| Gate | Status | Evidence |
|---|---|---|
| STALE_SESSION | **PASS** | live + integration |
| DEVICE_MISMATCH | **PASS** | live + integration |
| Wrong partner ownership | **PASS** | integration |
| Rate limit flood | **PASS** | integration |
| Replay / future / old timestamp | **PASS** | live + unit |
| Assignment uniqueness race | **PASS** | `assignment-dispatch-lock` concurrent inserts: exactly one wins |
| processQueue lock / crash TTL | **PASS** | same suite |
| Redis unavailable in test env | **PASS** | in-memory lock fallback; eligibility still Postgres |
| Redis write failure → false live | **PASS** (code) | `cacheSetPresence` catch; gate ignores Redis |
| Explicit Redis-down chaos vs live API | **NOT RUN** | no induced Redis kill this loop |
| Full `p0-security-hardening` / financial races | **NOT RUN** | not re-executed this loop |
| Override abuse (wrong adminId) | **PASS** | phase3 |

`tracking.service.isProviderOnline` still reads Redis `provider:{id}:online`. Callers: ops-map display. **LEGACY / VALID for map dots**, not a dispatch bypass. Dispatch does not consult that key.

---

## G. PRODUCT SURFACES

| Surface | Status | Notes |
|---|---|---|
| Partner Mobile publisher | **PASS** (source) | global hook; cadence; copy helper |
| Partner Mobile live timer | **NOT RUN** | `adb devices` empty — **NATIVE MOBILE — NOT RUN — ENVIRONMENT LIMITATION** |
| Partner Web publisher | **PASS** (source) | singleton so layout + card do not double-beat |
| Partner Web live timer / hidden tab | **NOT RUN** | demo password 401 |
| Admin roster columns | **PASS** (source) | Partner, Lifecycle, Availability, Presence, Location, Dispatch, Last seen, Jobs |
| Admin stale ≠ `SUSPENDED` | **PASS** (source) | Presence shows Live/Stale/Expired; Dispatch `Not eligible · stale presence` |
| Admin production-built E2E this loop | **NOT RUN** | admin `:3003` not certified here |
| Customer labels | **PASS** (source + unit) | `Available now` / `Limited availability` / `Confirming professional`; no raw Online on customer provider list |
| Customer live zone heartbeat stop/recover | **NOT RUN** | no browser customer session this loop |

Admin may display operational `Stale` / `Expired`. Partner-facing UI must not; inspected copy helpers comply.

---

## H. PERFORMANCE

| Scenario | Status | Measured |
|---|---|---|
| 100 partners | **NOT RUN** | no load harness executed |
| 500 partners | **NOT RUN** | — |
| 1000 partners | **NOT RUN** | — |
| Heartbeat p50/p95/p99 | **NOT RUN** | — |
| Sync-timer burst detection | **NOT RUN** | — |

**NOT RUN / ENVIRONMENT BLOCKED** for production load baseline. Single forensic heartbeat latency: **250 ms** (n=1, not a baseline).

---

## I. TEST MATRIX

Authoritative Docker command (Linux):

```text
docker run --rm --network homigo-cert4 \
  -v D:/homigo:/repo -v homigo-cert-linux-nm:/repo/apps/backend/node_modules \
  -w /repo/apps/backend \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:<db-password>@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 sh -c "bun test --max-concurrency 1 \
    src/__tests__/partner-presence.unit.test.ts \
    src/__tests__/partner-presence.integration.test.ts \
    src/__tests__/partner-presence-monitor.unit.test.ts \
    src/__tests__/dispatch-eligibility.test.ts \
    src/__tests__/phase3-dispatch-bypass-closure.test.ts \
    src/__tests__/partner-four-axis.test.ts \
    src/__tests__/partner-four-axis-orthogonality.test.ts \
    src/__tests__/assignment-dispatch-lock.test.ts \
    src/__tests__/partner-lifecycle-fsm.test.ts \
    src/__tests__/partner-availability-fsm.test.ts \
    src/__tests__/partner-job-fsm.test.ts \
    src/__tests__/partner-finance-fsm.test.ts \
    src/__tests__/section03-job-action-policy.test.ts \
    src/__tests__/partner-career-policy.test.ts"
```

Result: **118 pass / 0 fail**.

| Gate | Result | If not PASS: reason / next evidence |
|---|---|---|
| Phase 0 freeze (no reset) | **PASS** | dirty tree recorded |
| homigo_db PartnerPresence | **PASS** | `\d partner_presence` |
| homigo_test PartnerPresence | **PASS** | local + ci-pg |
| CI DB PartnerPresence (local homigo-ci-pg) | **PASS** | includes `last_location_received_at` |
| Staging PartnerPresence | **BLOCKED** | table missing — apply migrations before staging cert |
| GitHub Actions CI | **NOT RUN** | not triggered this loop |
| Client publisher source | **PASS** | Mobile + Web hooks |
| Live HTTP heartbeat chain | **PASS** | forensic script 27 pass / 0 fail / 2 blocked |
| Live client timer (Mobile) | **NOT RUN** | no Android/iOS device |
| Live client timer (Web) | **NOT RUN** | password login 401 |
| eligible=true after fresh beat+location | **PASS** | GET dispatch-eligibility |
| Expiry fail-closed (backdated heartbeat) | **PASS** | eligible=false, axes unchanged |
| Real wait through TTL to EXPIRED | **SKIPPED** | 90s wall-clock not waited; derived boundaries + backdate used |
| Location vs heartbeat separation | **PASS** | ping does not advance heartbeat; stale presence with fresh location still ineligible |
| Session/device/ownership/rate-limit | **PASS** | integration + live |
| Dispatch bypass closure | **PASS** | phase3 8/8 |
| Four-axis 51/51 | **PASS** | in 118 bundle |
| Orthogonality 12/12 | **PASS** | `MONEY_DRIFT=0` |
| Concurrency assignment lock | **PASS** | 7/7 in bundle |
| Redis failure chaos | **NOT RUN** | code review only |
| Metrics registered | **PASS** (source) | heartbeat success/reject, location, eligibility pass/reject, override, revalidation |
| Metrics scraped live | **NOT RUN** | Prometheus not queried this loop |
| Admin HQ production E2E | **NOT RUN** | — |
| Customer live supply | **NOT RUN** | — |
| Partner Web production E2E | **NOT RUN** | — |
| Native mobile | **NOT RUN** | ENVIRONMENT LIMITATION |
| Load 100/500/1000 | **NOT RUN** | ENVIRONMENT BLOCKED |
| Full backend suite | **NOT RUN** | targeted 118 only |
| Full security suite | **NOT RUN** | targeted presence/dispatch/lock only |

---

## PHASE 16 — SEARCH CLASSIFICATION (SELECTED)

| Hit | Class |
|---|---|
| `PartnerPresence` + heartbeat/location ping services | **VALID** |
| `evaluateDispatchEligibility` / `assertOfferEligible` / `assertAcceptEligible` | **VALID** |
| Monitor `lifecycleState: "ACTIVE"` in **WHERE** (read filter) | **VALID** |
| Lead FSM `KYC_PENDING` / `VERIFICATION` / `APPROVED` | **VALID** (acquisition lead machine, not Partner lifecycle writes) |
| `canonicalizeLifecycle("KYC_PENDING")` read-only alias | **VALID** (reads); writes of aliases rejected by tests |
| Event `PARTNER_EARNINGS_POSTED` | **VALID** (finance event name, not Job state) |
| `tracking.service` Redis `provider:{id}:online` | **LEGACY** ops-map; not dispatch |
| matching `availableNow: true` on already-gated candidates | **VALID** (tautology after presence filter) |
| `Availability.SUSPENDED` in product writes | **not found** |
| Suspend-on-stale / cancel-job-on-stale / money-on-stale | **not found** |
| Historical `docs/HOMEEIGO_PARTNER_PRESENCE_DISPATCH_FINAL_CERTIFICATION.md` | **LEGACY DOC** (superseded by this report) |

---

## CERTIFICATION CENTERPIECE

Proven on live API + Postgres + Redis:

```
ACTIVE + AVAILABLE
  → client-shaped heartbeat
  → Postgres presence + distinct capturedAt/receivedAt
  → Redis TTL
  → FRESH presence + FRESH location
  → dispatch eligibility true
```

and back:

```
heartbeat evidence aged
  → STALE_PRESENCE
  → eligible=false
  → Partner lifecycle still ACTIVE
  → availability not SUSPENDED
  → jobs untouched
  → finance untouched
```

Partner Web timer is now proven (see evidence-closure addendum below). Still not proven: native mobile, presence load 100/500/1000, full backend suite, Admin production E2E, customer zone live E2E.

Until those items are closed (or formally waived), the label stays **PARTIAL**, not **CERTIFIED**.

---

## Evidence-closure addendum (2026-09-07 later)

### Partner Web publisher map

| File | Role | Interval | Cleanup |
|---|---|---|---|
| `src/hooks/use-partner-presence-heartbeat.ts` | **Authoritative singleton** `shared` runtime | 25s (`setTimeout` chain); hidden = 2× | `release()` when refs=0; `stopLoop` on OFFLINE |
| `src/components/realtime/PartnerPresenceHeartbeat.tsx` | Root layout mount | uses hook | unmount → release |
| `src/components/availability/OperationsStatusCard.tsx` | Second hook consumer (copy only) | **no extra timer** | refs 2→1, loop continues |
| Other `setInterval` in partner-web | OTP / toast / maps — **not presence** | n/a | n/a |

Lifecycle: LOGIN persist hydrate → `authenticated` → acquire → ops `AVAILABLE` → `startLoop` → one `setTimeout` chain → `POST /presence/heartbeat`. StrictMode remounts increment `generation` then settle. Forensic: **refs=2, one timer, beatCount 2..5**.

Client fixes this loop (not auth weakening):

1. `PartnerAuthBootstrap` waits for zustand persist hydration before `bootstrap()` (stops idle-bootstrap from wiping a restored session).
2. Heartbeat `inFlight` is cleared by **generation**, not `isAlive` (prevents a deadlocked loop after StrictMode/unmount races).
3. Playwright timer spec uses `RefreshTokenService` mint + persist inject — same production token path, no login bypass.

### Real timer evidence

`npx playwright test e2e/presence-heartbeat-timer.spec.ts` — **1 passed (2.3m)**

Posted offsets (ms): `0, 25221, 50402, 75611, 100805, 105221, 130442`  
Rate **0.0397 Hz** ≈ 1 / 25.2s. Duplicate would be ~0.08 Hz.  
Location on 1 of 5 recorded 200s (AVAILABLE every-3rd).  
Route `/work-hq`: +2 posts in 26s (one immediate reschedule + one 25s beat) — not a second publisher.

### CATEGORY | RESULT | EVIDENCE

| CATEGORY | RESULT | EVIDENCE |
|---|---|---|
| P0 HTTP chain | **PASS** | prior forensic 27/0 |
| P0 Partner Web timer | **PASS** | Playwright 1/1; rate 0.0397 Hz; refs=2 |
| P0 Partner Mobile timer | **NOT RUN** | `adb devices` empty; no emulator.exe / system images |
| Presence persistence | **PASS** | HTTP + timer → Postgres |
| Redis TTL | **PASS** | prior redis-cli TTL 66 |
| Freshness | **PASS** | snapshot `FRESH` after timer |
| Location freshness | **PASS** (unit/HTTP); timer GPS sparse | every-3rd beat attached once |
| Session security | **PASS** | prior + mint session |
| Device security | **PASS** | prior DEVICE_MISMATCH |
| Dispatch matching | **PASS** | 118 bundle (not re-run) |
| Offer revalidation | **PASS** | 118 bundle |
| Accept revalidation | **PASS** | 118 bundle |
| Direct booking | **PASS** | phase3 |
| Admin reassignment | **PASS** | phase3 |
| Emergency override | **PASS** | phase3 |
| Four-axis 51/51 | **PASS** | 118 bundle; client-only timer fix, not re-run |
| Orthogonality 12/12 | **PASS** | 118 bundle |
| MONEY_DRIFT | **PASS** = 0 | orthogonality + correlated E2E this loop |
| Concurrency | **PASS** | assignment-lock in 118; p0-financial-races  this loop 92-file group |
| Security | **PASS** | `p0-security-hardening` in Docker 92/0 group |
| Admin E2E (production build roster) | **NOT RUN** | no production Admin pass this loop |
| Customer E2E (zone supply) | **NOT RUN** | correlated E2E is booking journey, not zone labels |
| Partner Web E2E (full production suite) | **NOT RUN** | timer spec only, not full partner-web e2e |
| Full backend | **NOT RUN** | additional 92 tests run; not entire `bun test` |
| Load 100/500/1000 heartbeat | **NOT RUN** | k6 suite is booking/wallet/payment, not presence |
| Staging migration | **PASS** | `prisma migrate deploy` applied both presence migrations; `\d partner_presence` confirmed |
| Staging runtime health | **NOT RUN** | nothing listening on :3010 |
| Native mobile | **NOT RUN** | ENVIRONMENT LIMITATION |
| CI (GitHub Actions) | **NOT RUN** | not triggered |

Customer → Partner → Admin correlated: **PASS** this loop (`MONEY_DRIFT: 0`).

---

# MASTER FORENSIC CLOSURE — 2026-09-07 evening

## 1. Executive decision

`PARTIAL — IMPLEMENTATION COMPLETE, POLICY/ENVIRONMENT EVIDENCE REMAINS`

Presence is liveness evidence, not a fifth FSM. The original P0 client-publisher gap is closed on Partner Web with a real production timer. Staging API runtime, customer supply labels, Admin HQ production roster, Redis-down fail-safe, and presence load 100/500/1000 now have executable evidence.

Not certified: native mobile, GitHub Actions CI, full `bun test` (36 failures, classified below), customer production browser, full Partner Web Playwright suite. No waiver exists.

## 2. Exact revision

| Field | Value |
|---|---|
| HEAD | `104a3f77402eb3ad541a56336dcc61b04d04ce63` |
| Branch | `cursor/stage-e-step-13-certification` |
| Working tree | **DIRTY** — ~1179 short-status lines. Presence/dispatch/client work is uncommitted. No reset/clean/stash/restore was performed. |
| Four-axis backend files vs HEAD | **unchanged**. Historical 51/51 + 12/12 + `MONEY_DRIFT=0` retained; not a fresh run. |

## 3. Dirty-tree status

Freeze: `git rev-parse HEAD` = `104a3f77402eb3ad541a56336dcc61b04d04ce63`. Do not discard this tree.

This closure added/updated: `presence-load-baseline.ts`, `presence-customer-supply-truth.ts`, `mint-admin-session.ts`, adversarial fixture heartbeat seed, Partner Web timer mint-env isolation, Admin production roster spec.

## 4. Original P0 root cause

Backend matching / `assertOfferEligible` fail closed with no heartbeat. Neither Partner Mobile nor Partner Web published `POST /api/providers/me/presence/heartbeat`. ACTIVE + AVAILABLE → zero offers.

## 5. P0 closure proof

Dev `:3000` forensic (prior): 27 PASS / 0 FAIL / 2 BLOCKED (password login 401).

Staging `:3010` forensic (this closure): **27 PASS / 0 FAIL / 2 BLOCKED**.

Go Online → heartbeat HTTP 200 → Postgres FRESH → Redis TTL (when Redis up) → eligible=true. Backdate heartbeat → STALE_PRESENCE → eligible=false. Lifecycle ACTIVE, isOnline unchanged, jobs 0→0, earnings 0→0.

## 6. Partner Web timer proof

Turbopack (prior): 1 passed (2.3m), rate 0.0397 Hz, refs=2.

Production `next build` + `next start -p 3102`: **1 passed (2.3m)**. Offsets `[0, 25903, 51161, 76522, 102371, 127795]`, rate **0.0392 Hz**, refs=2, one timer, location on 3rd beat, route-change delta=2, presenceFreshness=FRESH.

Command: `E2E_SKIP_SERVERS=1 E2E_PARTNER_URL=http://127.0.0.1:3102 E2E_API_URL=http://127.0.0.1:3000 npx playwright test e2e/presence-heartbeat-timer.spec.ts`

A first production attempt timed out on `/login` because leftover `HOMIGO_STAGING=1` minted staging JWTs against the dev API — ENVIRONMENT contamination, not a publisher defect. Mint now clears `HOMIGO_STAGING`.

## 7. Partner Mobile evidence

`adb devices` empty. `emulator.exe` absent. No `system-images`. **NATIVE MOBILE = NOT RUN. REASON = ENVIRONMENT LIMITATION.** Expo Web is not native evidence.

## 8. Staging evidence

Schema (prior): `partner_presence` + unique `provider_id` + `last_location_received_at` + indexes.

Runtime: `HOMIGO_STAGING=1 bun run src/index.ts` → `http://127.0.0.1:3010/health` `environment=staging` `database=ok` `redis=ok`. Forensic 27/0. Schema PASS is not treated as runtime PASS; both are now PASS.

## 9. Full regression

Linux Docker `oven/bun:1.3` `bun test --max-concurrency 1`: **2034 pass / 36 fail / 2070 tests / 146 files / 734.78s**. **Full backend = FAIL.**

The 36 are booking create/accept/reschedule/chaos tests whose fixtures never published a heartbeat. Direct booking fail-closes on STALE_PRESENCE, so success count is 0. **TEST FIXTURE**, not four-axis corruption. `seedAdversarialFixtures` now seeds FRESH presence; remaining fixture families are not yet covered. Required next: seed presence in remaining booking fixtures, then a single-runner full `bun test`.

## 10. Dispatch path matrix

Historical PASS: matching, offer `assertOfferEligible` + FOR UPDATE, accept `assertAcceptEligible`, direct booking, admin reassign, emergency override (presence/location only, cannot bypass SUSPENDED). Phase3 8/8.

## 11. Four-axis integrity

Historical green evidence retained because four-axis implementation was not modified during this closure. 51/51 PASS. 12/12 PASS. MONEY_DRIFT=0.

## 12. Security

Historical p0-security-hardening 92 group PASS. This closure re-proved on staging: DEVICE_MISMATCH 403, TIMESTAMP_FUTURE 400, STALE_SESSION 403. Password login remains BLOCKED (PII-encrypted emails).

## 13. Concurrency

Assignment-lock historical PASS. Presence load `--concurrency=20`: 100/500/1000 with 0 HTTP errors. Unbounded 500 → 376× HTTP 409 CONFLICT (ENVIRONMENT stampede).

## 14. Customer truth

`presence-customer-supply-truth.ts` on staging: **10 PASS / 0 FAIL**. Fresh → `Available now`. Aged → `Confirming professional`, `availableNow=false`. No raw STALE/EXPIRED/SUSPENDED/Online. Axes untouched.

Customer production browser: **NOT RUN** (password 401; no mint inject). Required: mint customer + Playwright `/providers` on `:3101`.

## 15. Admin truth

`next build` + `next start -p 3103`. Minted admin session. `presence-roster-production.spec.ts` **1 passed (11.7s)** at 1440×900. Columns: Partner, Lifecycle, Availability, Presence, Location, Dispatch, Last seen, Jobs. No axis-mix strings on the page.

## 16. Load results

Harness: `apps/backend/scripts/presence-load-baseline.ts` against staging `:3010`.

| N | concurrency | HTTP 200 | errors | p50 | p95 | p99 | result |
|---|---|---|---|---|---|---|---|
| 100 | unbounded | 100 | 0 | 1539 | 3019 | 3095 | PASS |
| 500 | unbounded | 124 | 376×409 | 10069 | 15110 | 21196 | FAIL ENVIRONMENT stampede |
| 500 | 20 | 500 | 0 | 1332 | 2147 | 2664 | PASS |
| 1000 | 20 | 1000 | 0 | 840 | 1304 | 1663 | PASS |

Aged control: STALE_PRESENCE, lifecycle ACTIVE, isOnline true, jobs 0, earnings 0. pg connections stayed 21. Laptop staging Bun is not a production SLO.

## 17. CI results

`gh auth status` empty. **CI = NOT RUN — ENVIRONMENT.**

## 18. Remaining blockers

| Item | Result | WHY | ENV or PRODUCT | Required next |
|---|---|---|---|---|
| Native mobile | NOT RUN | no device/emulator/system-images | ENVIRONMENT | real device: login, Go Online, heartbeat, GPS deny, background |
| GitHub Actions CI | NOT RUN | no `gh` auth | ENVIRONMENT | workflow on this tree after commit |
| Full backend | FAIL | 36 booking tests, no fixture heartbeat | TEST FIXTURE | seed remaining fixtures; single-runner `bun test` |
| Full Partner Web e2e suite | NOT RUN | timer spec only | — | `npx playwright test` on `:3102` |
| Customer production browser | NOT RUN | password 401 | ENVIRONMENT | mint + `/providers` on `:3101` |
| Formal waiver | none | must not be invented | — | explicit human waiver |

## 19. Exact commands

```text
git rev-parse HEAD
HOMIGO_STAGING=1 bun run src/index.ts
HOMIGO_STAGING=1 E2E_API_URL=http://127.0.0.1:3010 bun run scripts/presence-p0-forensic-proof.ts
HOMIGO_STAGING=1 E2E_API_URL=http://127.0.0.1:3010 bun run scripts/presence-customer-supply-truth.ts
HOMIGO_STAGING=1 E2E_API_URL=http://127.0.0.1:3010 bun run scripts/presence-load-baseline.ts --n=1000 --concurrency=20
E2E_SKIP_SERVERS=1 E2E_PARTNER_URL=http://127.0.0.1:3102 npx playwright test e2e/presence-heartbeat-timer.spec.ts
E2E_SKIP_SERVERS=1 E2E_ADMIN_URL=http://127.0.0.1:3103 npx playwright test e2e/presence-roster-production.spec.ts
```

Full Docker backend command is in section I above.

## 20. Exact PASS/FAIL/BLOCKED/NOT RUN/SKIPPED matrix

| CATEGORY | RESULT | EXACT EVIDENCE |
|---|---|---|
| P0 original breakage | **PASS** | HTTP + Partner Web production timer |
| Partner Web timer | **PASS** | production Playwright 1/1; 0.0392 Hz; refs=2 |
| Partner Web duplicate-timer safety | **PASS** | refs=2, one timer; route delta=2 |
| Partner Mobile timer | **NOT RUN** | no adb/emulator/system-images |
| HTTP heartbeat | **PASS** | staging forensic HTTP 200 |
| Presence persistence | **PASS** | Postgres `lastHeartbeatAt` |
| Redis TTL | **PASS** | prior TTL 66; missing during Redis-down (expected); PONG after restore |
| Freshness | **PASS** | FRESH after timer/heartbeat |
| Location freshness | **PASS** | capturedAt≠receivedAt; every-3rd GPS |
| Session security | **PASS** | STALE_SESSION 403 |
| Device security | **PASS** | DEVICE_MISMATCH 403 |
| Matching | **PASS** | historical 118 + phase3 |
| Offer revalidation | **PASS** | historical 118 |
| Accept revalidation | **PASS** | historical 118 |
| Direct booking | **PASS** | phase3 historical |
| Admin reassignment | **PASS** | phase3 historical |
| Emergency override | **PASS** | phase3 historical; audit; no dedicated Prometheus override counter |
| Four-axis 51/51 | **PASS** | historical; files unmodified this closure |
| Orthogonality 12/12 | **PASS** | historical |
| MONEY_DRIFT | **PASS** | 0 historical |
| Concurrency | **PASS** | lock historical; load 1000 @20 in-flight 0 errors |
| Security | **PASS** | historical 92 + staging forensic gates |
| Admin production E2E | **PASS** | roster 1/1 on next start :3103 |
| Customer production E2E | **NOT RUN** | API supply-truth PASS; browser not run |
| Partner Web production E2E | **PASS** | timer spec on next start :3102 (not the 20-file suite) |
| Full backend | **FAIL** | 2034 pass / 36 fail; fixture STALE_PRESENCE |
| Staging schema | **PASS** | unique provider_id + received_at |
| Staging runtime | **PASS** | :3010 health + forensic 27/0 |
| Load 100 | **PASS** | 100/100 HTTP 200 |
| Load 500 | **PASS** | 500/500 HTTP 200 at concurrency=20 |
| Load 1000 | **PASS** | 1000/1000 HTTP 200 at concurrency=20 |
| Native mobile | **NOT RUN** | ENVIRONMENT LIMITATION |
| CI | **NOT RUN** | ENVIRONMENT — no GitHub auth |
| Observability | **PASS** | live GET :3000/metrics presence/dispatch counters |
| Documentation consistency | **PASS** | current docs: presence is not a fifth FSM; no Availability.SUSPENDED writes |

## 21. Final certification decision

**PARTIAL — IMPLEMENTATION COMPLETE, POLICY/ENVIRONMENT EVIDENCE REMAINS**

Not CERTIFIED: native mobile, CI, full backend, and customer production browser remain non-PASS, and no formal waiver exists.

Not NOT CERTIFIED — PRODUCT DEFECTS REMAIN: the original P0 is proven on a real Partner Web production timer; stale presence does not suspend, cancel jobs, or mutate finance.

Centerpiece proven:

```
GO ONLINE → ONE REAL CLIENT TIMER → AUTOMATIC HEARTBEAT → BACKEND 200
  → PRESENCE FRESH → LOCATION ON CADENCE → DISPATCH ELIGIBLE
STOP / AGE HEARTBEAT → STALE → NOT ELIGIBLE
four axes orthogonal
```

