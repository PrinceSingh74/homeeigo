# HOMEEIGO — PHASE 10 §6 REQUIREMENT GATES
# FINAL ENTERPRISE EVIDENCE REPORT (2026-09-24)

Status values: CLOSED · PARTIALLY CLOSED · BLOCKED · EXTERNAL. Every claim points at a file, a test, a query or a screenshot; nothing is claimed for live that was not measured on live.

| # | Area | Status | Evidence |
|---|---|---|---|
| 1 | Executive status | **§6 CLOSED in code and on the isolated stack; live enforcement BLOCKED on OP-6** | this file; `p10-s6-requirement-gates.md` |
| 2 | Repository state | `245411e`, uncommitted working tree; no commit/push/PR made | `git status` |
| 3 | DB state | homigo_db 1092 MB; pending migrations `20260924090000`, `20260924120000`, `20260924150000`; historical drift `0817090000` recorded, untouched | `owner-ops-2026-09-24.md` |
| 4 | OP-1 | **BLOCKED** — `prisma migrate deploy` denied by the session permission layer; pre-flight + verified backup done | owner-ops |
| 5 | OP-2 | **COMPLETE** — 1015 rows labelled, 0 overwritten; 37 synthetic partners out of real matching | owner-ops, post-apply counts |
| 6 | OP-3 | **BLOCKED → ESCALATION_REQUIRED (NO_MATCH)** — 4 past-dated test bookings (demo account + owner account), no eligible slot; reassignment would be fabricated | owner-ops §OP-3 |
| 7 | OP-4 | **COMPLETE (report) / EXTERNAL (decisions)** — 47 providers: 5 MEDIUM-synthetic, 42 LEANS-real, 0 auto-converted; 81 `.demo` users flagged | `op4-unclassified-providers.md` |
| 8 | OP-5 | **BLOCKED** — same denial; migration additive, live function body verified | owner-ops |
| 9 | §6 architecture | CLOSED — one resolver (Phase 06), one snapshot, new typed state table, one gate, one publisher | evidence §Architecture |
| 10 | Requirement resolution | CLOSED — `resolveServiceRequirements` reused, not duplicated | structural tests |
| 11 | Requirement snapshot | CLOSED — `requirements.v1` reused; state rows born in the create tx from it | "gated items get state rows…" |
| 12 | REQUIRED_BEFORE_ARRIVAL | CLOSED — evaluated at arrival (fact preserved, ADR-018), **refused at START** | "R1/R2", "arrival is recorded…" |
| 13 | REQUIRED_AT_START | CLOSED — refused at START inside the transaction | "R1/R2", reintro R-a |
| 14 | PARTNER_CHECK | CLOSED — assigned partner, GPS proximity, evidence columns, appointment-bound | "R22", "FAILED check…" |
| 15 | Conditional requirements | CLOSED — server-side applicability (Phase 06) frozen in the snapshot | Phase 06 suites |
| 16 | Responsibility model | CLOSED — `canTransitionRequirement`, existing vocabulary only | unit "responsibility model", "R4/R5" |
| 17 | Requirement state model | CLOSED — UNRESOLVED/SATISFIED/FAILED + derived EXPIRED, CHECK-constrained | migration, "R9" |
| 18 | Safety/commercial/inspection | PARTIALLY CLOSED — safety item enforced as a gated PARTNER_CHECK; COMMERCIAL_HOLD is content-level (no in-app quote chain, Phase 06 design) and deliberately not an execution gate | evidence §Holds |
| 19 | Error contract | CLOSED — `409 REQUIREMENT_GATE_BLOCKED` structured; one error table | "R1/R2", `requirementError` |
| 20 | Authorization/security | CLOSED — owner/assigned-partner/admin scoping, 404 for outsiders, permission map | "R7/R23", "R17" |
| 21 | Concurrency | CLOSED — `FOR UPDATE` in START tx; CAS on version | "R14", "two conflicting checks" |
| 22 | Idempotency | CLOSED — same outcome no-op; duplicate start answered like a retry | "FAILED check…", S6-D1 |
| 23 | Audit | CLOSED — trigger-written, append-only, actor/reason/request/trace/idempotency | "R17", "append-only" |
| 24 | Realtime | CLOSED — `booking.requirement` via the one publisher, after commit; consumers refetch | structural, browser (live update without reload) |
| 25 | Notifications | CLOSED — `booking_requirement_missing` / `_recheck`, partial unique index dedup | "FAILED check…" counts |
| 26 | Customer UX | CLOSED (web + mobile) — what/why/who/when/state/blocking/next; "It's ready now" | browser customer-1/2 |
| 27 | Partner UX | CLOSED (web + mobile) — BLOCKED / REQUIRED BEFORE START / BEFORE ARRIVAL / OPTIONAL / COMPLETED; START disabled with the server sentence | browser partner-1/2/3 |
| 28 | Admin UX | CLOSED — requirements card + audit + audited re-check; no override switch | browser admin-1/2 |
| 29 | Accessibility | CLOSED — axe 0/0/1-minor; names on every control; non-colour state; 44 px targets; dialog textarea labelled | axe run |
| 30 | Performance | CLOSED — one read per view, lazy inserts only for pre-§6 bookings, `requirement_evaluation_seconds` / `requirement_mutation_seconds` | code |
| 31 | Database/migrations | CLOSED (test DBs) / BLOCKED (live) — additive migration, applied to homigo_test + homigo_migrations_test | migration file |
| 32 | Historical data | CLOSED — no row rewritten; old bookings gain rows lazily from THEIR snapshot | "R18/R8" |
| 33 | Targeted tests | 31 unit/structural | `p10-s6-requirement-gates.test.ts` |
| 34 | Integration tests | 21 through real routes | `p10-s6-requirement-gates.integration.test.ts` |
| 35 | Full regression | 3485 pass / 0 fail / 284 files (run 2, final); run 1 3483/0 | scratchpad `cc-s6-regression*.txt` |
| 36 | Defect reintroduction | 8 fixes reverted alone in the isolated copy, all caught | evidence table |
| 37 | Browser verification | CLOSED — partner, customer, admin flows + realtime + START 200 | screenshots |
| 38 | Runtime verification | isolated backend `isolatedDatabase:true`; live `/health` 200, `/ready` healthy, gate `enforced:false` until OP-6 | curl |
| 39 | Cross-domain | CLOSED — terminal booking read-only; reassignment resets checks (S6-D2); no-show untouched; snapshot immutable; wrong account 404 | tests |
| 40 | Observability | CLOSED — `requirement_evaluation_total`, `start_blocked_by_requirement_total`, `arrival_blocked_by_requirement_total`, `requirement_satisfied/block/recheck_total`, `partner_check_required_total`, `requirement_gate_unavailable_total`, `requirement_notification_total`; logs carry requestId/traceId/bookingId/requirementId/point/result | service code |
| 41 | Documentation | this file, evidence, defect matrix, owner-ops, memory | docs/operations/evidence/phase10-11 |
| 42 | Files changed | listed below | `git status` |
| 43 | APIs added/changed | listed in evidence §APIs | — |
| 44 | Migrations | `20260924150000_booking_requirement_states` (new, additive) | — |
| 45 | Remaining warnings | ETL BigQuery billing errors in isolated backend log (pre-existing, unrelated); `requirement_gate_unavailable` warns on every live start until OP-6 | logs |
| 46 | Remaining blockers | OP-1/OP-5/OP-6 = one `bunx prisma migrate deploy` the owner must run; OP-3 escalation; OP-4 decisions | owner-ops |
| 47 | Known-masked tests | none masked; `phase09` "recovered after expiry" was rewritten in §5 to assert the refusal (documented there) | §5 evidence |
| 48 | Final risk | Live gate is dormant until OP-6 — 25 services' preconditions stay unenforced on live exactly as before; nothing regresses. After OP-6, partners on those services must record checks before START (partner apps already ship the UI). | — |

## Files changed for §6

Backend: `prisma/migrations/20260924150000_booking_requirement_states/migration.sql` (new), `src/lib/requirement-gates.ts` (new), `src/lib/booking-requirement-store.ts` (new), `src/services/booking-requirement.service.ts` (new), `src/services/booking.service.ts`, `src/services/admin-booking-operations.service.ts`, `src/routes/bookings.ts`, `src/routes/admin.ts`, `src/lib/admin-route-permissions.ts`, `src/lib/booking-realtime.ts`, `src/lib/job-action-policy.ts`, `src/lib/partner-job-fsm.ts`, tests `p10-s6-*.test.ts` (new), `partner-job-fsm.test.ts`, scripts `e2e-seed-phase10-s6-browser.ts` (new), `op4-unclassified-providers-report.ts` (new, OP-4).
Partner web: `types/partner.ts`, `services/partner-api.ts`, `hooks/use-partner-data.ts`, `lib/job-action-policy.ts`, `components/realtime/PartnerRealtimeBridge.tsx`, `components/requests/RequirementChecklist.tsx` (new), `app/(partner)/requests/[id]/page.tsx`.
Customer web: `types/backend.ts`, `services/core/api.ts`, `hooks/use-core-data.ts`, `hooks/use-booking-status-subscription.ts`, `components/booking/BookingRequirements.tsx` (new), `components/booking/BookingDetailModal.tsx`.
Admin: `services/admin-api.ts`, `app/(console)/bookings/[id]/page.tsx`, `components/ui/ConfirmDialog.tsx`.
Partner mobile: `types/partner.ts`, `services/partner-api.ts`, `lib/job-action-policy.ts`, `components/RequirementChecklist.tsx` (new), `components/JobLifecycleActions.tsx`, `screens/JobDetailScreen.tsx`.
Customer mobile: `types/backend.ts`, `services/core/api.ts`, `components/booking/BookingRequirementsCard.tsx` (new), `components/booking/BookingDetailSheet.tsx`.

## Verification totals

- Backend typecheck: exit 0. Client typechecks: partner-web, web, admin-panel, homigo-partner-mobile, homigo-mobile — all exit 0.
- Client unit tests: partner-web 33/0, web 29/0, partner-mobile unit exit 0, homigo-mobile logic 31/0.
- Backend regression run 1 (before the reassignment hook + FSM fix): 3483 pass / 0 fail / 284 files.
- Backend regression run 2 (final, after the reassignment hook + FSM fix, no reruns): **3485 pass / 0 fail / 284 files**, exit 0.

END STATE: WAVE 2 D1–D4 = FROZEN · §5 = FROZEN · OWNER OPS = OP-2 COMPLETE, OP-4 COMPLETE/EXTERNAL, OP-1/5/6 BLOCKED (one command), OP-3 ESCALATION · §6 = CLOSED (code) / live enforcement pending OP-6 · NEXT AUTHORIZED = §7.
