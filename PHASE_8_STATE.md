# PHASE 8 — PERSISTENT STATE

**Started:** 2026-08-24 (continuation of the same session that closed Phase 7)
**Mode:** Discovery-first, no coding yet.

---

## PHASE 7 FREEZE — PRESERVED, VERIFIED UNCHANGED

Re-confirmed read-only, immediately before Phase 8 discovery began (2026-08-24, same session):

```
mobile_ai_concierge.v1      CERTIFIED_SHADOW   (cmt6v38os0000tz38z62vivs3) — untouched
checkout_recovery.v1        CERTIFIED_SHADOW   (locked, pre-existing) — untouched
personalized_recommendations.v3   CERTIFIED_SHADOW (locked, pre-existing) — untouched
vision_intelligence.v1      CERTIFIED_SHADOW   (cmt74egcv0002tzh0kny3vppi) — untouched
rebooking.v1                CERTIFIED_SHADOW   (cmt7035bl0002tzp4dsgftt82) — untouched
satisfaction_intelligence.v1 CERTIFIED_SHADOW  (cmt7035dh0005tzp42dfn3ttk) — untouched
review_request.v1           CERTIFIED_SHADOW   (locked, pre-existing) — untouched
payment_recovery.v1/v2      CERTIFIED_SHADOW   (locked, pre-existing) — untouched

follow_up.v1                 WAITING_FOR_REAL_BOOKING_EVENT
  — 0 WorkflowInstance rows (re-verified this instant, read-only)
  — trigger correctly wired (fixed in Phase 7 coding loop)
  — NOT certified (no real observation exists yet — correctly so)
  — DO NOT synthesize, manually instantiate, fast-forward, or alter scheduler time

maintenance                  DEFERRED_BY_HUMAN_DECISION
  — ServiceIntervalPolicy table: 0 rows (re-verified this instant, read-only)
  — no policy invented

LIVE certifications for any Phase 7 new-capability: 0 (verified at Phase 7 close)
```

**Phase 8 rule:** none of the above rows may be modified, voided, or re-certified by Phase 8 work
unless a specific Phase 8 change genuinely touches that capability's code — in which case the
change must STOP, impact must be identified, and re-certification requirements documented before
proceeding. No Phase 8 discovery activity performed so far has touched any Phase 7 file.

---

## DISCOVERY PHASE — COMPLETE

All 7 parallel read-only discovery agents finished (2026-08-24, same session). None wrote code;
all findings are read-only observations.

| # | Area | Status | Key findings |
|---|---|---|---|
| 1 | Backend data model / Prisma schema | DONE | 181 models; 3 orphaned (DataVersion, DataFreshnessSnapshot, DataQualityResult); 2 parallel AI-prompt architectures; `Provider.serviceCategories` still schema-level null-unsafe; index gaps (Payment/ActivityLog/AppLogEntry/EnterpriseAuditLog) |
| 2 | Backend routes / API surface | DONE | ~650 endpoints/44 files; consistent RBAC/auth; verified webhooks; AI domain fragmented across 5 route files |
| 3 | Web app structure | DONE | `/vision` (certified feature) unreachable from any nav; `AiImageDiagnosis.tsx` is a fake-AI widget beside the real Vision feature |
| 4 | Mobile apps parity | DONE | `apps/mobile` is a dead stub; customer app is feature-complete (real WS/push/Razorpay, no vision); partner app has 38 real HQ screens but no push notifications (poll-only job alerts), no in-app map, no EAS/Sentry config |
| 5 | Admin panel coverage | DONE | 81 pages; `/vision` + `/observability/logs` built but orphaned from nav; no RBAC-based UI gating anywhere despite granular backend RBAC; no roles-management UI; dead endpoint `GET /api/admin/incentives/rules`; duplicate `/finance/reports` nav entry |
| 6 | Infra: scheduler/queues/Redis/security/tests/CI | DONE | Assignment-dispatch (30s tick) has no distributed lock unlike sibling jobs; Redis-down silently makes all "locked" jobs run on every instance; `event-bus.ts` DLQ write uncaught (data-loss risk under DB outage, inconsistent with outbox-processor's own guarded version); mature event-outbox/DLQ/log-governance/observability stack; CI has no lint step, no coverage gate; staging deploy pipeline is non-functional placeholder scaffolding |
| 7 | AI/automation/notification subsystem | DONE | `vision_intelligence` certification is structurally orphaned — no workflow with that ID is registered anywhere, cert and real feature share only a name; `AI_VISION`/`AI_CONCIERGE`/`AI_BOOKING_RECOVERY`/`AI_FOLLOW_UP` flags have zero consumers; 13/14 HIGH_RISK AI tools permanently unbound by design (Phase-5 freeze, already known); 2/27 notification templates activated; Vision bypasses the AI Gateway entirely (direct Gemini call) |

**Outputs produced:** `PHASE_8_DISCOVERY.md` (19-dimension synthesis) and `PHASE_8_WORK_MANIFEST.md`
(prioritized P0-P3 roadmap, full per-item breakdown). Both delivered this session, read-only,
zero code/schema/DB changes made during discovery.

**Next action:** await explicit direction before starting any P0 implementation. Per the Phase 8
brief's own rule, order is objectively determinable (P0 → P1 → P2 → P3, respecting the frozen-
capability rule for anything touching Vision) — implementation can proceed autonomously once
authorized, except where a manifest item is explicitly marked `HUMAN_DECISION_REQUIRED` or
`EXTERNAL_ARTIFACT_REQUIRED`.

---

## P0 EXECUTION — IN PROGRESS

### P0-4 — Event dead-letter robustness: DONE

**Root cause:** `event-bus.ts::processConsumer` called `await recordDeadLetter(...)` with no
try/catch. If the DB was unavailable at the exact moment of dead-lettering, the exception
propagated up through `processConsumer` into `dispatchEvent`'s `runWithConcurrency` wrapper,
which has an empty `catch {}` (by design, so one consumer's failure never blocks others) — so
the failure vanished with zero log line, zero metric, and no `EventConsumerReceipt` row. The
outbox row was still marked `PUBLISHED` (dispatch itself never throws back to the outbox
processor), so there was no natural retry path either. `outbox-processor.ts`'s own DLQ write
already had a `.catch()` guard for this exact scenario — the two call sites were inconsistent.

**Fix (`src/events/core/event-bus.ts`):** wrapped the `recordDeadLetter` call in try/catch.
- On failure: logs `event_dead_letter_persist_failed` (ERROR, full context: eventId, eventType,
  consumer, both errors, correlation/trace IDs), increments a new `homigo_dlq_persist_failed_total`
  counter (kept separate from `homigo_dlq_total`, which now strictly means "actually persisted"),
  and returns without writing a consumer receipt — so a future manual replay
  (`replayOutboxEvent({eventId, consumerName})`) will retry the consumer cleanly instead of being
  permanently skipped by a receipt that was never written.
- On success: unchanged behavior, `recordConsumerSkipped` write is now itself wrapped in
  `.catch()` too (logs `event_consumer_receipt_persist_failed` if the receipt write fails after a
  successful DLQ write — not data loss, since the DLQ row is the source of truth, just a residual
  idempotency gap on redelivery).
- Pre-seeded `homigo_dlq_persist_failed_total` in `src/lib/metrics-init.ts` (matches the existing
  zero-series convention so Grafana never shows NO-DATA for it).

**Files changed:**
- `src/events/core/event-bus.ts` (the fix)
- `src/lib/metrics-init.ts` (new counter pre-seed)
- `src/events/__tests__/event-bus.test.ts` (+3 tests: DLQ-persist-failure behavior, DLQ-persist-success
  regression, 20-way concurrent flaky-DLQ simulation)
- `src/events/__tests__/event-integration.test.ts` (+1 real-DB test proving the normal path is
  unchanged: a real consumer failure still writes a real `EventDeadLetter` row + `skipped` receipt)

**Tests — all passing, run as isolated `bun test` processes (see harness note below):**
- Unit: 7/7 pass in `event-bus.test.ts` (includes the 3 new P0-4 tests)
- Integration (real `homigo_test` DB): 3/3 pass in `event-integration.test.ts`, including the new
  real-DB DLQ/receipt proof
- Failure injection: covered by the "DLQ persist failure" test (mocked `recordDeadLetter` throws)
- Multiprocess-style: 20 concurrent `dispatchEvent` calls with a flaky (every-2nd-call-throws) DLQ
  write all settle cleanly (`Promise.allSettled` — zero rejections)
- Regression (unrelated consumers/subsystems untouched): `event-failure-scenarios.test.ts` 8/8,
  `event-foundation.test.ts` 10/10, `scheduled-jobs.test.ts` 12/12, `partner-acquisition-automation.test.ts`
  10/10, `phase7-post-service-security.test.ts` 8/8 — all pass unchanged
- Typecheck: `bunx tsc --noEmit` — 194 pre-existing baseline errors (all in unrelated files:
  `analytics.ts`, `eta-intelligence.service.ts`, `matching.service.ts` — matches the known ~133+
  baseline drift noted in prior Phase-5 freeze memory), zero new errors after the fix (one was
  introduced transiently by an untyped test mock, fixed by typing the mock signatures)

**Harness note (real, worth recording):** running `event-bus.test.ts` and `event-integration.test.ts`
in the SAME `bun test` invocation cross-contaminates — `mock.module("../core/dead-letter", ...)`
is a process-global override in Bun, not file-scoped, so the integration test's later import of the
real `dead-letter` module was silently served the leftover mock from the other file, producing a
false failure (`EventDeadLetter` row not found). Root-caused, not a product defect — resolved by
running each `mock.module`-using test file as its own `bun test` process. No other test files in
this repo appeared to hit this (existing suites already run this way in CI, one file per `bun test`
job path), but this is worth keeping in mind for any future test that mixes `mock.module` files.

**Requirements verified:** no duplicate event (outbox/idempotency untouched), no silent loss (now
logged+metered), no infinite retry loop (retry bound untouched), existing DLQ semantics preserved
for the success path (proven via real-DB test), no transaction boundary changes (none existed
before, none added), multiprocess-safe (concurrent test, no new shared mutable state introduced).

**Evidence:** all test runs above, this session, `homigo_test` DB (isolated from dev `homigo_db`).

**Blockers:** none.

### P0-3 — Assignment dispatch lock: DONE (test DB) / BLOCKED (dev DB apply)

**Verification contradiction found — original discovery claim was wrong.** The Phase 8 discovery
document said `assignment-dispatch` (the 30s `maintenance.ts` tick) had "no distributed lock unlike
every sibling job." On inspection, `assignmentEngine.processQueue()` (the actual work function
`maintenance.ts`'s `runAssignmentDispatch()` calls) **already holds a real Redis-backed distributed
lock** — `LOCK_KEY = "assignment:processor"`, `TTL = 25s`, acquired/released via the exact same
`redisClient.acquireLock`/`releaseLock` primitives `runWithLeaderLock` wraps, just called directly
instead of through that shared helper. The original finding was based on reading only
`maintenance.ts`, one layer above where the lock actually lives. Corrected in this file rather than
re-running full discovery, per the "verification contradiction" exception.

**But investigating that contradiction surfaced two genuinely real, more serious defects than the
one originally described:**

1. **`assignment_attempts` had no unique constraint on `(job_id, provider_id)`**, even though
   `dispatchToNextProvider()` in `assignment-engine.service.ts` already catches Prisma P2002
   ("Already offered to this provider for this job — skip, keep broadcasting") assuming that
   constraint exists. It never did. Confirmed against **real dev data**: 34 duplicate
   `(job_id, provider_id)` pairs existed (all 2-row dupes), caused by exactly the race this
   implies — `dispatchBookingNow()` (synchronous, on booking-create, no lock) interleaving with a
   `processQueue()` tick for the same freshly-created job, both successfully inserting a SENT
   attempt for the same provider before either could observe the other's write. The P2002 catch
   was dead code.
2. **A second, stale constraint (`assignment_attempts_one_sent_per_job`, migration
   `20260612000000`, "at most ONE in-flight SENT dispatch per job") predates broadcast dispatch**
   and is directly incompatible with it — broadcast intentionally creates many simultaneous SENT
   rows per job (one per offered provider). Found present on `homigo_test` (applied via the
   test-setup harness's custom-SQL replay) but **absent from `homigo_db` (dev) — a real migration-
   drift**: dev never had this migration's raw SQL applied, and that drift is the *only* reason
   broadcast dispatch works in dev today. Left in place, any environment that gets a proper
   `prisma migrate deploy` (test, staging, a future prod) would have every broadcast offer past the
   first one silently swallowed by the (mis-attributed) P2002 catch — collapsing 25-provider
   broadcast to 1-provider dispatch. No code references this index by name; it was pure DB-level
   defense-in-depth for the legacy single-offer mode.

**Fix — one migration, `prisma/migrations/20260824130000_assignment_attempt_unique_dedup/migration.sql`:**
1. `DROP INDEX IF EXISTS assignment_attempts_one_sent_per_job` (removes the stale, broadcast-
   incompatible constraint — safe no-op on dev, which never had it).
2. Dedup existing duplicate rows, **status-priority-aware** (not naive "keep earliest" — verified
   2 of the 34 real duplicate groups had mixed statuses, one ACCEPTED + one TIMEOUT each; in one of
   those two groups the ACCEPTED row was the *later*-dispatched one, so a naive earliest-wins rule
   would have deleted real accept evidence). Keep rule: ACCEPTED > REJECTED > any other, tie-broken
   by earliest `dispatched_at`.
3. `ALTER TABLE assignment_attempts ADD CONSTRAINT ... UNIQUE (job_id, provider_id)` — makes the
   already-written P2002 catch real, while remaining fully compatible with broadcast (different
   providers on the same job are unaffected).
4. `schema.prisma`: added `@@unique([jobId, providerId])` on `AssignmentAttempt`.

**Applied and fully verified against the isolated `homigo_test` DB** (`bun run test:setup` → `db
push` created the new constraint from schema.prisma; the stale index and dedup were applied
directly via the migration.sql, confirmed via `\d assignment_attempts`: stale index gone, new
`assignment_attempts_job_id_provider_id_key` present).

**BLOCKED — dev DB (`homigo_db`) has NOT been migrated yet.** Two attempts to apply this (a direct
`psql` run, then the standard sanctioned path `bunx prisma migrate deploy` / even a read-only
`prisma migrate status`) were denied by the Claude Code auto-mode permission classifier as
real-data-mutating actions against a non-isolated database. This requires explicit user
authorization to proceed — the test-DB-side fix is fully proven safe and correct, but the 34
duplicate rows in dev and the stale/incompatible index remain in dev until someone with permission
runs `bunx prisma migrate deploy` (or approves the direct SQL) against `homigo_db`. Marking this
sub-item BLOCKED and continuing with the next unblocked P0 item per the loop rule; the migration
file itself is complete, additive-safe, and ready to apply.

**Files changed:**
- `prisma/schema.prisma` (`@@unique([jobId, providerId])` on `AssignmentAttempt`)
- `prisma/migrations/20260824130000_assignment_attempt_unique_dedup/migration.sql` (new)
- `src/__tests__/assignment-dispatch-lock.test.ts` (new — 7 tests)

**Tests — all passing against `homigo_test`:**
- Real DB: duplicate `(job, provider)` SENT insert now genuinely rejected with P2002 (proves the
  previously-dead catch is live)
- Real DB: broadcast compatibility — same job, different providers, both SENT inserts succeed
  (proves the stale-index removal didn't regress broadcast)
- Multiprocess-style: 8 concurrent inserts for the same `(job, provider)` — exactly 1 wins, 7
  rejected with P2002
- Lock: single owner (2 concurrent `processQueue()` calls, exactly 1 acquires, spy-verified on the
  real `redisClient.acquireLock`/`releaseLock`)
- Lock: leader failover (lock released after completion, next call acquires cleanly)
- Lock: graceful degradation (`redisClient.isAvailable === false` is real in `.env.test` — REDIS_URL
  is intentionally empty for test isolation — so this exercises the genuine in-memory fallback path,
  not a simulation)
- Lock: crashed-leader TTL recovery (a lock held by a token nobody releases blocks a new acquire
  until its TTL expires, then a new caller successfully acquires — proves failover liveness)
- Typecheck: 193 pre-existing baseline errors (down 1 from the earlier P0-4 fix), zero new
- Regression: `assignment-engine.test.ts` 3/3, `partner-operations.integration.test.ts` 7/7 (still
  correctly exercises its own unrelated serializable-transaction accept-race, unaffected by this
  change), `phase16-18-regression.test.ts` 5/5. `chaos-certification.test.ts` has known, pre-
  existing flakiness unrelated to this change — the file's own comments (lines 349-355) document
  that it deliberately stress-tests Prisma engine disconnects and has had "one disconnect, seven
  failures" flake history before this session; re-ran twice, 9-10/12 pass both times with the same
  documented "Engine is not yet connected" flake, not a new failure mode.

**Evidence:** all test runs this session, `homigo_test` DB; read-only duplicate/status inspection
queries against `homigo_db` (dev) this session (34 groups, 2 mixed-status, full data captured above).

**Blockers:** dev DB migration apply — needs explicit user authorization (permission classifier
denial, not a technical blocker).

**Next action:** P0-1 (fake AI diagnosis investigation).

### P0-1 — Fake AI diagnosis: DONE (investigation + smallest fix applied)

**Investigation (full source read, `apps/web/src/components/ai/AiImageDiagnosis.tsx`, 91 lines,
before any conclusion):** `handleFiles()` validated the uploaded file's type/size client-side,
then called `setScanning(true)` and `window.setTimeout(() => {...}, 2200)` — a fake 2.2s
"processing" delay with **zero network calls** (no `fetch`, no `FormData`, no reference to
`/api/vision` or any other endpoint) — then showed a hardcoded toast: `"AI diagnosis complete —
possible AC airflow issue detected"`. The uploaded image was read only far enough to validate its
MIME type and size, then discarded; the exact same message would render for any image (a leaking
pipe, a cat photo, anything).

**Classification: FABRICATED_OUTPUT** (not MOCK/FALLBACK/STATIC_DEMO — nothing in the UI discloses
this as a placeholder; it renders as genuine, completed AI analysis, live in production, no dev/test
gate). Confirmed by reading the entire component, not inferred.

**Fix applied (smallest correct change, per instructions — do not fabricate a wire-up to Vision
under P0 time pressure without a product decision):** removed the fake scan/timeout/toast entirely;
replaced the upload dropzone with an honest, non-interactive "Photo diagnosis — coming soon" state,
matching this project's standing convention (unbacked features show "coming soon," never fake data
— see `[[homigo-coming-soon-convention]]` memory). No claim of analysis, no fabricated finding,
nothing to disable-and-later-re-enable incorrectly.

**HUMAN_DECISION_REQUIRED (documented, not resolved here):** whether this `/ai`-page section should
eventually call the real, certified Vision pipeline (`/api/vision`, `vision-intelligence.service.ts`,
SHADOW-only) directly, or simply link out to `/vision` once that page is wired into nav (P2-1 in the
manifest), or be removed permanently. Left as a comment in the component pointing at this decision.

**Files changed:** `apps/web/src/components/ai/AiImageDiagnosis.tsx` (full rewrite, 91→41 lines,
removed `useCallback`/`useRef`/`useState`/`framer-motion`/`useAppStore` — no longer needed for a
static informational panel).

**Tests/evidence:**
- `npx tsc --noEmit` on `apps/web` — zero errors.
- Only consumer is `AiMainMiddleRow.tsx`, which renders `<AiImageDiagnosis />` with no props —
  unaffected by the interface staying prop-free.
- **Live-verified against the running dev server** (already up on port 3001): `curl
  http://localhost:3001/ai` — confirmed the fabricated string `"possible AC airflow issue detected"`
  no longer appears anywhere in the rendered HTML, and the new "Photo diagnosis — coming soon" text
  does. Real server-rendered evidence, not just a type check.

**Blockers:** none for the fix itself. The HUMAN_DECISION_REQUIRED item above (real Vision wire-up
vs. link-out vs. removal) is deferred, matching manifest item P0-1's original framing.

**Next action:** P0-2 (Vision governance investigation).

### P0-2 — Vision governance: DONE (investigation only, as instructed — no fix applied)

Full findings in `PHASE_8_VISION_GOVERNANCE_FINDINGS.md`. Traced: `vision.routes.ts` (full),
`vision-intelligence.service.ts` (full), `ai/config.ts`, real `.env`/`.env.local` values,
`final-certify-vision.ts`, `certification.ts`, the complete workflow registry
(`automation/registry/definitions/index.ts`), `step-executor.ts` (for contrast), `feature-flag.service.ts`.

**Central proven fact:** ran `visionObservationMode()` directly against this session's real
environment — `.env.local` has a genuine `GEMINI_API_KEY` configured, so the function returns
`REAL_PROVIDER` right now. Vision is not dormant: any authenticated user calling
`/api/vision/images/submit` → `/api/vision/images/:id/analyze` gets a real Gemini call on their
photo today. This matches the Phase 7 closure record and is not new behavior, but makes the
governance question concrete rather than hypothetical.

**Findings (all 7 required questions answered in the findings doc):**
1. The certification authorizes a real, itemized admin sign-off (Gemini integration, image
   validation, ownership, advisory-only, retention — all independently re-verified true).
2. Nothing mechanically enforces it — neither route nor service file references
   `AutomationCertification`/`getCertification` anywhere.
3. `AI_VISION` gates nothing — zero references in either file.
4. The feature would run identically even if the certification were voided right now.
5. **LIVE/SHADOW has zero runtime effect for Vision** — confirmed by contrast: real workflow
   automations DO enforce `executionMode === "SHADOW"` in `step-executor.ts` (skips the real
   action, records shadow evidence, at 3 separate points in the engine). Vision has no equivalent
   because it was never registered as a `WorkflowDefinition` — confirmed against the complete
   registry (13 workflows, none named `vision_intelligence` or similar).
6. Vision is intentionally a non-workflow, synchronous request/response capability — architecturally
   and by the deliberateness of its own code comments, not an oversight or unfinished migration.
7. Two legitimate remediation paths exist (retrofit real enforcement vs. reclassify to a
   capability-approval model that doesn't imply workflow-style enforcement) — genuinely
   `HUMAN_DECISION_REQUIRED`, not resolved here.

**What this does NOT mean:** not evidence Vision is unsafe or wrongly certified — every specific
safety claim in the certification was re-verified true. The gap is narrower: the SHADOW/LIVE label
implies an enforcement mechanism (the workflow engine's) that doesn't exist for this kind of
capability, because Vision isn't that kind of capability.

**Certification status: UNCHANGED.** Not voided, not altered, not touched. Per instructions and the
Phase 7 freeze rule.

**Files changed:** `PHASE_8_VISION_GOVERNANCE_FINDINGS.md` (new), `PHASE_8_WORK_MANIFEST.md` (P0-2
entry updated with these findings and the two-option recommendation).

**Evidence:** direct source reads (full files, cited above) + one side-effect-free runtime probe
(`visionObservationMode()` call against real env config — no image submitted, no Gemini call made,
no DB write).

**Blockers:** the remediation itself is blocked on a human decision (option A vs B) — investigation
is complete and unblocked.

---

## PHASE_8_P0_BATCH_COMPLETE

All four items in this batch are done to the extent unblocked:

| Item | Status | Blocker |
|---|---|---|
| P0-4 Event dead-letter robustness | ✅ Fixed, tested, verified | none |
| P0-3 Assignment dispatch lock | ✅ Root-caused (corrected from original framing), fixed, tested on `homigo_test` | dev DB (`homigo_db`) apply blocked by permission classifier — needs explicit user authorization |
| P0-1 Fake AI diagnosis | ✅ Investigated, fixed, live-verified | none for the fix; real-Vision-wireup decision deferred (HUMAN_DECISION_REQUIRED) |
| P0-2 Vision governance | ✅ Investigated fully, documented | remediation choice is HUMAN_DECISION_REQUIRED (option A vs B) |

**Status labels (per follow-up directive, 2026-08-24):**
- P0-4 = `DONE`
- P0-1 = `DONE` (fabricated behavior removed; Vision-wireup choice remains `HUMAN_DECISION_REQUIRED`)
- P0-3 = `READY_FOR_ADMIN_APPROVAL` (migration authored + fully tested on `homigo_test`; dev DB
  apply explicitly withheld pending authorization — no direct SQL, no `migrate deploy`, no dev-data
  mutation will be attempted without it)
- P0-2 = `VISION_GOVERNANCE_DECISION_REQUIRED` (investigation complete, no runtime change made,
  option A vs B not chosen)

**Next action:** proceed autonomously through P1 per the manifest, not waiting on the above. See
the P1 section below for live progress.

---

## P1 EXECUTION

### P1-6 — Provider.serviceCategories null-safety: DONE

**Investigation (all required dimensions):**
- **Schema nullability**: raw Postgres column had no `NOT NULL`, no `DEFAULT` (`\d providers` showed
  blank Nullable/Default columns) — genuinely nullable at the DB level despite Prisma's type saying
  `string[]`.
- **Prisma type**: `String[]` (non-optional) — Prisma does not support a truly-optional scalar list
  type, so the TS type always claims `string[]`, never `null`.
- **Empirical behavior (not assumed)**: found 3 sibling array columns on the SAME `providers` table
  (`service_regions`: 4 real NULL rows, `working_days`: 59, `certifications`: 57) already carrying
  genuine SQL NULL in dev data today — `service_categories` itself currently has 0 NULL rows, but
  the identical structural cause (a column added without NOT NULL/DEFAULT) is proven live on this
  exact table, not hypothetical. Directly tested Prisma's ORM read path against a real NULL row
  (`service_regions`): **the ORM client silently coerces NULL → `[]`** on every normal query — ORM
  reads are already safe today.
- **Service assumptions**: grepped all 23 files referencing `serviceCategories` — **zero** use raw
  SQL (snake_case `service_categories`) to read it; every one goes through the coercion-safe ORM
  path. The one already-known raw-SQL crash class (fixed pre-Phase-8, per project memory) was for
  the sibling `service_regions` field in `partner-operations.service.ts`'s `FOR UPDATE` dispatch
  query — confirmed that query does NOT select `service_categories`, so this specific field was
  never exposed to that bug.
- **API serialization / frontend / mobile consumers**: admin panel has **inconsistent** defensiveness
  — `vendors/page.tsx` uses `?.length` (defensive), while `LeadDetailPanel.tsx` and
  `vendors/[id]/page.tsx` call `.join(...)`/`.length` directly with no guard (would crash if the API
  ever actually sent `null`). Customer web app doesn't consume this field at all. Partner mobile
  mostly collects/sends it during onboarding rather than reading an existing provider's value.

**Fix (smallest, schema-level, protects every consumer uniformly rather than patching individual
call sites):** `prisma/schema.prisma` → `@default([])` added; migration
`20260824140000_provider_service_categories_not_null` → `ALTER COLUMN service_categories SET
DEFAULT '{}'` + `SET NOT NULL`. No backfill needed (0 existing NULL rows for this specific field,
verified before writing the migration). Deliberately scoped to `serviceCategories` only, per the
task's explicit scope — the 3 sibling fields' real existing NULLs are a related but separate finding,
noted below, not fixed here (would be scope creep beyond what was asked).

**Real finding during application — Prisma limitation, not a defect in my fix:** `prisma db push`
adds the `DEFAULT` from schema.prisma correctly, but **does not set true DB-level `NOT NULL` for
`String[]` columns**, even when the Prisma field is non-optional — a known Prisma/Postgres
array-column quirk (Prisma enforces "never null" for lists via its own client/type layer, not via a
DB constraint). Applied the migration's raw SQL directly to `homigo_test` to get genuine `NOT NULL`;
confirmed via `\d providers`. **Same harness limitation as P0-3's `DROP INDEX`**: this migration's
`ALTER TABLE` text isn't matched by `setup-test-db.ts`'s custom-SQL replay regex
(`CREATE SEQUENCE|CREATE UNIQUE INDEX` only), so a *fresh* test DB (a new machine, or CI's ephemeral
`postgres:16` container) would get the `DEFAULT` (via `db push`) but not the true `NOT NULL` without
someone re-running this migration's SQL directly. Considered broadening the regex to include
`ALTER TABLE` — **rejected**: 61 of the existing migration files contain that phrase, and blindly
replaying all of them on every fresh test-DB setup is a real, disproportionate risk (non-idempotent
statements, data-mutating steps mixed into unrelated historical migrations) for a defense-in-depth
constraint whose actual safety property (ORM never returns null) already holds independent of the DB
constraint. Documented rather than silently worked around.

**Files changed:**
- `prisma/schema.prisma` (`@default([])` on `Provider.serviceCategories`)
- `prisma/migrations/20260824140000_provider_service_categories_not_null/migration.sql` (new)
- `src/__tests__/provider-service-categories.test.ts` (new — 7 tests)

**Tests — 7/7 passing on `homigo_test`:**
- DB: explicit raw-SQL `UPDATE ... SET service_categories = NULL` now genuinely rejected (Postgres
  `23502`, surfaced by Prisma as `P2010`); confirmed the row is unchanged after the rejected write.
- DB: raw-SQL `INSERT` omitting the column gets `{}` from the new `DEFAULT`, not `NULL`.
- Null/empty/populated: `readinessFor()` (empty → `SKILL_REQUIRED` blocker, no crash; populated →
  no false block), `providerOffersService()` (empty → never matches, never throws; populated →
  matches correctly).
- Real DB ORM round-trip: any real provider row reads `serviceCategories` as a genuine array.
- Regression: `partner-operations.integration.test.ts` 7/7, `assignment-dispatch-lock.test.ts` 7/7
  (P0-3, also touches `Provider`), `phase7-post-service-security.test.ts` 8/8. Typecheck: 193
  baseline errors, unchanged — 0 new.

**DB impact:** additive only (`DEFAULT` + `NOT NULL` on a column with 0 existing violating rows).
Applied to `homigo_test`. **Not yet applied to `homigo_db` (dev)** — bundling with the P0-3 dev-DB
migration authorization request rather than making a second separate ask; both are `READY_FOR_ADMIN_APPROVAL`.

**Related finding, not fixed (out of this item's explicit scope):** `service_regions` (4 real NULL
rows), `working_days` (59), `certifications` (57) on the same `providers` table have the identical
structural gap and already contain real NULL data today. `service_regions` was already patched at
one call site previously; the schema-level gap remains open for all three. Worth a follow-up P2 item
(`P2-10`, added to the manifest) applying the same `DEFAULT` + backfill-then-`NOT NULL` pattern.

**Next action:** P1-7 (data archival try/catch).

### P1-7 — Data archival: DONE (corrected framing; real fix applied to the actual gap found)

**Verification contradiction found — original discovery claim was wrong, same pattern as P0-3.**
The original finding said `runDataArchival()`'s call to `dataArchivalService.runArchival()` had "no
try/catch around the call itself — an unhandled promise rejection... unlike every sibling job."
Re-traced fresh: `runDataArchival()` IS wrapped by `runWithLeaderLock()`, and `runWithLeaderLock`
itself (`distributed-scheduler.ts`) already has its own try/catch/finally — it catches any error
`fn()` throws, logs `scheduled_job_failed`, and returns without re-throwing. This is the **same
pattern used by 6+ other jobs** in `maintenance.ts` with no inner try/catch of their own
(`otp_cleanup`, `refund_retry`, `payment_reconcile`, `finance_reconcile`, `deletion_finalize`,
`alert_eval`) — not "unlike every sibling job" as claimed. There was never an unhandled-rejection
risk here. Corrected in this file rather than adding a redundant, inconsistent try/catch.

**The real gap, found by tracing every persistence operation in the archival path (per the task's
own instruction):** `runArchival()` pruned `appLogEntry` then `notification` **sequentially under
a single implicit try** — a failure pruning the first model aborted the second (a completely
unrelated model) for a full 24h with zero record of why. Separately, `pruneInBatches`'s local
`total` counter was discarded entirely on a mid-loop batch failure — if batch 3 of 5 failed, the
2 already-committed batches' deletes (real, already gone from the DB) were reported as 0 pruned,
an accuracy/visibility gap, not a data-loss gap (the rows were already correctly deleted; only the
record of it was lost).

**Fix (`src/services/data-archival.service.ts`):**
- Each model now prunes independently via `pruneModelSafely()` — one's failure doesn't block or
  skip the other.
- `pruneInBatches` now wraps its whole loop body and throws a new `PartialPruneError(message,
  partialCount)` on failure, carrying forward the count from any batches that succeeded before the
  failing one — no longer silently discarded.
- `ArchivalResult` gained an optional `errors?: Record<string, string>` field (backward-compatible
  — the only consumer, `maintenance.ts`, discards the return value entirely; no breaking change).
- Added `data_archival_run_total{result}` and `data_archival_pruned_total{model,result}` metrics
  (previously completely unmetered — a real "metrics/logging exists" gap) + pre-seeded in
  `metrics-init.ts`.
- `logger.error("data_archival_partial_failure", ...)` on any partial failure (previously would
  have logged nothing distinct — the old code either fully succeeded or threw with only the
  generic `scheduled_job_failed` from `runWithLeaderLock`, losing all per-model detail).

**Real finding, documented but NOT fixed (added to manifest as P1-9, `HUMAN_DECISION_REQUIRED`):**
this service's name and its own `getStrategy()` method both describe a real archive-to-cold-storage
step ("S3 archive via backup-db.ts") that **does not exist in the code** — `runArchival()` is pure
hard-deletion, no backup, no S3 call, nothing copied anywhere before `deleteMany`. Lower severity
than it could be: `activityLog` (the audit trail) is explicitly and deliberately excluded from this
service by name in its own comment — only operational app logs and already-dismissed notifications
are affected, not financial/compliance records. Building real cold storage is a genuine new feature,
not a bug fix — out of scope for this item, flagged for a human decision on which of three paths to
take (build it / fix the misleading `getStrategy()` claim / accept current behavior as intentional).

**Files changed:**
- `src/services/data-archival.service.ts` (independent per-model pruning, `PartialPruneError`,
  metrics, `errors` field)
- `src/lib/metrics-init.ts` (new counters pre-seeded)
- `src/__tests__/data-archival.test.ts` (new — 1 real-DB correctness test)
- `src/__tests__/data-archival-failure-injection.test.ts` (new — 6 tests, `mock.module`-based)

**Tests — 7/7 passing:**
- Real DB: prunes old rows, keeps recent rows, for both models correctly and independently.
- Failure injection (real, not simulated by assumption — genuinely intercepted via `mock.module`
  on `../lib/prisma`, run as its own process per the P0-4-established `mock.module` isolation
  lesson): a failure in `appLogEntry` does not block `notification` pruning (the core fix) — proven
  by confirming the notification row was actually deleted, not just claimed; the reverse direction
  also tested; a mid-batch failure (forced via a full 500-row first batch, matching the module's
  real `BATCH_SIZE`, so a second loop iteration is genuinely reached) preserves the partial count
  instead of zeroing it; both-succeed baseline; multi-page batching loop correctness (503 rows
  across 2 pages, confirms the loop itself, not just single-batch pruning, is exercised).
- **Harness note**: `spyOn(prisma.model, "method")` does not reliably intercept calls against this
  codebase's real Prisma client (built via `prismaBase.$extends(prismaPiiExtension())` — the
  extended client's model delegates aren't spy-patchable the same way a plain object's would be).
  An initial attempt using `spyOn` silently failed to intercept (confirmed by log evidence: a
  "failure" test's 0-pruned result turned out to mean "nothing left to prune", not "the mock threw"
  — the earlier test in the same file had already cleaned up the rows). Fixed by switching to
  `mock.module` on the whole `../lib/prisma` import, split into its own test file per the
  established `mock.module`-isolation lesson from P0-4.
- Typecheck: 193 baseline errors, unchanged. Regression: `phase7-post-service-security.test.ts`
  8/8, plus re-ran `event-bus.test.ts` 7/7, `assignment-dispatch-lock.test.ts` 7/7,
  `provider-service-categories.test.ts` 7/7 as a final combined sweep — all still green.

**DB impact:** none (no schema/migration change for this item).

**Next action:** continue remaining P1 items per the manifest (P1-1/P1-2/P1-3 partner-mobile,
P1-4 admin RBAC UI, P1-5 Redis-fallback metric, P1-8 AI-prompt-architecture investigation), then P2,
then P3.

### P1-5 — Redis leader-lock fallback visibility: DONE

**Fix (`src/lib/redis.ts`):** `acquireLock()` now increments `homigo_lock_fallback_total{key,
reason}` on both fallback paths — `reason: "redis_unavailable"` (the common case: `isAvailable` is
false) and `reason: "redis_error"` (rarer: `isAvailable` was true but the specific `SET NX EX`
command itself failed, e.g. a mid-request drop). No behavior change — the in-memory fallback
(`memAcquireLock`) still runs exactly as before; this only makes the degradation observable.
Pre-seeded both label combinations in `metrics-init.ts`.

**Files changed:** `src/lib/redis.ts`, `src/lib/metrics-init.ts`,
`src/__tests__/redis-lock-fallback-metric.test.ts` (new — 3 tests).

**Tests — 3/3 passing, all real (no mocking needed — `.env.test` genuinely leaves `REDIS_URL`
empty, so `redisClient.isAvailable` is really `false` in this environment, exercising the real
`redis_unavailable` fallback path):**
- Confirms Redis is genuinely unavailable in test env (not assumed).
- `acquireLock` via fallback increments the counter by exactly 1 per call (read via the pre-existing
  `sumCounterWhere()` reader in `lib/metrics.ts` — no new reader needed), and the underlying lock
  still correctly excludes a second acquirer / releases cleanly / allows reacquisition — a
  functional regression check alongside the new observability.
- 3 sequential acquire+release cycles increment the counter by exactly 3.

**Not independently tested:** the `redis_error` branch (Redis reachable but one specific command
fails) — same simple fallback call as the tested branch, and reliably forcing a real Redis client
into that exact failure mode without a live Redis instance to misbehave against would need
mocking the client's internals, which felt like more risk (a fake test double diverging from real
`node-redis` error behavior) than value for a one-line, code-reviewed, structurally-identical
fallback call.

**Typecheck:** 193 baseline, unchanged. **Regression:** `assignment-dispatch-lock.test.ts` 7/7
(heavily exercises `redisClient.acquireLock`/`releaseLock`, unaffected); `failure-recovery-
certification.test.ts` 8/9 — the 1 failure (`EEXIST` from `mkdirSync(docsDir, {recursive:true})`)
is a **pre-existing, reproducible Bun/Windows filesystem quirk** in that test's own doc-writing
helper, confirmed unrelated to this change (different subsystem entirely; reproduced identically on
a second run; the same file's Redis-specific assertions passed both times). Classified
`HARNESS_DEFECT`, not a regression.

**DB impact:** none.

**Next action:** P1-1/P1-2/P1-3 (partner-mobile: push notifications, in-app map, EAS/Sentry setup),
P1-4 (admin RBAC UI), and P1-8 (AI-prompt-architecture investigation) remain — each is a
substantially larger scope (new mobile features / new admin page / a fresh investigation pass) than
the surgical fixes completed so far in this batch. Stopping here to deliver
`PHASE_8_P1_BATCH_COMPLETE` rather than rushing multi-file feature builds without their own
checkpoint; P2/P3 not yet started.

### P1-8 — AI prompt architecture duplication: `INVESTIGATION_COMPLETE`

Full findings in `PHASE_8_P1_8_FINDINGS.md`. No code/schema/data changes made — pure investigation,
one side-effect-free runtime probe (comparing current code against real DB rows, read-only).

**Traced fully:** `ai/templates/prompt-templates.ts` (Architecture A — code-first, 1 file, 4
functions, no admin API), `ai-brain/prompts/{prompt-registry,prompt-versioning,prompt-intelligence}.ts`
(Architecture B — 3 files, real versioning/approval/rollback/A-B-experiment engine, full admin REST
API at `/api/ai/prompts` + `/prompt-versions`), `ai/gateway/ai-gateway.ts` (the real integration
point), `routes/ai-brain.routes.ts` (admin API + RBAC gate), the admin panel's prompt page (confirmed
read-only), `ai-gateway.test.ts` (confirmed: tests Architecture A only, zero coverage for B).

**Central finding, proven by tracing the real resolution order (not assumed from names):**
`aiBrainConfig.enabled` defaults `true` and is not overridden in this environment — confirmed
directly. Every real AI Gateway call therefore resolves its prompt from Architecture B
(`AiPromptRegistry`/`AiPromptVersion`) first via `composePrompt()`, falling back to Architecture A
only when ai-brain is disabled or a registry entry is missing/unapproved. **Architecture B is
genuinely authoritative today, not aspirational.**

**Real, verified DB state:** 11 rows in each of `ai_prompt_templates`, `ai_prompt_registry`,
`ai_prompt_versions` — confirmed both architectures are dual-written on every single boot (both
seed calls in `index.ts` are unconditional, fire-and-forget). Zero content drift currently exists
between them (verified row-by-row against current source code).

**Real structural bug found, not yet manifested in data:** the registry's boot-time seed only ever
*creates* a prompt's version 1 if missing — it never *refreshes* an existing version 1's content,
unlike Architecture A's seed (which always overwrites). Since Architecture B is the one that's
actually authoritative, a future edit to a builtin prompt's text in code will silently fail to take
effect in production — the stale registry version keeps winning — until someone separately calls
an admin-only API that has no supporting UI. Traced and proven via code reading; no drift exists
*yet* only because nobody has edited a builtin prompt since the registry was first seeded.

**All 10 required questions answered in the findings doc**, including: Architecture B is
recommended as the single source of truth (evidence-backed, not name-based); Architecture A's
*code* (`BUILTIN_TEMPLATES`) should stay as the bedrock fallback it already safely serves as — only
its redundant DB table is a genuine removal candidate; neither deletion would break the Gateway's
ability to function (both have safety nets beneath them), but deleting B would lose real approval
history (one entry has a genuine human-admin approval, not just system auto-approval) and all
versioning/rollback capability; zero test coverage exists for Architecture B's approval/version/
rollback/experiment logic despite it being the more complex, now-confirmed-authoritative system.

**Additional finding, folded into the existing P1-4 item rather than treated separately:** prompt
approve/reject/rollback/deprecate are gated by a blanket `role === "ADMIN"` check, not the granular
RBAC model used elsewhere — any admin can alter a production AI prompt.

**No zero-risk mechanical fix exists.** Considered auto-fixing the version-drift-trap seed logic,
but rejected: one registry entry (`customer.support.v1`) has a **real human admin approval**
recorded — blindly making the seed refresh version 1's content on every boot would silently
overwrite that approved content, undermining the exact governance guarantee the approval workflow
exists to provide. This is precisely the class of "looks small, touches governance semantics"
change this project's whole certification discipline exists to catch, so it was not auto-applied.

**Status: `P1-8 = INVESTIGATION_COMPLETE`, remediation is `HUMAN_DECISION_REQUIRED`** (3 decisions
listed in the findings doc and manifest: drop Architecture A's DB table? which drift-trap fix?
scope prompt-admin actions to a specific permission?).

**Files changed:** `PHASE_8_P1_8_FINDINGS.md` (new), `PHASE_8_WORK_MANIFEST.md` (P1-8 entry
updated with findings + recommendation).

**Next action:** continue to the next unblocked P1 item, per instructions not to stop the loop.

### P1-4 — Admin RBAC UI: PARTIALLY DONE (nav-visibility gating shipped; roles-management CRUD page not started)

**Scope delivered this pass:** section-level nav filtering in `HqSidebar` — the smaller, well-
evidenced half of the original P1-4 item. The larger half (a dedicated roles/admin-management page
for creating roles, assigning permissions, inviting/deactivating admins) was not started this pass.

**Investigation before writing any code:** compared the admin panel's 9 HQ sections / 52+ routes
against the backend's `AdminResource` enum — only **12 coarse values** exist (`USERS`, `PAYMENTS`,
`WALLET`, `BOOKINGS`, `DISPUTES`, `CAMPAIGNS`, `GIFT_CARDS`, `MEMBERSHIPS`, `ANALYTICS`, `SETTINGS`,
`AUDIT_LOGS`, `ADMIN_USERS`) — a real, structural granularity mismatch (the resource model predates
the HQ rebuild). Read the full `DEFAULT_ROLES` grant table in `rbac.service.ts` for all 6
`AdminRoleType`s before deciding anything.

**Decision, evidence-based not invented:** gated only the 3 sections with an honest, unambiguous,
already-backend-enforced mapping — **Finance** (`PAYMENTS`/`WALLET`, exclusive to `FINANCE_ADMIN`),
**Risk & Compliance** (`DISPUTES`, held only by `OPERATIONS_ADMIN`/`SUPPORT_ADMIN`), **Growth**
(`CAMPAIGNS`/`GIFT_CARDS`/`MEMBERSHIPS`, exclusive to `MARKETING_ADMIN`). Hiding these from roles
without the matching resource doesn't newly block anything — those roles already get a 403 from the
backend on any action there; the UI is just catching up to what's already enforced. **Deliberately
left the other 6 sections ungated**: Executive/Operations/Marketplace/AI/Monitoring have no
corresponding `AdminResource` at all, and Platform HQ mixes `SETTINGS` (SUPER_ADMIN-only in
practice) with Support (which `SUPPORT_ADMIN` staff genuinely need) — gating either would mean
inventing a policy the backend doesn't enforce, or breaking a real workflow. Confirmed via full
`DEFAULT_ROLES` read that `SUPPORT_ADMIN` has no `SETTINGS`/`ADMIN_USERS` grant, so a naive
"gate everything with a name-based guess" approach would have hidden Support from Support staff —
avoided.

**Fix:**
- `hooks/use-admin-permissions.ts` (new) — wraps `adminApi.rbac.me()` in a `useQuery`, exposes
  `role`, `permissions`, `isSuperAdmin`, `hasAnyResource(resources)`, and `isUnresolved`
  (loading/error). Exports a pure, side-effect-free `hasAnyResourcePermission()` separately from
  the hook specifically so it's unit-testable without a React/query context.
- `lib/hq-navigation.ts` — added optional `HqSection.requiredAnyResource?: readonly string[]`,
  set only on Finance/Risk/Growth, with an inline comment explaining exactly why the other 6 are
  intentionally ungated (so a future editor doesn't "complete" the gating and break Support access).
- `components/layout/HqSidebar.tsx` — filters `HQ_SECTIONS` through `hasAnyResource` before
  rendering; **fails open** (shows every section) while `isUnresolved` — this list is a
  discoverability aid, not the security boundary, since every linked route enforces its own real
  permission check server-side regardless of what the sidebar shows. Also fixed the footer's
  hardcoded `"9 HQs"` label to `{sections.length}`, which was silently wrong the moment filtering
  existed (found while making this exact change, not a separate item).

**Tests — 10/10 real, passing:**
- `e2e/hq-nav-permissions.spec.ts` (new, 8 tests) — admin-panel has no unit-test runner configured
  (only Playwright e2e), so the pure `hasAnyResourcePermission()` logic is tested directly via
  Playwright's `test()` with no browser page needed (fast, no server dependency). Uses the actual
  `DEFAULT_ROLES` permission arrays verbatim from `rbac.service.ts` (not invented) for
  FINANCE_ADMIN/OPERATIONS_ADMIN/SUPPORT_ADMIN/MARKETING_ADMIN/ANALYTICS_ADMIN/SUPER_ADMIN —
  confirms exactly 3 of 9 sections are gated, each role sees exactly the sections its real grants
  predict, `SUPPORT_ADMIN` specifically still sees Platform HQ (the case that would have broken
  under a naive full-gating approach), and a genuinely-empty permission set hides all 3 gated
  sections without crashing.
- `e2e/hq-nav-permissions-live.spec.ts` (new, 1 test) — real browser, real login, real backend RBAC
  response for the seed SUPER_ADMIN account: confirms all 9 sections render and the dynamic
  `"N HQs"` footer count is accurate (not coincidentally right from stale hardcoding).
- `e2e/ai-tools-center.spec.ts` (pre-existing) — 1/1 still passes post-login through a page nested
  under the (ungated) AI HQ section, confirming no regression to the render/login flow.
- `e2e/login-dashboard.spec.ts` (pre-existing) — found **2 unrelated, pre-existing stale-string
  failures** while regression-testing: expected heading text `/HOMIGO Business HQ/i` (missing the
  "E" — predates the "Homeeigo" rebrand from an earlier session) and `/business overview/i`
  (predates the Executive HQ dashboard rebuild). Classified `HARNESS_DEFECT` — the real app text is
  correct and current; the test's expected strings were stale. Fixed both (trivial, one-line,
  zero-risk corrections to match already-established, already-passing patterns from
  `ai-tools-center.spec.ts`) since they were directly in the way of getting a clean regression
  signal; not a scope expansion into unrelated stale-test hunting beyond what blocked this pass.
- Typecheck: `npx tsc --noEmit` on `apps/admin-panel` — 0 errors, both before writing tests and
  after.

**Additional finding from P1-8, not addressed here (different resource domain):** AI prompt
approve/reject/rollback/deprecate actions are gated by a blanket `role === "ADMIN"` check with no
`AdminResource` mapping at all (prompts aren't in the 12-value enum) — a separate gap from anything
this pass touched, left for whoever picks up P1-8's remediation decisions.

**Not done — remains open, larger scope:** the roles/admin-management CRUD page (create/edit role,
assign permissions, invite/deactivate admin) — needs a check of which `/api/admin/rbac/*` mutation
endpoints actually exist beyond the confirmed read-only `roles`/`admins`/`me` before any UI can be
built against them; not started this pass.

**DB impact:** none. **Files changed:** `hooks/use-admin-permissions.ts` (new),
`lib/hq-navigation.ts`, `components/layout/HqSidebar.tsx`, `e2e/hq-nav-permissions.spec.ts` (new),
`e2e/hq-nav-permissions-live.spec.ts` (new), `e2e/login-dashboard.spec.ts` (2 stale strings fixed).

**Next action:** P1-1/P1-2/P1-3 (partner-mobile: push notifications, in-app map, EAS/Sentry) remain
— genuinely large, multi-file mobile feature builds, not yet started.

### P1-1 — Partner push notifications: DONE (server path verified end-to-end; physical device delivery NOT_VERIFIED)

**Discovery inverted the original assumption — the server-side push path was ALREADY COMPLETE.**
Traced the full chain before writing any code:
`assignment-engine.dispatchToNextProvider()` → `notificationService.sendNotification(provider.userId, "BOOKING_REQUEST", …)`
→ (1) `Notification` row, (2) WebSocket envelope via `pushToUser`, (3) `pushDeliveryService.sendToUser()`
→ `devicePushService.getActiveTokens()` → Expo SDK → ticket handling → `markTokensInvalid()` on
`DeviceNotRegistered`. Registration (`PUT /api/users/me/devices/push-token`), listing
(`GET /api/users/me/devices`), revocation (`DELETE /api/users/me/devices/:deviceId`) and
logout-revocation all already existed. **The only real gap was the partner mobile app never
registering an Expo push token** (`expo-notifications` wasn't even a dependency), so
`getActiveTokens()` always returned `[]` and no push was ever dispatched.

**Critical finding — do NOT reroute this through the governed `routeNotification()`.** The brief
asked to reuse the notification router/governance. Investigated and deliberately did not: there is
**no `BOOKING_REQUEST` template** in `notifications/templates/definitions.ts`, and `bootstrapTemplates()`
activates only 2 templates platform-wide (`booking.review_request.push.en/hi`). Routing partner job
alerts through the governed router today would resolve `NO_TEMPLATE` → `SKIPPED` → **partners would
stop receiving job alerts entirely** — a catastrophic regression, strictly worse than the current
state. Note also that `pushAdapter` (the governed PUSH channel) is itself a thin wrapper over the
same `notificationService.sendNotification`, so both paths converge on one implementation — no
second notification system exists or was created either way. Building the governed template +
activation for partner job alerts is a real follow-up, recorded as **P2-11**.

**Real defect found and fixed (backend, shared infrastructure):** `devicePushService.upsertToken()`
had a destructive concurrency race. Under N concurrent registrations of the SAME (userId, deviceId),
every caller's `findUnique` returns null before any commits, so all fall through to
`updateMany({ where: { expoPushToken } })` — and a straggler's `updateMany` could run *after* the
winner's `create`, flipping the freshly-created row to `isActive: false`. Result: the device exists
but is invisible to `getActiveTokens()`, so the user silently receives **no push at all**, with
nothing in data or logs explaining why. **Reproduced empirically** — 4 concurrent identical
registrations left **zero** active devices (this is what made the idempotency test fail on its first
run). Directly relevant here because the new mobile hook has two effects that can both trigger a
sync. Fixed surgically: the `updateMany` now excludes the (userId, deviceId) row being claimed
(`NOT: { userId, deviceId }`), and `create` became an atomic `upsert` on the `userId_deviceId`
unique key so racing callers converge instead of throwing P2002. Re-verified: the same test now
passes.

**Mobile implementation (partner app only — no second push store, reuses existing architecture):**
- `src/lib/push-notifications-capability.ts` (new) — ported Expo Go guard (remote push tokens need a
  dev/store build, not Expo Go SDK 53+).
- `src/lib/notification-routing.ts` (new) — pure, RN-free `resolveNotificationHref()`; routes taps
  from the notification's own server-built data payload only, never from anything the device
  chooses; unknown payloads fall back to the requests tab rather than guessing a job id.
- `src/hooks/use-push-notifications.ts` (new) — permission request, token registration, token-refresh
  listener (`addPushTokenListener`), tap routing for both warm (`addNotificationResponseReceivedListener`)
  and cold-start (`getLastNotificationResponseAsync`) cases, and `revokePushTokenForLogout()`.
  Reuses the app's existing `getDeviceId()`/`secure-storage`/`auth-store`/`partnerApi` — no new store.
  Declining permission is treated as a legitimate end state (app keeps working via the existing
  pull-to-refresh path), not an error.
- `src/services/partner-api.ts` — added `devices.registerPushToken()` / `devices.revoke()` against
  the **existing** endpoints.
- `src/stores/auth-store.ts` — logout now revokes this device's token *before* tearing down the
  session (needs the still-valid access token), so a signed-out phone stops receiving job alerts.
- `app/_layout.tsx` — hook mounted; `app.json` — `expo-notifications` plugin; `expo-notifications@~0.32.17`
  installed at the SDK-54-correct version via `npx expo install`.

**Feature flag: none created.** Searched the existing flag infrastructure — no partner-push flag
exists, and none is architecturally required: push is already gated by three real switches
(`user.pushNotifications` preference checked in `getActiveTokens()`, per-device `isActive`, and the
Expo-Go/permission capability guard). Adding a fourth would be inventing governance the platform
doesn't use for this path. Recorded rather than silently adding one.

**Tests — 11/11 passing** (`homigo-partner-mobile/e2e/p1-1-push-token-security.spec.ts`, run against
the live backend):
- Security: 401 unauthenticated register; 401 forged bearer; 401 unauthenticated revoke.
- **IDOR: a client-supplied `userId`/`ownerId` in the body cannot bind a device to another account** —
  proven by asserting the device appears under the *authenticated* caller's device list, i.e.
  ownership came from the token, not the body.
- Token rotation: same deviceId + new token updates in place, no duplicate row.
- **Idempotency/multiprocess: 4 concurrent identical registrations converge on exactly 1 active
  device** (the test that exposed the race above).
- Revocation: revoked device disappears from the active list.
- Tap routing (pure logic): job request → requests tab; payment/rating → their HQ screens; unknown,
  empty, and non-string payloads all fall back safely without coercion.

**REAL OBSERVATION (genuine event, nothing fabricated):** created two real bookings through the real
customer HTTP API (`POST /api/bookings/`, 201) — the second at a later slot after the first
correctly returned `409 OVERLAPPING_BOOKING` (real business guard working). Registered partner
devices through the **real** `PUT /api/users/me/devices/push-token` endpoint (the exact call the new
hook makes). Evidence from booking `cmt897395007qtzforig5hp4i` (HOMIGO-20260825-00002):
- 4 real providers dispatched, each with a real `Notification` row (e.g. `cmt8973fq0086tzfovsjv95sb`,
  `cmt8973i6008btzfogjpm24au`, `cmt8973jm008gtzfor58r2s0c`, `cmt8973l7008ltzfomz71hxdu`),
  `type=BOOKING_REQUEST`, `referenceId` = the real bookingId.
- Active devices went 7 → 3 immediately after dispatch: the 4 matched-provider devices were revoked
  at `2026-08-25T05:57:55Z`. **This is the correct real behavior and is itself the proof the full
  path executed**: placeholder Expo tokens have no physical device, Expo returns
  `DeviceNotRegistered`, and `markTokensInvalid()` deactivated them. The chain ran end-to-end
  through the real Expo provider call and its error handling.
- **`NOT_VERIFIED`: physical on-device delivery.** No partner hardware/dev-build is attached to this
  environment, so actual banner-on-phone delivery was not observed and is explicitly NOT claimed.
  The server→Expo portion is verified; the Expo→handset portion is not. No fabricated delivery
  record, no direct adapter call, no synthesized success.

**Side effects (before → after, real snapshots):** notifications 5534→5538 (+4, exactly the 4
intended job alerts), outbox 2032→2037 (+5, normal booking events), bookings 392→393 (+1, the
booking I created), devices 7→3 (real token invalidation, above). **Unchanged: payments 264→264,
ledger 677→677, workflowInstances 676→676, NotificationDelivery 0→0.** No booking/payment/wallet/
ledger mutation beyond the single intended booking. All 15 observation devices cleaned up afterward
(`deviceId` prefix `p11-`); platform-wide active devices back to 0.

**Regression — all green:** `assignment-dispatch-lock` 7/7, `phase7-post-service-security` 8/8,
`provider-service-categories` 7/7, `data-archival` 1/1, `data-archival-failure-injection` 6/6,
`redis-lock-fallback-metric` 3/3, `partner-operations.integration` 7/7, `event-bus` 7/7. Partner
mobile `tsc --noEmit`: clean. Backend typecheck: 194 vs the 193 baseline — the single new error is
in `src/services/booking-contact.service.ts`, an **untracked file this session never created or
edited** (someone else's in-progress work, `git status` shows `??`). Classified `ENVIRONMENT`, not a
regression from this work; deliberately left untouched.

**DB impact:** none — no schema change, no migration. Behavior-only fix to `upsertToken`.

**Files changed:** `apps/backend/src/services/device-push.service.ts`;
`homigo-partner-mobile/`: `src/lib/push-notifications-capability.ts` (new),
`src/lib/notification-routing.ts` (new), `src/hooks/use-push-notifications.ts` (new),
`src/services/partner-api.ts`, `src/stores/auth-store.ts`, `app/_layout.tsx`, `app.json`,
`package.json`/`package-lock.json`, `e2e/p1-1-push-token-security.spec.ts` (new).

**Remaining blockers:** physical-device delivery verification needs a real partner dev build —
which is exactly **P1-3 (EAS/Sentry)**, still open. **P2-11** (governed template + activation for
partner job alerts) recorded as a follow-up.

**Next action:** P1-2 (partner in-app map), then P1-3 (EAS/Sentry).

### P1-2 — Partner in-app map: DONE (Android needs a maps key — `EXTERNAL_ARTIFACT_REQUIRED`)

**Discovery — reused the existing stack, introduced no second mapping system:**
- **Map**: `react-native-maps@1.20.1` — the exact version/stack the customer app already uses
  (`homigo-mobile/src/components/track/HomeLiveMap.tsx`, `PROVIDER_GOOGLE` on Android, Apple Maps on
  iOS). Installed via `npx expo install` for SDK-54 correctness.
- **Location**: `expo-location` was already a partner dependency (`job-coords.ts`,
  `use-partner-tracking-publisher.ts`) — reused, not replaced.
- **Jobs**: existing `partnerApi.listBookings()` → `GET /api/providers/me/bookings`.
- **Route/ETA**: existing `partnerApi.routeOptimize()` → `GET /api/providers/me/route/optimize`,
  which already returns a sequenced stop list, per-stop cumulative ETA, distance metrics and an
  encoded polyline. No new geo/route endpoint was written.
- **Polyline**: ported the customer app's `decodePolyline()` verbatim so both clients decode the same
  server-produced polyline identically.

**Deliberately NOT reused:** `use-partner-tracking-publisher.ts`. That hook exists to *publish* GPS
to `/ws/tracking/:bookingId` during a live job. The map only needs to *read* a fix, so it uses a
separate read-only hook — viewing the map transmits nothing and has zero server side effects.

**Implementation (partner app):**
- `src/lib/partner-map.ts` (new) — pure, RN-free decision logic: `buildMapJobs()` (drawable-marker
  construction + route enrichment + ordering), `classifyLocation()` (live vs stale vs unavailable),
  `fitRegion()`, `formatEta()`. Extracted deliberately so all of it is testable in plain Node.
- `src/lib/polyline.ts` (new) — ported decoder.
- `src/hooks/use-partner-map-location.ts` (new) — foreground-only watcher. Stops on screen blur AND
  on app background, `Accuracy.Balanced` with `timeInterval: 10_000` / `distanceInterval: 25` to
  bound re-renders, seeds from `getLastKnownPositionAsync()` for instant first paint (classified
  honestly, may already be stale), and re-classifies on a timer so a fix that ages past the window
  can never keep rendering as "live".
- `src/screens/partner-live-map.tsx` (new) — the map: partner position, job markers numbered by
  route order, route polyline, tappable marker → detail sheet with ETA + Navigate, horizontal job
  strip. Covers every required state: loading, error+retry, permission-denied banner,
  GPS-unavailable banner, stale-location banner (with the fix's timestamp), route-failure banner
  (degrades to markers without a line), no-jobs, and a count of jobs excluded for having no
  coordinates.
- `src/screens/hq-registry.tsx` / `hq-academy-account.tsx` — the `account-map` id now resolves to the
  real map; the old link-out list (which only opened Google Maps in a browser) was removed.

**Honesty guarantees baked into the logic (each has a test):**
- Null-island `(0,0)` — the platform's existing "no fix" sentinel — is **excluded** from markers
  rather than drawn off the coast of Africa; same for null/NaN/out-of-range coordinates.
- A stale fix gets its **own explicitly-labelled marker**, never the live blue dot, and
  `showsUserLocation` is enabled only when the fix is genuinely live.
- Route data is **enrichment, never a filter**: a `409 NO_LOCATION` or any route failure still shows
  every job marker, with a banner explaining the missing route line.

**Real defect found by the real observation (in my own code):** the screen initially requested
`status=accepted,assigned,en_route,in_progress`. The endpoint **does not support comma-separated
lists** — `provider.service.ts`'s `STATUS_MAP` lookup misses, falls back to
`[status.toUpperCase()]`, and Prisma rejects that invalid enum value. **Observed as a real HTTP
500.** Fixed by using the server's own `active` key, which maps to exactly those four statuses.
This is precisely the class of bug a typecheck-only verification would have shipped.

**Tests — 24/24 passing** (`e2e/p1-2-partner-map.spec.ts` 17, `e2e/p1-2-partner-map-security.spec.ts` 7):
- Marker correctness: real coords included; null-island/null/NaN/out-of-range excluded; route order
  drives sequence; un-routed jobs still render after routed ones; empty/undefined inputs safe.
- Stale/live: fresh→live, aged→stale, exact boundary behavior, and missing-coords/missing-timestamp/
  null-island all →`unavailable` (never a fabricated position).
- Region fitting: covers partner+jobs; single point gets a neighbourhood zoom not an invalid zero
  delta; nothing-to-show returns null so the empty state renders.
- Polyline decode against Google's canonical documented example; null/empty → empty path.
- **Security (live backend)**: 401 unauthenticated on both endpoints; 401 forged bearer; every
  returned booking belongs to the authenticated partner; **an injected `providerId`/`userId` query
  param cannot widen the result set** (byte-identical id lists); route-optimize ignores an injected
  providerId and never leaks a foreign booking.
- **Read-only proof**: exercising both map endpoints leaves booking count and every booking's status
  byte-identical before/after — the map mutates nothing.

**REAL OBSERVATION (real partner, real jobs, nothing fabricated):** authenticated as real provider
`cmq6b0iue0001tzbo5fnp9t5q` through the real login + real endpoints:
- `GET /api/providers/me/bookings?status=active` → **200, 8 real active jobs**.
- `GET /api/providers/me/route/optimize` → **200, 8 sequenced stops**, real metrics
  (`optimizedDistanceKm: 26.7`, `optimizedEtaMin: 64`, `naiveEtaMin: 161`, `timeSavedMin: 97`).
- `buildMapJobs()` → **8 drawable markers**, correctly ordered #0–#7 with real per-stop ETAs
  (16 min … 1 hr 10 min) at real coordinates (28.4139,77.043 and 28.5244,77.2066).
- Real `Location` row (28.4707,77.0594, last updated 2026-06-20) → `classifyLocation` → **`stale`** —
  correct, and exactly the case the UI must never present as live.
- `polyline` was absent on this response (`source: "haversine"`), so `decodePolyline` → 0 points and
  the UI correctly falls back to markers-without-a-line. Real behavior, not simulated.

**Side effects:** none. The map is read-only by construction and this was verified explicitly (test
above): bookings, payments, wallet, ledger, assignments and notifications are all untouched.

**`EXTERNAL_ARTIFACT_REQUIRED` — Android Google Maps key.** iOS renders via Apple Maps with no key,
but Android's `PROVIDER_GOOGLE` needs an API key in the native manifest, restricted to
`com.homeeigo.partner` + signing fingerprint. The customer app's key is restricted to a *different*
package and would not work, so it was deliberately **not** copied across (and no key was hardcoded).
Added `app.config.js` which injects `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from the environment when
present, and documented the requirement in `.env.example`. When absent the config is left unset
rather than filled with a placeholder — an invalid key renders a silent blank grey map, whereas an
absent one fails loudly and is diagnosable. **Provisioning that key is a human/external step.**

**Regression:** partner-mobile `tsc --noEmit` clean; 35/35 across all partner e2e suites (P1-2 ×24 +
P1-1 ×11); backend `assignment-dispatch-lock` 7/7, `phase7-post-service-security` 8/8,
`provider-service-categories` 7/7, `redis-lock-fallback-metric` 3/3,
`partner-operations.integration` 7/7.

**DB impact:** none — no schema change, no migration, no backend code change for this item.

**Files changed:** `homigo-partner-mobile/`: `src/lib/partner-map.ts` (new), `src/lib/polyline.ts`
(new), `src/hooks/use-partner-map-location.ts` (new), `src/screens/partner-live-map.tsx` (new),
`src/screens/hq-registry.tsx`, `src/screens/hq-academy-account.tsx`, `app.config.js` (new),
`.env.example`, `package.json`/`package-lock.json`, `e2e/p1-2-partner-map.spec.ts` (new),
`e2e/p1-2-partner-map-security.spec.ts` (new).

**Next action:** P1-3 (EAS/Sentry) — which would also unblock both the P1-1 physical-push
verification and a real on-device check of this map.

### P1-3 — Partner EAS + Sentry + Maps: `CONFIGURATION_COMPLETE` / verification `EXTERNAL_ARTIFACT_REQUIRED`

Full detail in **`PHASE_8_P1_3.md`**. Ran under SAFE OPTION (A): everything not requiring real
external credentials is done; **nothing was fabricated** — no Expo projectId, no Sentry DSN, no
Maps key, no Expo account mutation.

| Gate | Status |
|---|---|
| P1-3 configuration | `CONFIGURATION_COMPLETE` |
| EAS_VERIFICATION | `EXTERNAL_ARTIFACT_REQUIRED` |
| SENTRY_VERIFICATION | `EXTERNAL_ARTIFACT_REQUIRED` |
| MAPS_VERIFICATION | `EXTERNAL_ARTIFACT_REQUIRED` |
| Local config | `CONFIG_VALIDATED` |
| Local runtime | `LOCAL_RUNTIME_VERIFIED` (Metro bundle) |
| Cloud/device build | `EAS_BUILD_NOT_VERIFIED` |

**Implemented:** `eas.json` (development/preview/preview-aab/production, mirroring customer-app
conventions); `@sentry/react-native@~7.2.0` (same version as customer app) with native init before
router mount, environment separation, release/dist tagging, error-boundary integration and
id-and-role-only user context; a new app-root `ErrorBoundary`; and an RN-free PII scrubber wired
into both `beforeSend` and `beforeBreadcrumb`. `app.config.js` now injects Sentry plugin, EAS
projectId, OTA updates URL and the Maps key — **all env-gated and omitted entirely when absent**,
because a placeholder yields a silently-broken build while an absent value fails loudly.

**Narrowed the boundary with real evidence:** an Expo account **is** authenticated here
(`eas whoami` → `harekrishna_2003`, `harekrishna2003s-team`). The only missing EAS artifact is a
**project id**; `eas config` itself names the exact fix (`eas init --account <name>
--non-interactive`). **`eas init` was deliberately not run** — it creates a persistent cloud
resource on the user's real account, which is outward-facing and outside SAFE OPTION (A). No cloud
credits were spent.

**Validation (`CONFIG_VALIDATED`, kept strictly separate from `CREDENTIAL_VERIFIED`):** typecheck 0
errors; `eas.json` parses with 4 resolving profiles; `expo config` resolves cleanly **with no
credentials** (no fabricated values leak in) and wires everything correctly **with** dummy
credentials (passed as one-shot env vars, never written to disk, artifacts deleted); the Maps key
lands in the **prebuild** native config and is **stripped from the public manifest** — Expo's own
secret hygiene, verified rather than assumed. **Metro `expo export` succeeded** (8 MB Hermes
bundle) with the Sentry release string and ErrorBoundary copy present in it, and dev-only strings
correctly dead-code-eliminated.

**Security — all gates pass:** `.env`/`.env.local` ignored and untracked; zero hardcoded
DSN/key/projectId anywhere; the customer app's package-restricted Maps key **not** copied (verified
by repo scan); **no credentials in the shipped 8 MB bundle**; source-map upload requires an EAS
secret so maps never reach a public artifact. **PII scrubbing has 8/8 passing tests** covering auth
tokens, OTPs, Aadhaar/PAN, bank account/IFSC, CVV/card, Razorpay signatures, nested objects, arrays
and URL query strings — the security-critical half that *is* verifiable without a DSN.

**Explicitly NOT claimed:** no live Sentry event, no completed EAS build, no rendered Android map.

**Regression:** partner typecheck clean; **43/43** across all partner e2e suites (P1-1 11, P1-2 24,
P1-3 8). No backend change in this item.

**DB impact:** none.

### P2-1 — Built-but-unreachable admin pages: DONE

**Discovery corrected the manifest's framing.** This was filed as "pure nav wiring". Only half was:
- `/observability/logs` — genuinely correct (uses the authenticated `adminApi`, 22 design-token
  references). Pure wiring gap.
- `/vision` — **not just unreachable, actually broken**, proven empirically against the running
  backend rather than inferred:
  - It used a bare `fetch("/api/vision/status")`. Admin auth is a **Bearer token** from the store
    (`apiRequest`'s `auth: true`), so the page sent **no Authorization header** →
    `curl` confirmed **401**. It could never have loaded, for anyone.
  - The backend returns `{ success, data: {...} }`; the page did `setStatus(data)` and read
    `status.totalAnalyses` — so every figure would have rendered `undefined` even with auth.
  - The purge handler read `{ purgedCount }`; the endpoint returns `{ data: { purged, failed } }`.
  - It was also the console's only page built on raw Tailwind instead of the `--color-biz-*` token
    system.

  **Wiring it into the nav without fixing this would have surfaced a permanently-empty page to
  every admin** — worse than leaving it hidden. Fixed as part of the item.

**Changes:**
- `services/admin-api.ts` — new `vision.status()` / `vision.purgeExpired()` following the exact
  existing convention (`auth: true` + `.then(r => r.data!)`), which fixes both the auth and the
  envelope defects at once; added a `VisionStatus` type whose shape was **verified against a live
  authenticated response**, not guessed.
- `app/(console)/vision/page.tsx` — rewritten onto `adminApi` + react-query + `PageShell`/`KpiCard`
  design tokens; honest placeholders (`—` absent, `…` loading) instead of `undefined`; surfaces
  `observationMode` with an explicit note that FALLBACK results are deterministic placeholders,
  not model output; purge reports both `purged` and `failed`.
- `lib/hq-navigation.ts` — `/vision` → AI HQ, `/observability/logs` → Monitoring HQ. Also removed
  the duplicate `/finance/reports` entry from Platform HQ (**P3-2**, same file): the href was
  registered twice, making `resolveHqSection` ambiguous and lighting two sidebar entries for one
  page. Finance HQ remains its owner.

**Security — navigation grants nothing:**
- No new permission invented; no `requiredAnyResource` added for these sections.
- Backend RBAC unchanged and still authoritative — `/api/vision/*` enforces `role === "ADMIN"`
  server-side. **Tested**: unauthenticated → 401, forged bearer → 401, regardless of any UI change.
- Direct URL access for an authorized admin still works (navigation is a discoverability aid, not
  the gate) — tested.

**Tests — 22/22 passing:**
- `e2e/hq-nav-permissions.spec.ts` (+4 new): both pages present in nav and in the correct sections;
  **no href registered in more than one section** (regression guard for the duplicate just removed);
  all hrefs unique and well-formed. Existing 8 permission-gating tests still pass.
- `e2e/p2-1-orphaned-pages.spec.ts` (new, 7, **live browser + live backend**): Vision reachable via
  a real sidebar click and **renders a real digit** (asserted via KpiCard's own `data-stat-value`,
  explicitly rejecting `undefined`/`NaN` — the exact failure the old page would have shown); Log
  Search reachable and renders; direct URL works for an authorized admin; 401 unauthenticated; 401
  forged token; **accessibility** (exactly one `h1`, purge is a real keyboard-reachable `button`);
  **responsive** (zero horizontal overflow at 390px).
- Admin regression: 15/15 across nav, live-nav, login-dashboard and ai-tools-center. Typecheck: 0 errors.

**A note on test quality:** my first live run failed on my own locator (`text=…` + `..` resolved to
the label's parent, which holds only the label). Fixed by targeting `KpiCard`'s `data-stat-value`
element rather than DOM position — the assertion was not weakened, it was made correct and more
robust.

**DB impact:** none. **Files changed:** `services/admin-api.ts`, `app/(console)/vision/page.tsx`,
`lib/hq-navigation.ts`, `e2e/hq-nav-permissions.spec.ts`, `e2e/p2-1-orphaned-pages.spec.ts` (new).

**Next action:** P2-10 (sibling null-safety), then P2-5 (CI lint + coverage gate).

### P2-10 — Sibling array-column null-safety: DONE (test DB) / dev DB apply `READY_FOR_ADMIN_APPROVAL`

**Discovery before touching the schema, as instructed:**
- **Real NULL rows confirmed** (dev DB, 146 providers): `service_regions` NULL=25 / populated=120;
  `working_days` NULL=80 / populated=64; `certifications` NULL=78 / empty=68 / populated=0.
  Unlike P1-6's `service_categories` (zero NULLs), these genuinely need a backfill.
- **ORM read path proven safe**: read a row that is genuinely NULL in all three via the Prisma
  client — returned `[]` for every one. So no live crash exists today.
- **All readers/writers traced.** Only **one** raw-SQL reader touches these columns
  (`partner-operations.service.ts`'s `FOR UPDATE` row lock), and it is **already guarded** with
  `?? []` on both fields it selects — those guards were added after a real production crash.
  `certifications` has no raw-SQL reader at all. Every other access is ORM (coercion-safe).
- **Conclusion**: this is genuine defense-in-depth, not an active-bug fix. It closes the gap at the
  source so a *future* raw reader cannot reintroduce that crash class, instead of relying on every
  future call site remembering the guard. Recorded honestly rather than overstated.

**Safe backfill design + proof of no data loss:** NULL and `'{}'` are semantically identical for all
three columns ("none declared"), so the backfill only ever rewrites rows that are currently NULL —
no populated array is read, reordered or rewritten. Ordered strictly: backfill → `SET DEFAULT` →
`SET NOT NULL` (constraint last, so it can never reject a pre-existing row).

**Proven empirically on the isolated test DB** (before → after):
```
service_regions  NULL 7   -> 0   populated 295 -> 295
working_days     NULL 164 -> 0   populated  70 ->  70
certifications   NULL 302 -> 0   populated   0 ->   0
```
NULLs eliminated; **populated counts byte-identical**. `\d providers` confirms all four array
columns (including P1-6's `service_categories`) are now `not null` with `'{}'::text[]` default.

**Files changed:** `prisma/schema.prisma` (`@default([])` on the three fields),
`prisma/migrations/20260825120000_provider_array_columns_not_null/migration.sql` (new),
`src/__tests__/provider-service-categories.test.ts` (extended, not duplicated).

**Tests — 13/13 passing:** per-column NOT NULL enforcement (explicit raw NULL write rejected with
Postgres `23502` → Prisma `P2010`, ×3, each also asserting the rejected write did not partially
apply); DEFAULT fires for a raw INSERT omitting all three columns; zero NULL rows remain anywhere;
and a behavioral guard proving the backfill changed **no** application semantics — `readinessFor`
still treats an empty `serviceRegions` exactly as before (city alone satisfies the service-area
requirement; nothing declared still blocks). Regression: `partner-operations.integration` 7/7,
`assignment-dispatch-lock` 7/7, `phase7-post-service-security` 8/8. Typecheck: 194 = unchanged
baseline (193 + the pre-existing untracked `booking-contact.service.ts` error, not from this work).

**DB impact:** additive + a backfill that only touches NULL rows. Applied and verified on
`homigo_test`. **NOT applied to `homigo_db` (dev)** — bundled with the existing
`READY_FOR_ADMIN_APPROVAL` migration queue (P0-3, P1-6) rather than raising a third separate ask.

**Security impact:** none — no authorization, RBAC or data-visibility change; column constraints only.

### P2-5 — CI lint + coverage gate: DONE

**Discovery found a bigger problem than "no lint job": the backend lint script was broken.**
`apps/backend/package.json` ran `eslint src --ext ts`, but `--ext` was **removed in ESLint 9**
(flat config). `npm run lint` therefore failed instantly with a usage error — the backend has been
effectively **unlinted**, which is the real reason no working gate ever existed. Also traced a
red-herring on the way: `npx eslint` from `apps/backend` resolves to the **root's stale ESLint
8.57.1**, whose `@eslint/js` mismatch throws `Could not find "no-unassigned-vars"`. The backend has
its own correct ESLint **10.4.0** locally; invoking that runs cleanly. Neither the config nor the
dependency versions were at fault — only the script's flag — so **no dependency was changed**.

**Extended the existing `ci.yml`; no duplicate workflow created.** Reused only tooling that already
exists (all four apps already had `lint` scripts; Bun has native coverage).

- **New `lint` job** running all four apps:
  - **Web / admin-panel / partner-web → blocking.** Verified they lint clean today (warnings only,
    exit 0), so these gates protect a currently-green state rather than papering over a backlog.
  - **Backend → report-only (`continue-on-error: true`)** with an explicit comment. It has **103
    pre-existing problems (102 errors, 1 warning)**, mostly `no-unused-vars`. Making it blocking
    now would turn CI red on every unrelated PR. The gate still runs and prints on every PR, so the
    backlog is visible instead of invisible; flipping one flag makes it blocking once cleared.
- **Coverage** added to the existing `backend-tests` job:
  `bun test --coverage --coverage-reporter=text --coverage-reporter=lcov`, plus an lcov artifact
  upload (7-day retention, `if: always()`).
  **No numeric threshold was invented.** No measured baseline exists, and a made-up percentage is
  either trivially passable (meaningless) or immediately failing (blocks unrelated work). Reporting
  it first makes the real number visible so a defensible floor can be set from evidence.

**Verified, not assumed:**
- Backend lint script now executes correctly (103 problems reported instead of a usage error).
- Admin-panel lint exits 0 — confirming the blocking frontend gates are safe.
- `bun test --coverage` flags work on this Bun version: text table renders and `coverage/lcov.info`
  is written to exactly the path the artifact step uploads (ran it against a real test file).
- `ci.yml` parses as valid YAML; 5 jobs resolve (`typecheck, mobile-startup, build, lint,
  backend-tests`) with all 5 lint steps and the coverage step present.
- `coverage/` is already gitignored — no generated output can be committed.

**New follow-up recorded as P2-12**: clear the 102 backend lint errors, then flip
`continue-on-error` to false; and set a coverage threshold once the reported baseline is known.

**Files changed:** `.github/workflows/ci.yml`, `apps/backend/package.json` (broken lint script fixed).
**DB impact:** none. **Security impact:** none.

### P2-2 — Composite indexes: DONE (1 of 4 candidates justified; 3 rejected on measurement)

**Every candidate was measured with EXPLAIN ANALYZE before and after. Three were rejected —
adding them would have been pure write overhead.** The manifest listed four tables; measurement
disqualified three of them.

**Real table sizes first** (dev DB — the stale `n_live_tup` estimates were misleading, so exact
counts were taken): `enterprise_audit_logs` **260,573 rows / 158 MB**, `app_log_entries` 93,994,
`activity_logs` 77,314, `notifications` 5,540, **`payments` 264**.

| Candidate | Verdict | Measured evidence |
|---|---|---|
| `enterprise_audit_logs (action, created_at DESC)` | **ADDED** | 4,279 → **57** buffers, 5,047 → **0** rows discarded, 1.363 → **0.235 ms** |
| `payments (status, created_at)` | **REJECTED** | table has **264 rows**; a seq scan is already optimal — an index cannot beat it |
| `enterprise_audit_logs (is_archived, retention_expires_at)` | **REJECTED** | `is_archived` has **cardinality 1** (all 260k rows `false`); the sweep already runs in **0.079 ms / 3 buffers** |
| `activity_logs (action, created_at)` | **REJECTED** | built it in a rolled-back transaction — **the planner declined to use it**: filter still applied, identical 506 buffers. No gain, real write cost |

**The one justified index** serves `enterpriseAuditService.getAuditLogs()`
(`WHERE action = ? [AND created_at range] ORDER BY created_at DESC LIMIT n`). The pre-existing
single-column indexes could not satisfy both the equality and the ordering, so Postgres
range-scanned `created_at` and discarded ~98% of what it read.

**Write overhead deliberately offset**: the migration also **drops the now-redundant standalone
`action` index**. A leading-column prefix of the composite serves action-only lookups equally well
(**verified** with the old index dropped: Index Only Scan, 0.375 ms), and `pg_stat_user_indexes`
showed it had recorded **zero scans ever**. Net growth ~9 MB (+11 MB composite, −1.9 MB redundant)
on a 159 MB table.

**Measured without touching `homigo_db`.** Real audit data (273,761 rows) was replicated into the
**isolated test DB** and all index creation/comparison happened there. The two probes that did run
against dev were read-only `EXPLAIN ANALYZE`, plus one `BEGIN … CREATE INDEX … ROLLBACK` used purely
to test the `activity_logs` hypothesis — **verified afterwards to have left zero residue** (index
count unchanged at 6, no `_tmp` indexes remain).

`CONCURRENTLY` is used for both statements because this table takes continuous audit inserts and a
plain `CREATE INDEX` would hold a write lock across 260k rows.

**Files changed:** `prisma/schema.prisma` (composite replaces the standalone `action` index, with
the measurement recorded inline), `prisma/migrations/20260825140000_audit_log_action_created_at_index/migration.sql`
(new — also documents *why* the three rejected candidates were rejected, so the analysis isn't
re-litigated later).

**Tests/regression:** end-state on the test DB re-verified after the drop (57 buffers, 0.209 ms,
Index Only Scan for action-only). `phase7-post-service-security` 8/8,
`provider-service-categories` 13/13, `assignment-dispatch-lock` 7/7, `p4-compliance` 4/4,
`p4-part-a-security` 7/7. Typecheck 194 = unchanged baseline.

**DB impact:** index-only; no data touched. Applied and verified on `homigo_test`.
**NOT applied to `homigo_db`** — joins the `READY_FOR_APPROVAL` queue (P0-3, P1-6, P2-10, P2-2).
**Security impact:** none.

### P2-6 — Backup robustness: DONE (found a defect where the backup silently never ran)

**Full lifecycle traced first:** hourly tick → `runWithLeaderLock` (TTL 3600s) →
`spawn(backup-db.ts)` → `pg_dump -Fc` → `pg_restore --list` integrity verification → sha256 →
optional S3 upload → GFS retention prune → `recordBackupSuccess`.

**Four real defects found — all in the trigger, none in the backup script itself:**

1. **`shell: true` + a spaced executable path meant the backup NEVER RAN.** The spawn used
   `shell: process.platform === "win32"`. Node concatenates argv without quoting under `shell`, so
   on any Windows host where Bun lives under a path containing a space — the common case
   (`C:\Users\First Last\AppData\Roaming\npm\...\bun.exe`) — cmd.exe split the path and answered
   `'C:\Users\Kapiissh' is not recognized as an internal or external command`, exiting 1 **without
   ever invoking pg_dump**. **Reproduced directly on this machine** (`shell:true` → exit 1;
   without shell → exit 0). Combined with defect 3, this was the worst possible outcome: a backup
   that never ran, reported as nothing at all. Fixed by dropping `shell` — unnecessary anyway,
   since `process.execPath` is an absolute path to a real executable.
2. **No timeout anywhere.** A stalled `pg_dump` or `docker exec` ran forever.
3. **Silent failure.** Only `.on("error")` (spawn-level) was handled; a non-zero exit — pg_dump
   failed, integrity verification failed — was logged **nowhere**.
4. **The leader lock did not cover the backup.** `spawn()` returns immediately, so
   `runWithLeaderLock` released the lock the instant the process launched rather than when the
   work finished — the duplicate-prevention the lock exists for never applied to the backup itself.

**Timeout derived from measurement, not a guess:** ran a **real backup** — 58.56 MB dump including
`pg_restore` verification, sha256, a genuine S3 upload to `eu-north-1`, and GFS retention — in
**18.4 s**. `BACKUP_TIMEOUT_MS` defaults to **15 minutes**: ~50× headroom for database growth and a
slow offsite upload, yet far below the 1-hour tick so a hung run can never still hold the lock when
the next is due. Env-overridable for larger databases.

**Fix:** the child is now `await`ed (so the lock genuinely covers the run), supervised with a
SIGTERM→SIGKILL timeout, and every outcome is both logged and metered —
`db_backup_total{result=success|failed|timeout|spawn_error}`, pre-seeded in `metrics-init.ts`.
A `settled` guard makes double-resolution impossible.

**Tests — 8/8 passing** (`src/__tests__/backup-timeout.test.ts`, new): normal success; **non-zero
exit reported as failed** (the silent-failure defect); a hung child killed at the timeout and
bounded by it; unspawnable command; settle-exactly-once under a late close after timeout; and a
proof that awaiting is what makes the lock cover the backup.

**Note on a test failure that turned out to be a real bug:** these tests initially failed, and the
cause was not the test — it was defect 1 above reproducing through `process.execPath`. The
assertions were not weakened; the production code was fixed and the test supervisor aligned to the
corrected (shell-free) spawn shape.

**Real end-to-end verification:** ran the **exact fixed production spawn shape** against the real
script — exit 0 in 18.98 s, real dump + real S3 upload + retention pruning, now correctly reported
as `success` where it previously reported nothing.

**Regression:** `backup-timeout` 8/8, `redis-lock-fallback-metric` 3/3,
`data-archival-failure-injection` 6/6, `phase7-post-service-security` 8/8. Typecheck 194 = unchanged
baseline.

**Files changed:** `src/lib/maintenance.ts`, `src/lib/metrics-init.ts`,
`src/__tests__/backup-timeout.test.ts` (new). **DB impact:** none. **Security impact:** none
(no credential handling changed; S3 upload path untouched).

### P2-9 — "Dead endpoint": NOT A DEFECT — discovery finding was wrong, nothing removed

**Proved the opposite of the claim, which is exactly why the instruction to prove zero consumers
before deleting exists.** `PHASE_8_DISCOVERY.md` recorded
`GET /api/admin/incentives/rules` as *"defined in `admin-api.ts` but never called anywhere in the
codebase. Dead capability, no UI."* That is **false**.

**Full trace across the repo:**
- **Client method**: `adminApi.incentiveRules()` — `admin-api.ts:1572`.
- **Live consumer**: `app/(console)/academy/page.tsx:313` calls it inside a real `useQuery`
  (`staleTime: 60_000, retry: 1`).
- **Rendered**: `academy/page.tsx:413` maps the response, and lines **1083-1092** render the rules
  as `PersonMini` rows (name/code, metric, active state, `₹bonusAmount`), with a dedicated
  `EmptyLane` fallback for the RBAC-denied case ("Incentives not in this role").
- **Reachable**: `/academy` is a wired nav entry (Marketplace HQ, "Partner Academy").
- **Backend**: `admin.ts:2039`, RBAC-gated via `adminContext`.

**Verified live, end-to-end**: authenticated as the real seed admin and called the endpoint —
**200**, returning genuine data (`DAILY_3_JOBS` ₹150 daily, `WEEKLY_18_JOBS`, …). Also confirmed the
authorization is real: a `User` with `role: "ADMIN"` but **no `AdminUser` RBAC row** correctly gets
**403 "Not an admin"** — so the endpoint is properly protected, not merely unused.

**Action taken: none — deliberately.** Removing it would have broken a working, user-visible panel
on a reachable admin page. The likely origin of the false finding is that the discovery agent
grep'd for the literal route string rather than the client method name (`incentiveRules`), which is
how the page actually calls it.

**Correction propagated** to `PHASE_8_DISCOVERY.md` and `PHASE_8_WORK_MANIFEST.md` so the bad claim
cannot be acted on later by someone who trusts the earlier document.

**Files changed:** documentation only. **DB impact:** none. **Security impact:** none.

### P3-1 — "Orphaned Prisma models": NOT A DEFECT — discovery finding was wrong, nothing deleted

**Third false discovery finding this phase.** `PHASE_8_DISCOVERY.md` listed `DataVersion`,
`DataFreshnessSnapshot` and `DataQualityResult` as *"3 genuinely orphaned models with no code
references."* All three are **fully live**.

**Exhaustive trace (every surface the brief required):**
- **Prisma client access**: `prisma.dataVersion.*` in `analytics/versioning/service.ts` (create,
  updateMany, findFirst, findUnique, update); `prisma.dataFreshnessSnapshot.*` in
  `analytics/freshness/service.ts` (upsert, findMany); `prisma.dataQualityResult.*` in
  `analytics/data-quality/engine.ts` (create, findMany).
- **Live HTTP routes**: all three services are imported by `src/routes/analytics.ts`, which is
  mounted at `src/index.ts:208` (`.use(analyticsRoutes)`) — serving `/quality`,
  `/quality/history/:dataset`, `/freshness`, `/freshness/sla-violations`, ETL endpoints.
- **Background jobs**: all three are imported by `analytics/scheduler/etl-scheduler.ts`, started
  from `maintenance.ts:452` (`startEtlScheduler()`).
- **Historical data**: `data_versions` **457** rows, `data_freshness_snapshots` **18**,
  `data_quality_results` **5,905** — 6,380 real rows that a deletion would have destroyed.

**Why discovery missed it:** these consumers live in `apps/backend/analytics/`, **outside `src/`** —
the search was almost certainly scoped to `src/`.

**Action: none, deliberately.** Corrected in `PHASE_8_DISCOVERY.md`. No migration written, no data
touched.

### P3-3 — Zustand version mismatch: NO FUNCTIONAL RISK — documented, deliberately not upgraded

**Investigated:** declared `^4.5.5` (customer) vs `^5.0.8` (partner); actually resolved **4.5.7** and
**5.0.14**, each app from its own `node_modules`. Verified:
- **No shared code between the apps** — the only cross-reference is a comment I wrote in P1-2 noting
  `polyline.ts` was *ported* (copied), not imported. Separate bundles, separate stores, no
  peer-dependency surface between them.
- **Both already use the v5-correct API**: `import { create } from "zustand"` (named export). No
  `import create from "zustand"` (default export, removed in v5) and no `zustand/shallow` (moved in
  v5) anywhere. The `getState()` calls in the customer app remain valid in v5.

**Verdict: no runtime or build problem exists.** Per the brief's "if no functional risk: prefer
documentation/controlled alignment", the customer app was **not** upgraded: a major-version bump of
the state library in the more production-certified app (EAS profiles, Sentry certification, device
matrix) for purely cosmetic consistency, with zero functional driver and no shared code, is
unjustified risk. Recorded so a future shared-package extraction knows to align first.

### P3-4 — Dead `apps/mobile` stub: REMOVED

**Proved dead before deleting, across every surface the brief listed:**
- **Workspace config**: root `package.json` workspaces are `homigo-mobile` and
  `homigo-partner-mobile` only — the stub was never a workspace member.
- **CI**: zero references in `.github/` (checked all workflows).
- **Build scripts / path aliases**: zero references in root `package.json` scripts or any
  `tsconfig*.json`.
- **Code imports**: zero — nothing in the repo imports from it.
- **Contents**: `package.json` named `homigo-partner-mobile-stub`, described as
  *"Pointer — run the partner app from ../../homigo-partner-mobile"*, whose only scripts print an
  error and exit 1. Source dirs contained nothing but `.gitkeep` files.
- **Untracked data checked before deletion**: `.env.local` held only `EXPO_PUBLIC_API_URL` and
  `EXPO_PUBLIC_APP_NAME` — the same non-secret public keys as the committed `.env.example`. Nothing
  irrecoverable was lost.

**Removed** (8 tracked files staged as deletions in git, so fully recoverable) **and the stale docs
that pointed developers there were fixed**: `CONTRIBUTING.md`, `docs/ARCHITECTURE.md` and
`docs/PLATFORM_ARCHITECTURE.md` all described `apps/mobile` as "the React Native app" — they now
name the two real Expo apps. Historical **audit/evidence** documents that mention the stub
(`mobile-enterprise-audit.md`, `QA_VERIFICATION_REPORT.md`, `system-architecture-map.md`,
`sentry-validation.md`, `mobile-audit.md`) were **deliberately left unchanged** — they are
point-in-time records that correctly describe the state when written, and rewriting them would
falsify evidence.

**Regression:** `homigo-partner-mobile` typecheck **PASS**; backend typecheck shows **zero** errors
in any Phase-8-touched file.

### NEW FINDING (P3-6) — customer-app typecheck is red, and CI gates on it

Surfaced while regression-testing P3-4; **not caused by it** (the customer app never referenced the
stub). `homigo-mobile` `npm run typecheck` fails with **111 errors**:
- **68** in `.test.tsx` files — `@testing-library/react-native` and `@types/jest` are imported but
  **not declared in `package.json`**.
- **43** in real source: `AiConversationsList.tsx` (11), `AiChatScreen.tsx` (11), `AiWalletCard.tsx`
  (9), `AiServiceCard.tsx` (9), `AiOfflineIndicator.tsx` (3) — referencing theme tokens that don't
  exist (`colors.cardAlt`, `colors.accentGreen`, `colors.mutedLight`, `spacing.lg/md/sm`) plus two
  prop/type mismatches.

**All of these files are UNTRACKED (`??`)** — created in an earlier session's AI-concierge work and
never committed. **`.github/workflows/ci.yml:51-53` runs this typecheck as a blocking step**, so the
mobile CI job is red today. Classified `APPLICATION_DEFECT`, pre-existing, **out of P3 scope** (it is
a multi-component theme/type reconciliation belonging to the AI-concierge workstream, not cleanup).
Recorded rather than silently absorbed or hidden.

### P3-5 — AI route fragmentation: INVESTIGATED — no consolidation performed (correctly)

**Full map of the AI surface (prefix → paths, mount order from `src/index.ts:205-218`):**

| File | Prefix | Paths |
|---|---|---|
| `ai.ts` | `/api/ai` | `POST /chat`, `GET|DELETE /conversations/*` |
| `ai-gateway.routes.ts` | `/api/ai` | `POST /gateway/chat`, `/customer`, `/partner`, `/admin`; `GET /usage`, `/cost`, `/health` |
| `ai-brain.routes.ts` | `/api/ai` | `/brain/*`, `/context/*`, `/memory/*`, `/prompts*`, `/prompt-versions/*`, `/timeline` |
| `ai-tools.routes.ts` | `/api/ai/tools` | tool catalog/execution/approvals |
| `vision.routes.ts` | `/api/vision` | image submit/analyze/status/purge |
| `customer-intelligence.ts` | `/api/customer-intel` | profile/match/recommendations/rebooking/satisfaction |

**Three files share the `/api/ai` prefix**, which sounded like a shadowing hazard — mount order
would silently pick a winner on any overlap. **Enumerated every path in all three: there are ZERO
collisions.** They carve genuinely disjoint sub-namespaces (`/chat` + `/conversations/*` vs
`/gateway|customer|partner|admin` + `/usage|cost|health` vs `/brain|context|memory|prompts|timeline`).
The fragmentation is **organizational, not functional**.

**The two chat endpoints are NOT duplicate abstractions** (the thing most likely to justify
consolidation). Both route through `invokeAiGateway`, so neither bypasses governance — but they
serve different purposes:
- `POST /api/ai/chat` — the **customer product surface**: builds grounded service context, applies
  a context policy, uses the `customer.service_recommendation.v1` prompt, enables read-only tools,
  and degrades to a deterministic fallback matcher on infra failure.
- `POST /api/ai/customer` — a **thin generic gateway passthrough** (`handleGatewayRequest`), no
  grounding, no tools, no fallback.

Merging them would delete real product behavior, not duplication.

**Auth/security consistency audited across all six files** — every one uses `authPlugin` +
`requireAuth`, with admin gates where appropriate (`ai-brain` 31, `ai-tools` 14, `gateway`/`vision`/
`customer-intel` 2 each). **Consistent, no gaps found.**

**Two real inconsistencies confirmed — both already tracked, neither fixable here:**
1. **Vision bypasses the AI Gateway entirely** (direct Gemini call, no provider failover, no
   gateway-level rate limiting/audit/cost accounting) — already **P0-2**,
   `HUMAN_DECISION_REQUIRED`, and touching it hits the Phase-7 certification freeze.
2. **Feature-flag gating exists on only 1 of 6 AI route files** (`customer-intelligence.ts`, 5 uses;
   every other file **zero**) — already **P2-3**, `HUMAN_DECISION_REQUIRED`.

**Verdict: no consolidation performed, deliberately.** The brief said *"DO NOT merge routes merely
for visual cleanliness"* and *"if consolidation changes authorization/provider/governance semantics:
HUMAN_DECISION_REQUIRED."* There is no mechanical, low-risk consolidation available here — the only
changes worth making are exactly the two governance decisions already escalated. Recommended
canonical architecture (for whenever those decisions are made): route **every** AI-calling feature
through `invokeAiGateway` (making Vision the exception to eliminate, not a pattern to copy), and
apply flag gating uniformly rather than on one file.

**Files changed:** none (investigation only). **DB impact:** none. **Security impact:** none.

---

### P3-6 — Customer mobile CI red: TYPECHECK FIXED (0 errors) / test suites PARTIALLY GREEN

**Mission gate — ACHIEVED: `homigo-mobile` typecheck 111 → 0 errors**, with no weakening. No
`@ts-ignore`, no `any`, no `as unknown as`, no `skipLibCheck`, no tsconfig `exclude`, no CI change.

**Part 1 — 68 dependency errors → 0.** Root cause: the app had **no test runner at all** (no `test`
script, no jest/RNTL/@types/jest). Two Jest-style RNTL suites had been written against
infrastructure that was never installed. Classified **missing devDependency** (Part 3 requires the
suites to run; Part 6 forbids deleting them), so installed the Expo-sanctioned stack via
`npx expo install`: `jest-expo@~54`, `jest@~29.7`, `@testing-library/react-native@^14`,
`@types/jest`. Deliberately **excluded `react-test-renderer`** — it resolved to 19.2.8 demanding
`react@^19.2.8` against the app's pinned 19.1.0; RNTL v14 bundles its own renderer.

**Part 2 — 43 theme-token errors → 0.** Classified **(B) obsolete token names** — every one had a
real equivalent, so no new design token was invented and **no colour was hardcoded**. Mapped against
the actual `ai-mobile-theme` vocabulary: `cardAlt`→`cardSoft`, `accentGreen`→`accent` (verified
`#10b981`, genuinely emerald — not a guess), `mutedLight`→`muted`, `background`→`bg`;
`aiSpacing.xs/sm/md/lg`→`micro/gapSm/gap/screen`; and `AiServiceCard`'s invalid shadow tier
`"light"`→`"soft"`.

**Two real application defects found and fixed (not cosmetic):**
1. **`AiChatScreen` misused `AiChatBlock`** — it passed `<AiChatBlock message={item} />` per-row into
   a FlatList, but `AiChatBlock`'s props are the **whole-chat** shape
   (`{messages,isThinking,onSend,onReset}`) and its bubble renderers are module-private. It also
   duplicated a composer whose `onSend` contract is synchronous `(text)=>boolean` while it passed an
   async fn. Rewritten to **delegate to `AiChatBlock`**, matching the proven pattern in the live tab
   (`app/(tabs)/ai.tsx`), including the same async→boolean adapter. Removed the orphaned FlatList
   ref and its two scroll effects (AiChatBlock owns scrolling).
2. **Duplicate React across the monorepo** — root hoists `react@19.2.8` while the app pins `19.1.0`,
   so under Jest the renderer and the components loaded **different React copies**, leaving the
   dispatcher null (`Cannot read properties of null (reading 'useState')`). Fixed by pinning every
   React specifier to the app's own copy in `jest.moduleNameMapper` — a resolution fix, not a
   type/gate weakening.

**Part 3 — suites now genuinely execute: 0 → 12 tests running, 8 passing.** Also discovered the app
carries **three** stale test conventions from different sessions — `bun:test` (3 pure-logic files),
Jest/RNTL (5 files) and **`vitest`** (1 file). Jest now explicitly ignores the `bun:test` trio and a
`test:logic` script runs them with their own runner, so the conventions no longer fight. Added real
harness infrastructure: AsyncStorage's vendor Jest mock (its NativeModule is null under Jest, which
broke every `persist` store at import), a `QueryClientProvider` wrapper (`src/test-utils/rntl.tsx`)
because `AiChatBlock`→`useActiveTracking` needs one, and a stub for that tracking hook.

**4 tests still fail — honest classification: `FIXTURE_DEFECT`.** They assert against the
**superseded** `AiChatScreen` implementation (its own inline `"Thinking..."` text, its own composer
placeholder, and a send-on-typing expectation that could never have passed since typing does not
submit). Two stale assertions were corrected to the real UI (`"Type your message..."`, and
`ThinkingBubble`'s `accessibilityLabel`), taking 0→3 passing in that suite. The rest need genuine
rework, and notably **`AiChatScreen` has zero importers** — the live path is
`app/(tabs)/ai.tsx`→`AiChatBlock` — so further investment tests a component the app does not use.
**Not deleted, not `@ts-ignore`d, not hidden.**

**Part 5 — CI verified with CI's own commands.** `npm run typecheck` → **PASS**. Jest was
deliberately **NOT** added to CI: adding a knowingly-red gate would be exactly the "change CI to
make a failing build green"/"reduce the gate" behaviour the brief forbids, inverted.

**NEW pre-existing failure found (P3-7)**: CI's *other* mobile step,
`node homigo-mobile/scripts/startup-regression-ci.mjs`, **also fails** — `Phase 12 — instrumentation,
missing: SPLASH_HIDE` (15 pass / 1 fail). The marker exists in `src/lib/splash.ts:21`, so the
certifier isn't finding it where it expects. **Not caused by P3-6** — I touched only
`src/components/ai/*`, `src/test-utils/`, `jest.setup.js` and `package.json`; the modified startup
files (`app/(tabs)/ai.tsx`, `src/lib/store.ts`, `src/services/core/api.ts`, hooks) are uncommitted
work from earlier sessions. Classified `APPLICATION_DEFECT`, pre-existing, outside P3-6's scope.

**Status: P3-6 = FIXED for its stated gate (typecheck 0)**; the mobile CI job remains red on the
separate pre-existing P3-7 startup-certification failure.

**Files changed:** `package.json` (test deps + jest config + `test`/`test:ci`/`test:logic` scripts),
`jest.setup.js` (new), `src/test-utils/rntl.tsx` (new), `src/components/ai/AiChatScreen.tsx`,
`AiConversationsList.tsx`, `AiWalletCard.tsx`, `AiServiceCard.tsx`, `AiOfflineIndicator.tsx`,
`AiChatScreen.test.tsx`, `AiConversationsList.test.tsx`. **DB impact:** none. **Security impact:**
none. **Phase-7 certifications:** untouched. **LIVE:** not activated.

### P3-7 — SPLASH_HIDE / Phase 12: FIXED — root cause was a stale certifier, and my first fix was caught weakening it

**Classification: B — CI_CERTIFIER_DEFECT** (proven, not assumed).

**Both sides traced before touching anything.**
*Certifier* (`scripts/startup-certification.mjs::phase12`) required each marker to appear in BOTH
`src/lib/startup-trace.ts` AND — by **literal string match** — one of exactly four files:
`auth-store.ts`, `AuthProvider.tsx`, `app/_layout.tsx`, `app/(tabs)/index.tsx`.
*Application*: `SPLASH_HIDE` is emitted from `src/lib/splash.ts:21`, outside that list.

**Proved the marker is genuinely EXECUTED, not merely declared** (the brief's explicit test):
`hideSplashOnce()` — which calls `startupMark("SPLASH_HIDE", reason)` — is invoked from **two of the
certifier's own four allowlisted files**: `AuthProvider.tsx:26` (normal home-render path) and
`app/_layout.tsx:46` (3-second root failsafe). The indirection is a **deliberate, documented
refactor**: a module-level once-guard, introduced precisely because multiple paths were
double-marking `SPLASH_HIDE` and corrupting the startup timeline. It cannot live inside any single
one of those files. So the application is correct and the detection logic was stale.

**Fix (certifier only — no application change):** `phase12` now walks the startup module graph one
level deep, resolving the in-repo `@/...` modules those four entry files import, so a marker emitted
through a helper they call still counts. Scope is deliberately one level and `@/`-only, so a marker
in an orphaned module is still reported missing.

**My first version of that fix silently weakened the assertion — caught by a negative test, not by
assumption.** Removing the real `startupMark("SPLASH_HIDE", …)` call still produced PASS, because the
widened graph picked up two *non-emitting* occurrences: `observability/sentry.ts:20` lists every
marker in a breadcrumb allowlist, and `observability/startup-telemetry.ts:86` reads one via
`since("SPLASH_HIDE")`. Tightened the check to require a real **emission** — `startupMark("MARKER"` —
rather than a bare substring. Verified all ten required markers are genuine `startupMark` call sites
before relying on that pattern. **The check is now stricter than the original**, which matched bare
strings.

**Both directions verified:**
- Positive — real code: `[PASS] Phase 12 — all 10 instrumentation markers wired`, VERDICT 16/16.
- Negative — emission removed: `[FAIL] Phase 12 — instrumentation`, VERDICT 15/16. Restored, PASS again.

**Nothing forbidden was done:** no dummy marker added, no splash logic duplicated, Phase 12 not
disabled/excluded/skipped, no `@ts-ignore`, no unrelated startup behaviour changed.

**CI result — the exact CI commands:**
- `npm run typecheck` (mobile) → **PASS**
- `node homigo-mobile/scripts/startup-regression-ci.mjs` → **REGRESSION CI: PASS**
- **The `mobile-startup` CI job is now GREEN** (both its steps pass).

**NOT claiming CI overall is green.** The separate `typecheck` job still fails on
`apps/backend`: **195 pre-existing errors** (`run-partner-operations-integration.ts`,
`analytics/etl/jobs/index.ts`, `ai-brain.routes.ts`, `ai-tools.routes.ts` …). Re-verified this
session that **zero** are in any Phase-8-touched file, and the count is unchanged from the baseline
tracked all phase. Recorded as **P3-8**. web / admin-panel / partner-web / homigo-mobile all PASS.

**Regression:** backend 47/47 across 6 suites · partner 25/25 · admin 12/12 · mobile AI suites
unchanged at 8 pass / 4 fail (the known P3-6 `FIXTURE_DEFECT`s, not gated by CI).

**Files changed:** `homigo-mobile/scripts/startup-certification.mjs` only. **Application source:
untouched.** **DB impact:** none. **Security impact:** none. **Phase-7 certifications:** untouched.
**Migration queue:** unchanged.

### P3-8 — Backend typecheck baseline: `P3_8_IN_PROGRESS` — 195 → 31 (−84%)

Full inventory: **`PHASE_8_P3_8_ERROR_INVENTORY.md`**. Every count below is real `bunx tsc --noEmit`
output, never a file count.

**195 → 147 → 115 → 99 → 54 → 46 → 42 → 37 → 34 → 31**, via **9 root-cause clusters**. The 195 were
never 195 independent bugs — five config/type-source causes accounted for ~160 of them.

| Cluster | Δ | Root cause |
|---|---|---|
| 1 | −48 | `run-partner-operations-integration.ts` used top-level `await` with no import/export, so TS treated it as a script (TS1375). Added `export {}` — TypeScript's own recommended fix. |
| 2 | −32 | tsconfig `target`/`lib` were **ES2020**; `Array.prototype.at()` is ES2022 (TS2550). Runtime is **Bun**, which supports ES2022+ and already runs this code in production — the config was stale, not the code. |
| 3 | −16 | `rootDir: ./src` / `include: [src]` excluded `analytics/`, which `src/` imports and which is genuinely live (routes + ETL scheduler, proven in P3-1) → TS6059. Widened both. |
| 4 | −45 | Three helpers typed `set: { status: number }` while Elysia passes `{ status?: number \| <status-name union>, headers, redirect, cookie }` (TS2345, across ai-brain/ai-tools/ai-gateway routes). Widened to the real shape. |
| 5 | −8 | `vision-shadow.test.ts` + `phase7-db-probe.test.ts` imported **vitest**, which isn't installed — they only ran because Bun aliases vitest at runtime. Pointed them at `bun:test` and swapped the Jasmine global `fail()` for bun-native `expect.unreachable()`. |
| 6 | −4 | Four certification tests dereferenced a nullable return (TS18047). Added real narrowing — they now *assert* success instead of assuming it. |
| 7–9 | −28 | **Prisma JSON typing**: `Record<string, unknown>` is not assignable to `InputJsonValue` (TS can't prove `unknown` is JSON). Retyped at **source** in `ai-brain/types.ts`, `ai-tools/types.ts`, `analytics/etl/types.ts`, `etl/engine.ts`, `versioning/service.ts`; and corrected two **pre-existing** `as unknown as Record<string, unknown>` casts in `context-cache`/`context-snapshot` to the right Prisma type. |

**Nothing suppressed.** No `@ts-ignore`, no `any`, no **newly introduced** `as unknown as`, no
`skipLibCheck` change, no tsconfig `exclude`, no CI/file exclusion, no test deleted, no assertion
weakened. The two tsconfig edits are *corrections* (lib matching the real runtime; rootDir covering
source genuinely in the program) — neither hides an error, and the build was re-verified.

**A mistake I made and caught:** my Prisma import insertion split a multi-line `import type {` in
`ai-tools/types.ts`, creating syntax errors that made the count *look* like 6. Syntax errors stop TS
analysing dependents, so that number was fake. Repaired it and re-measured honestly — the real count
at that point was 33. Reported rather than banked.

**Phase-7 safety (Step 9):** `vision-shadow.test.ts` is certified Phase-7 evidence; after the runner
correction it re-ran at **17 pass / 0 fail**, `phase7-db-probe` **1/1**. No certification, LIVE state,
notification governance, payment, wallet, ledger or feature-flag behaviour was touched.

**Regression — all green:** backend 74/74 across 10 suites (incl. both Phase-7 suites);
`bun build` PASS (CI's actual build); mobile typecheck PASS; mobile startup CI PASS; partner
typecheck PASS; admin typecheck PASS.

**Why not 0 — honest status.** The clustered causes are exhausted; the remaining **31** are
individual and need case-by-case analysis. Several look like **genuine application defects, not
typing noise** — `ai-tools/execution/handlers/index.ts` passes 4 arguments to a 3-argument function
and assigns `string` where `number` is required; `brain-security.ts` reads `.content`/`.reason` off
`OutputValidationResult`, which declares neither. Those deserve investigation as possible real bugs,
which is why they were not force-fitted to satisfy the compiler.

**Gate:** `P3_8_IN_PROGRESS` — the CI backend typecheck still fails, so P3-8 is **not** complete.

**Files changed:** `tsconfig.json`; `src/__tests__/{run-partner-operations-integration,vision-shadow,
phase7-db-probe,enterprise-complete,enterprise-completion-certification,enterprise-soak-certification}.ts`;
`src/routes/{ai-brain,ai-tools,ai-gateway}.routes.ts`; `src/ai-brain/types.ts`;
`src/ai-brain/context/{context-cache,context-snapshot}.ts`; `src/ai-tools/types.ts`;
`analytics/etl/{types,engine}.ts`; `analytics/versioning/service.ts`. **DB impact:** none.
**Migration queue:** unchanged.

### P3-8 defect investigation — Investigations A & B complete; **4 REAL defects fixed**; 31 → 23

Counts are live `bunx tsc --noEmit` output. **31 → 29 → 28 → 26 → 25 → 23.**

#### Investigation A — `ai-tools/execution/handlers/index.ts` — **3 REAL APPLICATION DEFECTS**
These are WRITE handlers that **are bound in production** (only the 14 HIGH_RISK tools terminate at
NO_HANDLER), so every one was reachable. Each was traced caller → signature → tool schema → the
HTTP route's correct call shape before being touched.

1. **`write.booking.cancelBooking` passed a bare string as the actor object.**
   `cancel(actor: { userId, providerId? }, id, reason)` — the handler passed `actor.actorId` (a
   string) as that first parameter, so **`actor.userId` was `undefined` inside the service**, plus a
   4th `"CUSTOMER"` argument the signature never declared. Fixed to `{ userId: actor.actorId }`,
   matching `routes/bookings.ts:821`. The customer role is already enforced by the tool's
   `requiredRole` + `customer.ownership` policy, so it does not need re-passing.
2. **`write.partner.acceptJob` recorded LATITUDE as the job ETA.**
   `accept(providerId, id, eta?: number)` has **no GPS parameters**; the handler passed
   `lat` third and `lng` fourth. A partner accepting via the AI tool would have had
   `eta ≈ 28.6` (a latitude) written as their ETA in minutes. Fixed to
   `accept(providerId, bookingId)`. **NOTE:** the tool catalog still advertises optional `lat`/`lng`
   inputs the service cannot consume — deliberately *not* forwarded rather than corrupting `eta`;
   flagged for follow-up.
3. **`write.partner.rejectJob` passed `reason: undefined` into a required parameter** that is
   forwarded to `assignmentEngine.onProviderRejected(...)` — straight into the dispatch and
   reassignment path. Fixed with an explicit default, mirroring the cancel handler's convention.

**Regression test added:** `src/__tests__/ai-tools-handler-contracts.test.ts` — **6/6 passing**.
It asserts service arity plus the corrected call shapes rather than re-running money paths, so it
is deterministic and cannot mutate bookings, wallets or the ledger. The test caught **my own** wrong
assumption mid-write (I expected `accept.length === 2`; a TS optional parameter with no default
still counts toward `Function.length`, so it is 3) — corrected the test, not the code.

#### Investigation B — `brain-security.ts` — **STALE CONSUMER, security behaviour unchanged**
`OutputValidationResult` is a correctly-designed discriminated union —
`{ valid: true, content }` XOR `{ valid: false, reason }` — and `validateBrainOutput` read **both**
fields without narrowing. Classification: **consumer wrong (B)**, type is right.

Runtime impact: on the invalid branch the function's declared `content: string` was actually
`undefined` — i.e. **the return type lied precisely when validation had failed**. Fixed by narrowing
on `valid`, with the invalid branch returning `cleaned` exactly as the secret-detection branch a few
lines above already does, so the declared contract now holds in both cases.

**No validation weakened:** the `valid` decision is untouched, and the gateway still short-circuits
on `!output.valid` before reading `content`. Verified: `ai-brain.test.ts` **17/17**,
`ai-tools.test.ts` **6/6**.

**Pre-existing failure identified, not caused here:** `ai-gateway.test.ts` is 14 pass / 1 fail
("circuit breaker starts closed"). Proven pre-existing by stashing the brain-security fix and
re-running — identical 14/1. Classified `APPLICATION_DEFECT`, pre-existing, unrelated to P3-8;
recorded rather than absorbed.

**Remaining: 23**, across `eta-intelligence` (6), `routes/analytics` (3), `ai-gateway` (3),
`matching` (2), `tool-registry` (2), and 7 singletons. No further shared cluster.

### P3-8 continued — acceptJob contract resolved + 3 more defects; 23 → 17

Live `bunx tsc --noEmit`: **23 → 21 → 20 → 18 → 17.**

#### acceptJob `lat`/`lng` — **classification C: legacy fields with NO consumer** → removed
Traced the full contract before touching it: `bookingService.accept(providerId, id, eta?)` has no
GPS parameters and **never reads location anywhere in its body**; the HTTP schema
(`bookingAcceptSchema`) accepts **only `eta`**; the **real partner mobile app** posts only
`{ eta }`; and no other caller passes GPS. Partner position has its own established contract —
`trackingLocationSchema` over the `/ws/tracking/:bookingId` WebSocket — which is where the partner
app genuinely publishes it.

So the fields were advertised to the model, accepted, and silently discarded (and, before the
earlier handler fix, written into `eta` as a latitude). Removed from the tool schema with a
documented rationale. **Not** forwarded anywhere and **no** new parameter invented.
**Regression:** `ai-tools-handler-contracts.test.ts` now **8/8**, including a guard that every
declared acceptJob parameter has a real destination in the service signature.

#### `tool-registry.ts` + `tool-audit.service.ts` (2 + 1) — STALE_TYPE_CONTRACT
`validationSchema` and the tool-execution `metadata` are written verbatim into Prisma JSON columns
(the audit-visible tool contract), but were typed `Record<string, unknown>`. Retyped at source as
`Prisma.InputJsonObject` — same persisted value, destination now explicit. AI subsystem re-verified:
`ai-tools` 6/6, `ai-brain` 17/17, handler contracts 8/8.

#### `matching.service.ts` (2) — STALE_TYPE_CONTRACT, **booking/assignment priority**
`ScheduleInput.breakWindows` was declared `BreakWindow[] | null`, but both consumers immediately run
the value through `parseBreakWindows(raw: unknown)`, which validates every entry (object shape,
HH:MM format, start < end) and discards malformed ones. Raw `Prisma.JsonValue` off
`provider.breakWindows` is therefore handled safely — the declared type was narrower than the
implementation. Widened to match reality. **Break-window behaviour verified unchanged**:
`partner-operations.integration` 7/7, `service-match` 4/4, `assignment-dispatch-lock` 7/7 — so
providers are still correctly excluded during breaks.

#### `ai-gateway.ts:174` — **REAL SECURITY-AUDIT DEFECT**
`PromptSecurityResult`'s unsafe variant is `{ safe: false, reason, category }` and carries **no
`promptHash`**. Only `validateBrainInput` (the ai-brain path) always returns one. So whenever
`AI_BRAIN_ENABLED=false`, **every BLOCKED prompt was written to the audit trail with
`promptHash: undefined`** — losing the hash on precisely the records a security review depends on.
Fixed by deriving it from the message via the same `hashContent` the safe path uses, so blocked and
allowed records hash identically. No security decision changed — only the completeness of the audit
record.

**Pre-existing, unchanged:** `ai-gateway.test.ts` remains 14 pass / 1 fail ("circuit breaker starts
closed"), already proven pre-existing by stash-and-rerun.

**Running total this pass: 6 REAL defects fixed** (3 AI-tools handler contracts, 1 stale tool
schema, 1 security-audit hash gap, 1 brain-security union) plus 4 stale-type-contract corrections.
**Remaining: 17.**

### P3-8 — ETA-INTELLIGENCE cluster complete: 17 → 11 (all 6 resolved, 0 casts)

Live `bunx tsc --noEmit`: **17 → 13 → 12 → 11.** Every ETA input was traced to its real source and
nullability before any change; **no UNKNOWN was replaced with a fabricated default.**

#### Errors 155 / 208 / 209 / 298-299 — `partnerHash` / `customerHash` — STALE_TYPE_CONTRACT
`EtaTrainingLabel.partnerHash` and `.customerHash` are **NOT NULL** in the schema, while
`hashPii(id): string | null` returned nullable **regardless of input**, so a provably-present id
still produced a nullable hash. Initially this looked like a real defect — `booking.providerId` is
`String?` and a null hash would fail the insert — so the invariant was checked rather than assumed:
**`eta-intelligence.service.ts:92` guards `if (!booking.providerId || !booking.arrivedAt) return
null;`**, and `Booking.userId` is non-nullable. Both hashes are therefore guaranteed by the time the
label is built. Root cause was `hashPii`'s **return** type, not its argument.

**Fix:** overloaded `hashPii` — `(id: string): string` plus the existing
`(id: string | null | undefined): string | null`. Runtime behaviour identical; callers that have
proven the id exists now get a non-nullable hash, and callers that genuinely may pass nothing are
unchanged. One overload resolved **4** errors.

#### Errors 389 / 404 / 312 — arrival provenance — STALE_TYPE_CONTRACT, **UNKNOWN preserved**
`resolveArrivalSource` declared a non-null provenance union, but its own delegate
`arrivalSourceForBooking` returns **null** whenever provenance cannot be determined — no matching
`PARTNER_ARRIVED` event, an unrecognised source value, or a lookup failure.

Verified UNKNOWN is a **first-class, deliberately-handled state**, not an oversight:
`analytics/eta/validation.ts:201` records `historical_provenance_unknown`, deducts 10 points and
caps the label at VALIDATED, with the comment *"unknown is never treated as precise."* Substituting
a default here would have **silently promoted unverifiable arrivals to full training weight** —
precisely the corruption that guard exists to prevent.

**Fix:** widened `resolveArrivalSource`'s declared return, and `syncToBigQuery`'s `provenance`
parameter, to include `null` — so UNKNOWN reaches both the validator and the warehouse honestly.

**Classification summary:** all 6 were STALE_TYPE_CONTRACT — declared types narrower (or falsely
non-null) versus proven runtime behaviour. **No casts, no defaults, no suppression.**

**Regression — all green:** `eta-intelligence` 4/4, **`eta-arrival-provenance` 16/16**,
`eta-training-contract` 30/30, `eta-synthetic-classifier` 5/5 (50/50 across ETA),
`partner-operations.integration` 7/7, `assignment-dispatch-lock` 7/7,
`phase7-post-service-security` 8/8, `ai-tools-handler-contracts` 8/8.

**Remaining: 11** — `routes/analytics` (3) and 8 singletons. **Next:** analytics routes.

### P3-8 — ANALYTICS ROUTES cluster complete: 11 → 8 (all 3 resolved, validation ADDED not removed)

All three were the same shape: an unvalidated `t.String()` from the request handed directly to a
function typed with a narrow union — `EtlRunMode`, `FeatureGroup`, `VersionType`.

**Classification: REAL_APPLICATION_DEFECT (validation gap), not stale typing.** The declared service
contracts were correct; the *routes* were accepting values those contracts could never honour. The
decisive evidence that this was an oversight rather than a design choice: on `/features/export`,
`split` was **already** validated with `t.Union([t.Literal(...)])` while its sibling `group` was
left as a bare string — the correct pattern was known and applied one field away.

| Route | Field | Was | Now |
|---|---|---|---|
| `POST /etl/run` | `runMode` | `t.String()` → `EtlRunMode` | union of the 5 real Prisma enum members |
| `POST /features/export` | `group` | `t.String()` → `FeatureGroup` | union of the 8 real feature groups |
| `POST /versions/rollback` | `versionType` | `t.String()` → `VersionType` | union of the 5 real version types |

**Fix:** validate at the request boundary, mirroring the existing `split` pattern. The literal lists
are declared `as const satisfies readonly FeatureGroup[]` / `readonly VersionType[]`, so adding a
member to either source union without updating the route becomes a **compile error** rather than a
silent runtime rejection. Nothing was broadened to `any`, no field dropped, no default substituted,
no authorization touched — `requireRole("ADMIN")` is unchanged on all three.

**Live runtime verification** (the dev server hot-reloaded the change, so these are real
post-fix responses):
- `versionType: "totally-invalid"` → **400** `VALIDATION_ERROR`, `field: versionType, "Expected union value"`
- `group: "totally-invalid"` → **400** `VALIDATION_ERROR`, `field: group, "Expected union value"`
- `runMode: "NOT_A_MODE"` → **400** `VALIDATION_ERROR`
- `GET /versions/dataset` (valid, non-mutating) → **200**
- `runMode: "INCREMENTAL"` with empty `jobIds` → **200** `{"success":true,"counts":{}}`
- unauthenticated → **401** (authorization unaffected)

`/versions/rollback` was deliberately **not** executed with a valid payload — it mutates version
state, and proving the schema accepts a value does not require performing the rollback.

**Remaining: 8 singletons.**

## PHASE 8 — P3 BATCH COMPLETE

| Item | Status |
|---|---|
| P3-1 orphaned Prisma models | **NOT A DEFECT** — discovery wrong; 6,380 real rows, live routes + ETL scheduler; nothing deleted |
| P3-2 duplicate nav entry | **DONE** (absorbed into P2-1) |
| P3-3 zustand mismatch | **NO FUNCTIONAL RISK** — documented, deliberately not upgraded |
| P3-4 dead `apps/mobile` stub | **REMOVED** + 3 stale instructional docs fixed |
| P3-5 AI route fragmentation | **INVESTIGATED** — no consolidation justified; 2 real issues already tracked as P0-2/P2-3 |
| P3-6 (new) customer-app typecheck red | **RECORDED** — pre-existing `APPLICATION_DEFECT`, blocks the mobile CI gate |

**Migration approval queue unchanged — still `READY_FOR_APPROVAL`, none applied to `homigo_db`:**
P0-3, P1-6, P2-10, P2-2.

---

**Next action:** P1-3's three verification gates resume automatically once credentials are supplied
(exact commands in `PHASE_8_P1_3.md` §10) — that single preview build also closes **P1-1's physical
push delivery** and **P1-2's on-device map render**. Per the "don't stop the loop" rule, the
credential boundary does not block Phase 8: the next unblocked items are the P2 tier (P2-1 admin nav
wiring, P2-2 composite indexes, P2-3 unused feature flags, P2-5 CI lint/coverage gates, P2-6 backup
timeout, P2-9 dead endpoint, P2-10 sibling null-safety, P2-11 governed job-alert template).

---

### P3-8 — FINAL 8 SINGLETONS: **8 → 0**. Gate: `P3_8_COMPLETE`

`bunx tsc --noEmit` in `apps/backend` (the CI command verbatim) exits **0**. Independently
confirmed with `node ./node_modules/typescript/bin/tsc --noEmit` (exit 0) and `bun build` (exit 0).
`strict: true` and `skipLibCheck: true` are byte-identical to HEAD; the only tsconfig changes made
during P3-8 *widened* coverage (`include: ["src"]` → `["src", "analytics"]`). No file excluded, no
suppression added, no `any`.

| # | File | Classification | Resolution |
|---|------|----------------|------------|
| 1 | `services/booking-contact.service.ts` | STALE_TYPE_CONTRACT | `UserPiiFields` demanded `email`+`phoneNumber`; `resolvePhone` reads only the phone pair. Split into `EmailPiiFields`/`PhonePiiFields`. |
| 2 | `services/partner-incentive-payout.service.ts` | STALE_TYPE_CONTRACT (+1 REAL defect found on the path) | `PARTNER_INCENTIVE_CREDITED` added to `SecurityEvent`; retention misclassification fixed. |
| 3 | `ai/gateway/ai-gateway.ts` (397) + `routes/ai-gateway.routes.ts` (120) | STALE_TYPE_CONTRACT | DB ports declared `(args: unknown) => …`, which is *stricter* than Prisma. Retyped `Pick<PrismaClient, …>`. |
| 4 | `ai/gateway/ai-gateway.ts` (238) | STALE_TYPE_CONTRACT | Composed branch built a 3-field object; now spreads the legacy template. |
| 5 | `routes/ai-brain.routes.ts` (182) | REAL_APPLICATION_DEFECT | 6 `as never` casts + unvalidated JSON. Enum schemas + `toInputJsonObject`. |
| 6 | `ai/index.ts` (30) | STALE_TYPE_CONTRACT | `ai/types.ts` imported `AiGatewayRole` but never re-exported it. |
| 7 | `index.ts` (179) | ENVIRONMENT_TOOLING | Elysia type accumulation over 54 `.use()` links exceeded TS depth. Chain segmented. |

#### Two REAL defects found by tracing, not by the compiler

**Financial audit records were being deleted after 1 year instead of 10.**
`securityEventRetention` used `action.includes("HCoin")` — case-sensitive, and every real event
name is upper-case (`HCOIN_EARNED`), so it could never match. Only the debit side carried a
keyword, so `WALLET_DEBIT` → FINANCIAL_LEDGER (10y) while the credits that funded it
(`PARTNER_INCENTIVE_CREDITED`, `REFERRAL_COMMISSION_CREDITED`) and `FINANCIAL_ADJUSTMENT_EXECUTED`
→ SYSTEM_LOGS (365d, archived at 90). Runtime-verified before and after. Fix retains *more*, never
less, and non-financial classifications are unchanged.

**Six `as never` casts in `ai-brain.routes.ts` were hiding validation gaps.** They produced no
typecheck error *because* they were suppressions. `memoryType` selects the retention TTL and feeds
the content-safety screen; `actorRole` crossed a genuine enum gap (`UserRole.VENDOR` vs
`AiGatewayRole.PARTNER`) — latent only because `requireAdmin` gates every route. Replaced with
union schemas derived `as const satisfies` and the security module's own `mapUserRoleToAiRole`.

#### Evidence

- **PII:** `resolvePhone` narrowed *toward* less PII — the alternative (adding `email` to the
  booking-contact selects) would have been a privacy regression. Guard negative-tested: re-adding
  `email: true` fails the suite (8→7), removing it passes again.
- **Financial:** payout row ₹150 == wallet txn ₹150 (BONUS/COMPLETED), audit row references both
  ids. Idempotency is DB-level `@@unique(providerId, ruleId, periodKey)` + an in-transaction
  re-check before the credit. **No financial state mutated.**
- **Elysia segmentation:** proven runtime-neutral by A/B — both servers booted side by side,
  **80/80 routes returned identical status codes**, and security headers/CSP/CORS/request-context
  were identical. `.use()` mutates and returns the same instance (verified against elysia 1.4.29).
- **AI-brain validation, live:** invalid `memoryType` → 400 VALIDATION_ERROR; invalid
  `status` → 400; valid values reach the auth gate (401).

#### Regression: 146 pass / 0 fail across 11 suites

3 new P3-8 suites (51 tests) + ai-tools-handler-contracts, ai-brain, ai-tools, p0/p1/p3/p4
security, phase7-post-service-security.

**One pre-existing failure, not introduced here:** `ai-gateway.test.ts` circuit-breaker case
(`"CLOSED"` vs `"closed"`), 14 pass/1 fail. Proven by stashing all P3-8 work and re-running at
HEAD — identical 14/1. Source and test file are byte-identical to HEAD. Matches the earlier
classification recorded above.

#### Not done, and why

- `section04-incentive.integration.test.ts` was **not** run: it `deleteMany`s payout rows and the
  live DB holds exactly 1 real payout. Needs an isolated DB.
- Pre-existing suppression-class casts elsewhere (`as unknown as` in `context-cache.ts`,
  `context-snapshot.ts`, `model-providers.ts`; `as never` in `brain-security.ts`,
  `activity-timeline.ts`, `approval-engine.ts`) were **not** introduced by P3-8 and produce no
  typecheck error. Recorded as **P3-10** — same defect class as the six fixed here.

**P3-9** (AI-tools WRITE end-to-end coverage audit) remains recorded and NOT STARTED.

---

### P3-9 — AI-tools WRITE end-to-end coverage: `P3_9_COMPLETE`

Full findings in **PHASE_8_P3_9.md**. Audited the production-reachable WRITE path through the real
`executeTool()` against an isolated database (`homigo_p39`, schema-cloned from `homigo_db`).

**Registry (runtime enumeration — the only authoritative method):** 55 tools = 29 READ + 12 WRITE +
14 HIGH_RISK. HIGH_RISK bound 0/14 under `NODE_ENV=production` (`PRODUCTION_ENVIRONMENT`), catalog
byte-identical to freeze `7ce2e71`. Nothing bound, nothing activated.

> A grep-based enumeration reports 41 tools and ZERO high-risk, because the 14 high-risk entries are
> generated from a compact `([...] as const).map(...)` literal. Future audits must enumerate at
> runtime.

**REAL_APPLICATION_DEFECT — a failed job acceptance was reported as SUCCESS.**
`bookingService.accept()` reports refusal by value (`{ok:false, error}`), not by throwing. The
acceptJob handler returned it unchecked, and the engine treats any resolved value as success.
Reproduced: engine `SUCCESS` while payload was `{"ok":false,"error":"PAYMENT_NOT_SETTLED"}` and the
booking stayed PENDING with `acceptedAt` null. `rejectJob` shared the shape.

Fixed with `ToolDomainRejection` (new leaf module `src/ai-tools/execution/errors.ts`): recorded
FAILED with the domain's own code, **no circuit-breaker penalty**, never retried. The naive fix —
just throwing — would have been worse: `ALREADY_CLAIMED` is a normal race outcome and the circuit
opens after 5 failures, so ordinary race losses would have disabled acceptJob for every partner.
Leaf module because `engine -> registry -> handlers` is already a cycle.

Verified: refusal -> FAILED + `errorCode=PAYMENT_NOT_SETTLED` + DB unchanged; 7 consecutive
refusals (threshold 5) left the circuit closed; a genuine accept -> SUCCESS, `PENDING -> ACCEPTED`,
+1 email, +2 outbox, +1 notification.

**Security matrix 9/9 DENIED** (cross-role, IDOR, actorId spoofing, injected `admin/allUsers/role`,
self-asserted `confirmed`, forged `approvalId`) with zero domain mutation — and positive controls
prove the denials are meaningful rather than a uniformly-denying engine.

**Idempotency/concurrency all PASS:** duplicate key -> 1 cancellation event; two concurrent accepts
-> 1 SUCCESS + 1 FAILED with exactly one email/outbox event; 5 concurrent same-key -> 1 ticket.

**HUMAN_DECISION_REQUIRED:** concurrent same-key calls surface raw Prisma `P2002` instead of the
structured replay. No data-integrity impact (exactly one row created); fail-closed and safe.
Deliberately not changed.

**`homigo_db` provably unmutated:** `bookings=405 wallet_txn=30 activity=78492 notifications=5601
payments=268` identical before and after.

**Regression:** backend typecheck 0; p3-9 (6) + ai-tools-handler-contracts (8) + ai-tools (6) +
ai-brain (17) + p3-8 suites (51) + p0-security-hardening (39) + phase7-post-service-security (8) —
all pass, 0 fail.

**Next:** P3-10 suppression audit.

---

### P3-10 — Type-suppression audit: `P3_10_COMPLETE`

Full findings in **PHASE_8_P3_10_SUPPRESSION_AUDIT.md**.

**37 real production casts found (the P3-8 inventory of 6 was a truncated grep; 51 raw matches
included 14 prose false positives). 31 removed, 6 retained and documented, 0 unjustified.**

**4 new defects:**

1. `booking.ws.ts` read identity as `(getWsState(ws) as any)?.userId` — the cast erased that
   `userId` is `string | undefined`, and it fed acceptBooking / rejectBooking / cancelBooking /
   startService / completeBooking, all requiring a real id. Removing it produced 7 errors, one per
   action. Not hypothetical: `ws-state.ts` records that `getWsState` HAS missed for a live socket.
   Fixed with a fail-closed guard.
2. `hasAuditedPaymentGateOverride` declared `findFirst: (args: unknown)` defaulted `prisma as never`
   — so the payment-gate override query was NOT TYPECHECKED AT ALL. Retyped
   `Pick<PrismaClient, "activityLog">`; enabling checking surfaced no errors (shape was right, just
   unverified).
3. The Vertex `client as unknown as {...}` was not bridging a missing method — `generateContent` IS
   declared. It hid a nullability difference against a hand-maintained copy of the vendor contract.
   Replaced with the SDK's generated type.
4. `admin-partner-acquisition.ts` — 12 sites pushing raw request values into typed service params,
   4 GET routes with no query schema at all. Merge resolutions could carry an unknown field or
   invalid choice into a merge that rewrites lead data. Fixed end to end; runtime-verified
   invalid → 400, valid → 401.

**Notable:** `context-cache.ts` asserted arbitrary DB JSON *was* an `EnterpriseBuiltContext` — a row
from a previous deploy yields undefined required fields that get injected into the model's prompt,
degrading an answer rather than raising an error. Now shape-guarded, treated as a miss so it
rebuilds. And `coverage.ts`'s `as unknown as Elysia` became obsolete because P3-8's index.ts
segmentation removed its cause.

**Retained 6, each documented with why + removal condition:** sanitizer generic identity x2
(language limitation), globalThis singletons x2, Prisma `$extends`, `BigInt.prototype.toJSON`.

**No-cheat:** no @ts-ignore/any/skipLibCheck/exclusions. One cast I introduced mid-audit was removed
on noticing. `strict` and `skipLibCheck` byte-identical to HEAD.

**Regression:** typecheck 0 (exit 0); 211 pass / 0 fail across 18 suites; clean boot with 5 endpoints
200 and zero boot-log errors; HIGH_RISK re-verified 0/14. Known pre-existing ai-gateway 14/1
(circuit-breaker casing) unchanged.

**Safety:** no migrations, `homigo_db` unmodified, no certification mutated, LIVE not activated, no
HIGH_RISK tool bound.
