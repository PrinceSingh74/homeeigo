# Phase 10 §6 — Requirement gates

**Status:** CLOSED in code and on the isolated stack; live enforcement waits on OP-6 (migration `20260924150000`). Regression figures at the end.

## §6.1 Audit — what existed, what was display-only

| Layer | Before §6 | Authority |
|---|---|---|
| Configuration | `service_requirements` + `service_requirement_items` (Phase 06), synced from `catalog_config.requirements`; CHECK-constrained vocab (`enforcement`, `verification`, `responsibility`) | one, kept |
| Resolver | `lib/service-requirements.ts` `resolveServiceRequirements` — deterministic, fail-closed, conditional (`when.variantIds/addonIds/minQuantity`) | one, kept — **not duplicated** |
| Snapshot | `requirements.v1` inside `bookings.service_config_snapshot`, written in the create transaction with `attested` codes | one, kept |
| Gate | only `REQUIRED_BEFORE_BOOKING` → `REQUIREMENTS_NOT_CONFIRMED` on create | — |
| Enforcement | `REQUIRED_BEFORE_ARRIVAL`, `REQUIRED_AT_START`, `PARTNER_CHECK` → **labels on the partner brief only** (`VERIFY_ON_ARRIVAL` / `VERIFY_AT_START`) | none |
| State | none — nothing recorded whether a gated requirement was ever satisfied | none |
| UI | partner brief (web + mobile) lists preconditions with the label; customer sees "preparation" at booking; admin sees nothing per booking | display-only |
| Holds | `SAFETY_HOLD` / `COMMERCIAL_HOLD` / `NOT_CONFIGURED` live in the **content data + readiness report** (`scripts/data`, `requirement-content-validator`), not in runtime rows | content-level |

**Live measurement (homigo_db, read-only, 2026-09-24):** 40 active `REQUIRED_BEFORE_ARRIVAL` and 7 `REQUIRED_AT_START` assignments across **25 of 31 services**, all `PARTNER_CHECK`, all `CUSTOMER` responsibility — every one unenforced. 69 INFORMATIONAL + 32 WARNING assignments are copy and stay copy.

## Architecture (the chain, §6 definition of done)

```
service version → effective requirements (Phase 06 resolver, unchanged)
              → requirements.v1 snapshot on the booking (unchanged)
              → booking_requirement_states  (NEW: one row per GATED item, born in the create tx)
              → enforcement point (BEFORE_BOOKING | BEFORE_ARRIVAL | AT_START = the Phase 06 enforcement values, mapped)
              → lib/requirement-gates.ts evaluate (pure, deterministic)
              → START refused (RequirementGateError, 409 REQUIREMENT_GATE_BLOCKED) / arrival evaluated
              → audit trigger (append-only) + realtime (one publisher) + notifications (dedup index)
```

- **Arrival vs START.** Both `REQUIRED_BEFORE_ARRIVAL` and `REQUIRED_AT_START` bind at the START transition. Arrival stays a fact on the row (ADR-018, §5 frozen): the partner is physically there whether or not the water is on, and the no-show policy needs that fact. `POST /:id/arrived` therefore **evaluates** the gate and returns `requirementGate` (both parties are told what blocks START, `execution.blocked` is published) and `POST /:id/start` **refuses**. This is the one place the brief's literal wording ("arrival blocked") was not implemented as a refusal, deliberately, and it is recorded here.
- **State model (§6.8):** `UNRESOLVED | SATISFIED | FAILED` stored; `EXPIRED` derived — a `PARTNER_CHECK` records `valid_for_scheduled_at`, so a reschedule invalidates the evidence without rewriting history. A CHECK constraint ties resolved state to actor+evidence+timestamp.
- **Responsibility (§6.7):** `canTransitionRequirement` — assigned PARTNER records SATISFIED/FAILED on a `PARTNER_CHECK` (never a customer attestation); OWNER customer attests a `CUSTOMER_ATTESTATION` item or sends a FAILED partner check back for re-check (→ UNRESOLVED), never satisfies it; ADMIN can only force a re-check with a reason — **there is no admin "mark satisfied"**.
- **PARTNER_CHECK (§6.6):** what — the snapshot item; who — the assigned partner only; satisfaction — an authenticated `POST /:id/requirements/:code/check` with the OUTCOME the partner found, **GPS proximity enforced exactly like arrival** (`assertJobProximity`, same radius); evidence — role, id, kind, ref `partner-check:<requestId>`, lat/lng, note, `resolved_at`; expiry — bound to the appointment; scope — booking-specific, and **admin reassignment resets every partner check** (cross-domain fix, below).
- **Conditional requirements (§6.9):** unchanged — the resolver decides applicability from the server-priced selection; the snapshot is what the gate reads, so a client omitting a variant cannot make a requirement disappear after booking.
- **Holds (§6.11):** `SAFETY_HOLD` is expressed at runtime as the `REQUIRED_AT_START / PARTNER_CHECK` `safe-access-assessed-on-site` item (now enforced); `COMMERCIAL_HOLD` is `SEPARATE_QUOTE` copy with no gate (a quote hold is not an execution gate — nothing here turns it into one); `NOT_CONFIGURED` kinds produce no rows, so nothing is asserted.
- **Deployment gap is loud, not silent:** the store probes `to_regclass` (same pattern as the Phase 06 store). Without the migration the gate is **not enforced**, the view says `enforced: false`, `requirement_gate_unavailable_total` counts and a warn line names the migration. Blocking every live start on a missing table would be an outage; pretending it passed would be a lie.

## Defects (R-matrix + discovered)

| Id | Defect | Root cause | Fix | Proof |
|---|---|---|---|---|
| R1 | required-before-arrival bypass | no state, no gate | rows + START gate | integration "R1/R2" + reintro R-a |
| R2 | required-at-start bypass | same | same | same |
| R3 | PARTNER_CHECK display-only | label on brief | check endpoint with proximity + evidence | "FAILED check…", "both checks…" |
| R4 | customer satisfies partner requirement | — | responsibility model | "R4/R5" + unit + reintro R-c |
| R5 | partner satisfies customer requirement | — | same | same |
| R6 | client boolean bypass | — | body carries OUTCOME only; start body ignored | "R6" + structural |
| R7 | wrong booking access | — | ownership before any read (404, not 403) | "R7/R23", view tests |
| R8 | stale requirement state | — | rows from the booking's snapshot only | "R18/R8" |
| R9 | expired requirement accepted | — | `valid_for_scheduled_at` → EXPIRED | "R9" + unit + reintro R-g |
| R10 | conditional requirement omitted | — | resolver (Phase 06) decides; snapshot frozen | Phase 06 tests, unchanged |
| R11 | safety hold bypass | content-level | the SAFETY item is now a gated PARTNER_CHECK | live content: `safe-access-assessed-on-site` REQUIRED_AT_START |
| R12 | commercial hold bypass | content-level | not an execution gate; documented | — |
| R13 | inspection requirement bypass | `INSPECTION_DEPENDENT` is content provenance, not a runtime item type | same item path as R11 | — |
| R14 | requirement race with start | — | rows `FOR UPDATE` inside the START tx | "R14" (4 starts × 1 check) + idempotent-start fix |
| R15 | duplicate satisfaction | — | same actor/outcome → no write | "FAILED check…" (audit +1, not +2) + reintro R-e |
| R16 | duplicate audit/event | trigger on BEFORE INSERT fired for ON CONFLICT no-ops (**my bug, caught by the test**) | AFTER trigger | same test |
| R17 | admin unauthorized override | — | only `recheck`, permission-mapped, reason required | "R17" |
| R18 | historical snapshot mutated | — | catalogue edit leaves rows/snapshot untouched | "R18/R8" |
| R19 | frontend ready while backend blocks | client policy mirror cannot see the gate; **`OTP verified + arrived ⇒ STARTED` in the FSM** (pre-existing) | `/actions` carries `requirementGate`; mirrors consume it; FSM: STARTED needs `startedAt` (backend + 2 mirrors) | "R19" + browser |
| R20 | backend accepts while frontend blocked | — | same source of truth | browser: gate open → start 200 |
| R21 | fixture requirement leaks into production | — | rows are per booking; D4 population isolation unchanged | — |
| R22 | missing evidence accepted | — | proximity + actor + timestamp required by CHECK | "R22" + reintro R-b |
| R23 | wrong actor evidence | — | assigned partner only | "R7/R23" |
| R24 | realtime before mutation | — | publish after commit | structural |
| R25 | notification emitted multiple times | — | partial unique index arbiter | "FAILED check…" (count stays 1) |
| R26 | evaluation N+1 | — | one read per view; inserts only for pre-§6 bookings; `requirement_evaluation_seconds` hist | code |
| **D1** | duplicate START under concurrency returned FORBIDDEN to the winner's retry | `already` check ran before the gate lock | idempotent when the row is already IN_PROGRESS by the same partner (§6.16) | "R14" |
| **D2** | reassigned partner inherited the previous partner's on-site checks | booking-scoped evidence | `resetPartnerChecksAfterReassignment` (PARTNER_REASSIGNED, admin actor) | "cross-domain: reassigning…" |
| **D3** | admin `ConfirmDialog` reason textarea had no accessible name | — | `aria-label` | axe |

## Error contract (§6.13)

`409 REQUIREMENT_GATE_BLOCKED` with `error` (labels only), `data.enforcementPoint`, `data.target`, `data.blocking[{code,label,kind,enforcementPoint,responsibility,verification,state,reason,remediation{role,text}}]`. Reasons: `REQUIREMENT_UNRESOLVED | REQUIREMENT_FAILED | REQUIREMENT_EXPIRED | PARTNER_CHECK_REQUIRED | CUSTOMER_PRECONDITION_MISSING`. Mutation errors go through one table (`requirementError`): `NOT_FOUND 404`, `REQUIREMENT_NOT_FOUND 404`, `INVALID_STATUS 409`, `REQUIREMENT_TRANSITION_FORBIDDEN 403`, `REQUIREMENT_STATE_CONFLICT 409`, `REQUIREMENT_GATE_UNAVAILABLE 503`, proximity codes 400. No new code can fall through to success. Partner notes never reach the customer.

## APIs

| Method | Path | Who |
|---|---|---|
| GET | `/api/bookings/:id/requirements` | customer (owner) / partner (assigned) |
| POST | `/api/bookings/:id/requirements/:code/check` `{outcome, latitude, longitude, note?}` | assigned partner |
| POST | `/api/bookings/:id/requirements/:code/customer` `{action: READY|ATTEST, note?}` | owner |
| GET | `/api/admin/bookings/:id/requirements` (+ audit) | admin BOOKINGS.READ |
| POST | `/api/admin/bookings/:id/requirements/:code/recheck` `{reason}` | admin BOOKINGS.UPDATE |
| GET | `/api/bookings/:id/actions` now carries `requirementGate` and `requiredGates: REQUIREMENTS_RESOLVED` | — |
| POST | `/api/bookings/:id/arrived` now returns `data.requirementGate` | — |

## Tests

- `p10-s6-requirement-gates.test.ts` — 31 unit/structural (pure gate, responsibility model, error class, policy, wiring, migration additivity, permission map).
- `p10-s6-requirement-gates.integration.test.ts` — 21 through the real routes on homigo_test (listed above by R-number, plus the audit-append-only and reassignment cases).
- `partner-job-fsm.test.ts` updated for the FSM correction.

**Reintroduction proofs** (isolated copy, each fix reverted alone, suite run, restored):

| Reverted | Result |
|---|---|
| R-a START does not consult the gate | 6 fail |
| R-b check without proximity | 1 fail |
| R-c customer may satisfy a partner check | 5 fail |
| R-e duplicate check re-writes | 1 fail |
| R-f rows not born with the booking | 3 fail |
| R-g reschedule does not expire | 2 fail |
| R-i /actions ignores the gate | 3 fail |
| R-j FAILED treated as passing | 2 fail |
| R-k reassignment keeps the old partner's checks | 1 fail |
| R-l idempotent duplicate start removed | timing-dependent: the race did not interleave on the proof run (1 pass); the defect itself was observed 3× as FORBIDDEN in the full-file run before the fix |

## Runtime, browser, accessibility

- **Isolated stack:** backend :3100 on homigo_test (`isolatedDatabase: true`), partner web :3012, customer web :3011, admin copy on D: :3013 — all torn down afterwards, tsconfig/next-env restored, junction removed first.
- **Partner web:** login → job page → checklist with banner *"Start is blocked — Before starting, resolve: A working power socket near the sofa, Access to the water shut-off valve"*; `/actions` → `requiredGates: [REQUIREMENTS_RESOLVED]`, `disabledReasons.START_SERVICE` = the same sentence; "In place" on the socket → SATISFIED; "Not in place" + note on the valve → FAILED, banner narrows to the valve.
- **Customer web:** real form login → /bookings → modal → *"What we need from you"* with the valve **Missing — needed before work can start**, remediation text, **"It's ready now"** → UNRESOLVED; the partner's note is not shown.
- **Realtime:** the partner page moved the valve to UNRESOLVED without a reload (`booking.requirement` frame → refetch).
- **Gate opens:** partner records the valve in place → *"All requirements are in place."*; `/actions` → `requiredGates: []`; `POST /start` → 200 `in_progress`.
- **Admin:** login → booking page → *Requirements* card (item, point, owner, verification, state, evidence, policy version) + *Requirement audit* (when, action, change, actor, reason, request/trace) → "Request re-check" → reason → socket UNRESOLVED, banner *"Start Blocked: … (partner check required)"*; API confirms `ADMIN_RECHECK` with request and trace ids.
- **axe (`@axe-core/playwright`):** partner checklist 0 violations, customer panel 0 violations, admin card 1 minor (0 serious). Every control has an accessible name; state is icon/glyph + word, never colour alone; targets ≥ 44 px.
- Screenshots: scratchpad `s6-browser/{partner-1-blocked,partner-2-failed,partner-3-open,customer-1-missing,customer-2-ready,admin-1-view,admin-2-recheck}.png`.
- **Live backend** (:3000, hot-reloaded): `/health` 200, `/ready` healthy. On homigo_db the gate reports `enforced: false` until OP-6 — nothing is blocked, nothing is faked.

## Operator action

| Id | Action |
|---|---|
| OP-6 | `bunx prisma migrate deploy` (now three pending: `20260924090000`, `20260924120000`, `20260924150000`). The §6 tables are additive; the live `--watch` backends need no restart — the store probes for the tables every 60 s. |

## Full regression

- Run 1 (before the reassignment hook and the idempotent-start fix): **3483 pass / 0 fail / 284 files**.
- Run 2 (final): **3485 pass / 0 fail / 284 files**, exit 0. No reruns, no masked tests.

**§6 frozen.**
