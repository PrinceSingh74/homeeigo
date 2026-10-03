# Phase 10 §7 Execution plan versioning + §8 Per-step execution

**Status:** CLOSED in code and on the isolated test DB. **Live: migration `20260924180000_execution_plan_steps` not applied (OP-7)**, and **no live service has a plan** — so on live nothing is gated, by design. Full backend regression: **3518 pass / 0 fail / 287 files** (clean run).

## Before (measured on homigo_db, read-only, 2026-09-24)

- 48 active services. **0** have `quality`, `safety`, `safetyNotes`, steps or any execution configuration.
- Nothing recorded what a professional did between START and COMPLETE. The partner "execution" brief was materials/equipment copy and the (empty) quality checklist.
- So §7/§8 is infrastructure-first. **No step content was authored.** Writing procedures, PPE or safety rules for real services is a safety-policy decision the brief reserves for the owner. The engine enforces whatever gets configured, and gates nothing until then.

## Architecture (no duplicate engines)

```
Service → ServiceVersion (services.version / service_config_versions)
        → ExecutionPlan = that version's catalog_config.execution.steps
           ↳ typed mirror service_execution_steps (synced in the service write tx — the service_requirements contract)
        → Booking snapshot execution.v1 (steps of THIS selection, frozen with serviceVersion)
        → booking_execution_steps (one row per step, born in the create tx)
        → step transitions (partner) / reset (admin) → completion gate inside COMPLETE
        → booking_execution_audit (trigger, append-only) + realtime (the one publisher) 
```

- **Plan version = service version.** An admin edit bumps the service version, and existing bookings keep their snapshot and rows (proved).
- **Conditional applicability:** one function, `conditionApplies`, is now shared by Phase 06 requirements and execution steps, so the two can never disagree about what a selection includes.
- **Proof:** the one proof system. A PHOTO step completes only against a `job_evidence` row **of this booking** with authoritative media. BEFORE_AFTER_PHOTOS needs an ARRIVAL/START row plus a COMPLETION row. NOTE needs a note.
- **Safety link:** a step may name a Phase 06 requirement (`safetyRequirement`). It cannot START until that requirement's §6 effective state is SATISFIED. Publish refuses a link that points at nothing or at an INFORMATIONAL item (`EXECUTION_SAFETY_LINK_NOT_ENFORCED`), because such a link would look safety-gated while gating nothing.
- **Typed, not JSON:** mandatory, skip policy, evidence, dependencies, safety link, kind, PPE and warnings are columns with CHECK constraints. `NOT (is_mandatory AND state='SKIPPED_WITH_REASON')` is enforced by the database itself.

## Step state model (P10.4)

| Kind | States |
|---|---|
| Stored | PENDING, IN_PROGRESS, COMPLETED, SKIPPED_WITH_REASON, FAILED, ESCALATED |
| Derived | READY and BLOCKED |

BLOCKED means one of:
- the booking is not IN_PROGRESS;
- a dependency is incomplete;
- the linked safety requirement is unmet.

| Actor | Can |
|---|---|
| Partner (assigned, job IN_PROGRESS) | START, COMPLETE (evidence validated), SKIP (optional + SKIP_WITH_REASON only, reason ≥ 3 chars), FAIL (reason), ESCALATE (reason) |
| Admin | RESET a FAILED/ESCALATED step to PENDING, with a reason. **No admin complete. No admin skip.** |
| Customer | read titles + states only (no notes, no reasons) |

**Completion gate:** every mandatory step must be COMPLETED, and no step may be FAILED or ESCALATED. Optional PENDING steps do not block. It is evaluated inside the COMPLETE transaction with the step rows locked, and a refusal is `409 EXECUTION_GATE_BLOCKED` with a `blocking[]` list.

## Discovered and fixed on the way

| Id | Defect | Fix |
|---|---|---|
| X-1 | **Booking create route turned any unmapped refusal into `201 success: true`** (the known "route falls through to success" class, still open on the create route) | catch-all guard before the success return; pinned structurally |
| X-2 | partner-web realtime reconnect refetched bookings only; requirement/execution/actions views stayed stale after a missed frame | reconnect now invalidates them too (Domain 21 convergence) |

## Tests

- `p10-s7-execution-steps.test.ts`: **15** unit and structural tests.
- `p10-s7-execution-steps.integration.test.ts`: **16** through the real routes on homigo_test. They cover:
  - broken plan refused at publish (cycle, mandatory-skippable), with the version unchanged;
  - valid plan bumps the version and is mirrored typed;
  - snapshot = the selection's steps; conditional step only for the leather variant;
  - BLOCKED before start; completion refused with a structured list; dependency enforced; customer cannot act;
  - COMPLETE needs START; replay is a no-op with one audit row;
  - PHOTO evidence missing, foreign or media-less → refused; a real row is accepted and recorded as `evidence_ref`;
  - mandatory skip refused; optional skip needs a reason; customer view hides notes/reasons; outsider 404;
  - job completes once done; FAILED blocks completion; admin reset only (customer 403; no admin complete route);
  - admin edit never reaches an existing booking;
  - **deterministic race:** two COMPLETEs forced onto the step row lock → one writes, one replays, one audit row;
  - raw-SQL mandatory skip and audit UPDATE refused by the DB.
- **Reintroduction:** 8 fixes reverted one at a time in `D:/homigo-w2-scratch`, all caught. Scratch restored identical afterwards.

| Reverted | Result |
|---|---|
| E7-a COMPLETE ignores the gate | 8 fail |
| E7-b START skips dependency/safety check | 1 fail |
| E7-c PHOTO evidence not validated | 1 fail |
| E7-d mandatory step skippable | 3 fail |
| E7-e no reason for exceptions | 3 fail |
| E7-f steps not frozen at booking | 4 fail |
| E7-g idempotent replay removed | 2 fail |
| E7-h customer sees partner reasons | 1 fail |

- **Typecheck:** backend exit 0; partner-web, web, admin-panel and homigo-partner-mobile exit 0.

## Clients

- **Partner web** `ExecutionSteps`:
  - numbered steps with state word + icon;
  - PPE and warnings;
  - what blocks each step;
  - Start / Done / Skip / "Couldn't do it" / Escalate, shown only when the server offers them;
  - reason field for exceptions;
  - evidence id for PHOTO steps.
- **Partner mobile** `ExecutionSteps`: the same, native, 44 px targets, glyph + word.
- **Customer web** `BookingExecution`: "What was done · n of m", titles and states only.
- **Admin:** "Work steps" card (step, kind, required, evidence, state, finished, note/reason, reset) plus a "Step audit" table (action, change, actor, reason, evidence ref, request/trace). Reset uses the audited ConfirmDialog with a required reason.
- **Customer mobile** `BookingExecutionCard`: "What was done · n of m", glyph + word; typecheck exit 0.

## Browser verification (isolated stack: backend :3100 `isolatedDatabase:true`, partner :3012, web :3011, admin copy :3013)

Seed: `scripts/e2e-seed-phase10-s7-browser.ts` (plan + requirement configured through the admin API, booked through the real booking service, partner check + START through the real services, one real evidence row).

| Step | Observed |
|---|---|
| Partner opens the job | prep READY, apply **BLOCKED** ("Finish the earlier steps first"; only Escalate offered), tidy READY; banner "The job can be completed once every required step is done." |
| Start → Done on prep | IN_PROGRESS → COMPLETED |
| Start apply, Done without evidence | server **400 EVIDENCE_REQUIRED**, state stays IN_PROGRESS |
| Done with the real evidence id | COMPLETED; admin audit shows `evidence_ref` = that job_evidence id |
| Skip tidy with a reason | SKIPPED_WITH_REASON; banner "All required steps are done." |
| Customer opens the booking | "What was done · 2 of 3 — Protect the floor · Done, Shampoo the seats · Done, Tidy up · Not needed"; the partner's reason is **not** shown |
| Admin booking page | Work steps card (kind, required, evidence, state, finished, reason) + Step audit with every transition, actor, evidence ref and request/trace id |

**axe:** partner steps 0, customer panel 0, admin card 0 (after labelling the empty action column header, which also fixed the same issue in the §6 requirements card). Console: no partner or admin errors. The customer page logged transient "backend unreachable" and pool-timeout errors traced to the isolated backend's `.env.test` `connection_limit=5` exhausted by boot-time maintenance jobs. The panel still rendered. This is a test-environment config issue, not a product defect, and is recorded as a warning. The maps loader error is expected (maps egress blocked).

Cleanup: all four servers stopped, tsconfig/next-env restored (0 scratch refs), `.next-p10` removed, admin-copy junction removed (real admin `node_modules` intact, 362 entries). **The empty folder `D:\homigo-p10-admin` could not be deleted: removal of that path is blocked by the session's protection. Delete it by hand if you want it gone.**

## Operator actions

| Id | Action |
|---|---|
| OP-7 | `cd apps/backend && bunx prisma migrate deploy` — applies `20260924180000_execution_plan_steps` (additive; no restart needed: the store probes for the tables). |
| OWNER-CONTENT | Author execution plans (steps, PPE, warnings, evidence, safety links) per service. This is safety/operational policy and was deliberately not invented. Until authored, services have no plan and nothing is gated. |

## Full regression

- Run 1 was interrupted when the previous session ended: 25 files in, with 2 timeouts (`admin-role-gate` 146 s, `assignment-dispatch-lock` 10 s). Run alone, both pass (4/4, 8/8). Classified as teardown/load interference, not a defect.
- Run 2 (clean, no reruns): **3518 pass / 0 fail / 287 files**, exit 0.

**§7/§8 CLOSED and frozen** (live still needs OP-7 + owner-authored plans).
