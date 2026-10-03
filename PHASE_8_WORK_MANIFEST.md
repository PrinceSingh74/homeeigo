# PHASE 8 — WORK MANIFEST (Prioritized Roadmap)

Derived from `PHASE_8_DISCOVERY.md`. P0 → P1 → P2 → P3. Items marked `HUMAN_DECISION_REQUIRED` or
`EXTERNAL_ARTIFACT_REQUIRED` are blocked and must not be guessed past — classify, don't invent.

---

## P0 — Production / Security / Data-Integrity Risk

### P0-1. Fake AI-diagnosis widget on web (`AiImageDiagnosis.tsx`)
- **Problem**: A component inside `apps/web`'s `/ai` surface presents fabricated AI output as if it were real analysis, sitting beside the genuinely certified Vision feature.
- **Current behavior**: Unknown exact mechanism yet — needs a direct read of the component before any fix (could be hardcoded fixture data, a fake delay+canned response, or similar). Not yet root-caused; discovery agent identified it exists and is reachable, did not trace its exact fake-data mechanism line-by-line.
- **Desired behavior**: Either (a) wire it to the real, certified `vision_intelligence` pipeline, or (b) remove it entirely if it's redundant with the real Vision page. This is a customer-trust issue — fabricated AI output presented as real is explicitly the class of defect this project's standards forbid.
- **Existing reusable architecture**: `vision-intelligence.service.ts` + `/api/vision` routes (real, certified SHADOW).
- **Required changes**: Read `AiImageDiagnosis.tsx` fully first to confirm the fake-data mechanism (do not assume). Then either delete + redirect users to `/vision`, or rewire to real endpoints.
- **Impact**: Web only. No DB/migration impact. No automation/AI-gateway impact unless rewired to call the gateway.
- **Tests required**: Manual browser verification of whichever path is chosen (component removal or real-data wiring), plus existing Vision e2e coverage should cover the real path if rewired.
- **Real observation required**: Yes if rewired to real Vision — confirm a genuine analysis renders correctly in the browser.
- **Certification required**: No new certification — this either removes a fake surface or routes into the already-certified Vision capability.
- **LIVE implications**: None — Vision remains SHADOW regardless of this fix.
- **Decision needed**: `HUMAN_DECISION_REQUIRED` — remove vs. rewire is a product call, not purely technical (rewiring changes what the `/ai` tab offers vs. what `/vision` offers).

### P0-2. Vision certification/governance disconnect — INVESTIGATED, see `PHASE_8_VISION_GOVERNANCE_FINDINGS.md`
- **Problem, confirmed by full source read (not just discovery-agent summary)**: `vision_intelligence`'s `AutomationCertification` row (`approvedExecutionMode: "SHADOW"`) is never read by `vision.routes.ts` or `vision-intelligence.service.ts` — no code path checks it, and `AI_VISION` is checked nowhere either. **Proven at runtime, not assumed**: this session's environment has a real `GEMINI_API_KEY` configured (`.env.local`), so `visionObservationMode()` returns `REAL_PROVIDER` right now — any authenticated user gets a real Gemini call on their photo today, entirely independent of the SHADOW certification. Contrast confirmed directly in `step-executor.ts`: real workflow automations DO have `executionMode === "SHADOW"` checked and enforced (skips the real action, records shadow evidence) — Vision has no equivalent because it was never registered as a `WorkflowDefinition` at all (confirmed against the full registry in `automation/registry/definitions/index.ts`).
- **Current behavior**: Vision's only real behavioral gate is `REAL_PROVIDER` vs `FALLBACK`, driven purely by whether a Gemini credential is configured — an operational concern, orthogonal to the certification's SHADOW/LIVE claim. Access control (auth + ownership) and advisory-only design (structural — no code path to money/state-mutating services) are real and independently re-verified; the SHADOW *label* is what's decorative, not the safety of the feature.
- **Desired behavior**: One of two legitimate paths — (A) retrofit real enforcement (wire `AI_VISION`/certification lookup into an actual gate), or (B) reclassify: acknowledge Vision is a non-workflow, synchronous-request capability whose real safety model (structural advisory-only + credential-gating + auth/ownership) doesn't need workflow-style SHADOW/LIVE at all, and replace the misleading `approvedExecutionMode` label with an honestly-shaped one-time capability-approval record.
- **Existing reusable architecture**: `feature-flag.service.ts` (for option A), `certification.ts`/`getCertification()` (for either option).
- **Required changes**: **Not yet made — this remains `HUMAN_DECISION_REQUIRED` between options A and B.** Whichever is chosen touches an already-certified, Phase-7-frozen capability and must go through impact assessment + re-certification (or a new capability-approval record) before being considered complete, per the explicit freeze rule. The existing certification was NOT voided, altered, or touched during this investigation.
- **Impact**: Backend service + certification metadata (and admin UI, if option A adds a visible toggle). No DB migration required for either option as scoped so far. No frontend impact expected beyond a possible admin control for option A.
- **Tests required**: Depends on chosen option — for A, a test proving the flag/cert now actually gates behavior; for B, none (documentation-only change to the certification's shape/semantics).
- **Real observation required**: Only for option A (must observe the new gate actually take effect end-to-end).
- **Certification required**: Yes, either way — re-certification (A) or a replacement capability-approval record (B).
- **LIVE implications**: None either way — no path here proposes activating LIVE; the question is only about what SHADOW should mean and how (or whether) it's enforced.
- **Decision needed**: `HUMAN_DECISION_REQUIRED` — option A vs option B. See `PHASE_8_VISION_GOVERNANCE_FINDINGS.md` for full reasoning.

### P0-3. Assignment-dispatch (30s tick) has no distributed lock
- **Problem**: Every other "locked" job in `lib/maintenance.ts` runs under `runWithLeaderLock`; the highest-frequency, most business-critical one (`assignmentEngine.processQueue()`, every 30s) does not.
- **Current behavior**: Safe today only because the deployment is single-instance. The moment a second backend instance runs, both would process the dispatch queue concurrently with no coordination.
- **Desired behavior**: Wrapped in the same `runWithLeaderLock` pattern as the other 30s-scale job (`ops alert dispatch`, TTL 18s for a 20s interval) — likely a short TTL (e.g. 25s) matching the 30s interval, unless the omission was intentional for low-latency reasons that need confirming first.
- **Existing reusable architecture**: `lib/distributed-scheduler.ts::runWithLeaderLock`.
- **Required changes**: Read `runAssignmentDispatch` in `maintenance.ts` fully, confirm whether omission was deliberate (comment/design note) before wrapping it — if deliberate, document why; if accidental, wrap it.
- **Impact**: Backend only (`maintenance.ts`). No DB/API/frontend/mobile impact.
- **Tests required**: Verify `processQueue()` itself is idempotent/safe under concurrent invocation even with the lock (defense in depth), plus confirm the lock doesn't introduce dispatch-latency regressions given the tight 30s cadence.
- **Real observation required**: Yes — observe real dispatch behavior unaffected (bookings still reach partner panel promptly) after the change, given prior real bugs were found in exactly this path.
- **Certification required**: No (this is infra reliability, not a new AI/automation capability).
- **LIVE implications**: None.

### P0-4. `event-bus.ts` uncaught `recordDeadLetter()` exception
- **Problem**: In `processConsumer`, the `await recordDeadLetter(...)` call has no try/catch. `outbox-processor.ts`'s equivalent DLQ write does have a `.catch()` guard — the two call sites are inconsistent.
- **Current behavior**: If the DB is unavailable at the exact moment an event is being dead-lettered, the event is lost silently with no DLQ row and no error trace.
- **Desired behavior**: Wrap the call in try/catch mirroring the outbox-processor's pattern, logging the failure so it's at least observable even if not persisted.
- **Existing reusable architecture**: `outbox-processor.ts`'s existing `.catch()` pattern as the template.
- **Required changes**: Small, isolated change to `src/events/core/event-bus.ts`.
- **Impact**: Backend only. No DB/migration/frontend impact.
- **Tests required**: A test simulating DB failure during dead-lettering (mock/force-throw on the DLQ write) confirming the event failure is now logged, not silently swallowed.
- **Real observation required**: Not strictly necessary given this is a rare-failure-path fix; unit/integration test coverage is sufficient.
- **Certification required**: No.
- **LIVE implications**: None.

---

## P1 — Major Business Capability

### P2-11. Governed notification template for partner job alerts (found during P1-1)
- **Problem**: partner job alerts (`BOOKING_REQUEST`) are sent via the direct
  `notificationService.sendNotification()` path, not the governed `routeNotification()` path, so they
  bypass template versioning, quiet hours, cadence/cooldown, preference-category gating and the
  `NotificationDelivery` audit row. **This is not currently fixable by simply rerouting**: no
  `BOOKING_REQUEST` template exists in `notifications/templates/definitions.ts`, and
  `bootstrapTemplates()` activates only 2 templates platform-wide — rerouting today would resolve
  `NO_TEMPLATE` → `SKIPPED` and silently stop all partner job alerts.
- **Desired behavior**: author a real `booking.job_request` template set (push/in-app × en/hi),
  activate it deliberately, then migrate the assignment engine's call onto `routeNotification()` so
  job alerts gain governance + delivery audit.
- **Important caveat requiring a decision**: a new-job alert is time-critical. Quiet hours and
  cadence caps that are correct for marketing nudges could cause partners to miss real income.
  Whether (and how) governance should apply to this specific notification type is a business
  decision, not a technical one.
- **Tests required**: template resolution, governance decision coverage, and a real end-to-end
  observation proving alerts still reach partners after the migration.
- **Decision needed**: `HUMAN_DECISION_REQUIRED` — should time-critical job alerts be subject to
  quiet hours/cadence at all, or be an explicit governance exemption?

### P1-1. Partner mobile: no push notifications, poll-only job alerts — DONE
- **Original problem**: `expo-notifications` wasn't a dependency; partners only saw new booking requests via manual pull-to-refresh.
- **Discovery correction**: the **server-side push path was already complete** (assignment engine → `notificationService.sendNotification` → `pushDeliveryService` → Expo, with registration/revocation endpoints and logout-revoke all present). The only real gap was the partner app never registering a token, so `getActiveTokens()` always returned `[]`.
- **Delivered**: partner-app push registration/refresh/revocation, permission + Expo-Go guards, notification tap routing (warm + cold start) with a pure RN-free routing module, logout revocation, `expo-notifications` plugin + dependency. No second notification system, no new push store, no direct adapter calls from business code.
- **Real backend defect found and fixed**: `devicePushService.upsertToken()` had a destructive concurrency race that could leave a just-registered device `isActive: false` — silent total push failure. Reproduced empirically (4 concurrent registrations → 0 active devices), fixed with a scoped `NOT` clause + atomic `upsert`, re-verified by the same test.
- **Deliberately NOT done**: rerouting through the governed `routeNotification()` — would have resolved `NO_TEMPLATE` and stopped partner alerts entirely. Recorded as **P2-11** above.
- **Feature flag**: none created — push is already gated by `user.pushNotifications`, per-device `isActive`, and the capability/permission guard; a fourth switch would be invented governance.
- **Tests**: 11/11 (401s, IDOR, rotation, concurrent idempotency, revocation, tap routing).
- **Real observation**: real bookings via the real customer API dispatched 4 real providers with real `Notification` rows; token invalidation fired correctly through the real Expo call. **Physical on-device delivery `NOT_VERIFIED`** — needs a real dev build (that's P1-3).
- **Side effects**: only the intended +4 notifications, +1 booking, +5 outbox. Payments/ledger/wallet/workflow instances all unchanged.
- **DB/migration impact**: none.

### P1-2. Partner mobile: no in-app "Live Map" — DONE
- **Delivered**: real in-app map replacing the browser link-out list, reusing the existing stack end to end — `react-native-maps@1.20.1` (same as customer app), existing `expo-location`, existing `/api/providers/me/bookings` + `/api/providers/me/route/optimize` (route order, per-stop ETA, polyline), and the customer app's polyline decoder. No second mapping stack, no new geo endpoint.
- **Covers**: partner position, route-ordered job markers, route polyline, marker→detail sheet with ETA + Navigate, and every required state (loading, error+retry, permission-denied, GPS-unavailable, stale-location with timestamp, route-failure degradation, no-jobs, jobs-without-coordinates count).
- **Honesty guarantees (each tested)**: null-island/null/NaN coords excluded rather than drawn; a stale fix gets its own labelled marker and never the live blue dot; route data is enrichment, never a filter.
- **Performance**: GPS watcher stops on screen blur and app background; balanced accuracy with 10s/25m throttling; queries disabled when the screen isn't focused.
- **Real defect found by real observation**: the screen's initial comma-separated `status` list caused a real **HTTP 500** (the endpoint's `STATUS_MAP` has no such key and falls back to an invalid enum). Fixed to the server's own `active` key.
- **Tests**: 24/24 (17 pure-logic + 7 live-backend security incl. cross-partner isolation, injected-providerId rejection, and an explicit read-only/no-mutation proof).
- **Real observation**: real partner with **8 real active jobs** → 8 correctly-ordered markers with real ETAs, real route metrics (97 min saved), and a real `Location` row correctly classified **stale**.
- **Side effects**: none — verified explicitly; bookings/payments/wallet/ledger/assignments/notifications untouched.
- **`EXTERNAL_ARTIFACT_REQUIRED`**: Android needs a Google Maps API key restricted to `com.homeeigo.partner` (iOS uses Apple Maps, no key). Wired via `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in a new `app.config.js` and documented in `.env.example`; the customer app's key is package-restricted elsewhere and was deliberately not copied, and no key was hardcoded. Provisioning is a human step.
- **DB/migration impact**: none.

### P1-3. Partner mobile: no EAS build config, no Sentry — `CONFIGURATION_COMPLETE` / verification `EXTERNAL_ARTIFACT_REQUIRED`
Full detail in **`PHASE_8_P1_3.md`**. Executed under SAFE OPTION (A) — everything not requiring real external credentials is done, and **nothing was fabricated** (no Expo projectId, Sentry DSN, Maps key, or Expo account mutation).
- **Delivered**: `eas.json` (development/preview/preview-aab/production, mirroring customer-app conventions); `@sentry/react-native@~7.2.0` with native init before router mount, environment separation (`EXPO_PUBLIC_APP_ENV`), release/dist tagging, id-and-role-only user context; new app-root `ErrorBoundary`; RN-free PII scrubber on `beforeSend` + `beforeBreadcrumb`. `app.config.js` injects Sentry plugin, EAS projectId, OTA updates URL and the Maps key — all env-gated and **omitted when absent** (a placeholder yields a silently-broken build; an absent value fails loudly).
- **Boundary narrowed with evidence**: an Expo account **is** authenticated (`eas whoami` → `harekrishna_2003`). The only missing EAS artifact is a **project id**. **`eas init` was deliberately not run** — it creates a persistent cloud resource on the user's real account, which is outward-facing and outside SAFE OPTION (A). No cloud credits spent.
- **`CONFIG_VALIDATED`** (kept strictly separate from `CREDENTIAL_VERIFIED`): typecheck 0 errors; `eas.json` 4 profiles resolve; `expo config` resolves cleanly with **no** credentials (nothing fabricated leaks in) and wires correctly **with** one-shot dummy values (never written to disk); Maps key lands in the **prebuild** config and is **stripped from the public manifest**; **Metro `expo export` succeeded** (8 MB Hermes bundle) with Sentry release string + ErrorBoundary present.
- **Security — all pass**: `.env*` ignored/untracked; zero hardcoded DSN/key/projectId; customer app's package-restricted Maps key **not** copied (repo-scanned); **no credentials in the shipped bundle**; source maps require an EAS secret. **PII scrubbing 8/8 tests** (tokens, OTPs, Aadhaar/PAN, bank/IFSC, CVV/card, Razorpay signatures, nested objects, arrays, URL query strings).
- **Explicitly NOT claimed**: no live Sentry event, no completed EAS build, no rendered Android map.
- **Tests**: 43/43 across all partner e2e suites (P1-1 11 + P1-2 24 + P1-3 8). **DB impact**: none.
- **Resumes automatically** once credentials are supplied — exact commands in `PHASE_8_P1_3.md` §10. That single preview build also closes **P1-1's physical push delivery** and **P1-2's on-device map render**.

### P1-4. Admin: no RBAC-based UI gating, no roles-management UI — PART (a) DONE, PART (b) NOT STARTED
- **Part (a) — nav gating: DONE.** `HqSidebar.tsx` now filters `HQ_SECTIONS` by the logged-in admin's real permissions (`adminApi.rbac.me()`, via new `hooks/use-admin-permissions.ts`). Investigation found the backend's `AdminResource` enum (12 coarse values) doesn't map cleanly to the 9-section/52-route frontend, so only the 3 sections with an honest, unambiguous, already-backend-enforced mapping were gated: Finance (`PAYMENTS`/`WALLET`), Risk & Compliance (`DISPUTES`), Growth (`CAMPAIGNS`/`GIFT_CARDS`/`MEMBERSHIPS`). The other 6 sections are deliberately left ungated — no matching resource exists for Executive/Operations/Marketplace/AI/Monitoring, and gating Platform HQ (mixes `SETTINGS` with Support) would have hidden Support from `SUPPORT_ADMIN` staff, a real functional regression, not a security improvement. Fails open while permissions are unresolved (loading/error) since this is a discoverability aid, not the security boundary — every linked route still enforces its own real permission check server-side. 10 tests (8 pure-logic using the real `DEFAULT_ROLES` grant arrays + 1 live-browser + 1 pre-existing regression), all passing; 0 typecheck errors. Full detail in `PHASE_8_STATE.md`'s P1-4 entry.
- **Part (b) — roles-management CRUD page: NOT STARTED.** Desired behavior unchanged from original scope: a dedicated admin/roles console page (create/edit role, assign permissions, invite/deactivate admin) backed by `/api/admin/rbac/*`. **Required changes**: first confirm which mutation endpoints actually exist beyond the confirmed read-only `roles`/`admins`/`me` (not yet checked) before building any UI against them.
- **Additional finding, still open**: P1-8's investigation found AI prompt approve/reject/rollback/deprecate actions are gated by a blanket `role === "ADMIN"` check with no `AdminResource` mapping at all (prompts aren't in the 12-value enum) — a separate, still-unaddressed instance of the same underlying gap.
- **Tests required for part (b)**: e2e coverage for the new roles-management page once built.
- **Real observation required**: for part (a), done — real login as the seed SUPER_ADMIN account, real RBAC response, live browser. For part (b): not yet applicable.
- **Certification required**: No. **LIVE implications**: None.

### P1-5. Redis-down leader-lock silent "always run" fallback
- **Problem**: Every leader-locked job falls back to running on every instance when Redis is unavailable, with no coordination — dormant today (single-instance) but a real duplicate-execution risk once horizontally scaled.
- **Desired behavior**: At minimum, a loud metric/alert when the fallback path is active (so an operator knows coordination has degraded), and a documented decision on whether any of these jobs are unsafe to run duplicated (most look idempotent per the discovery pass, but this wasn't proven for all of them).
- **Existing reusable architecture**: `lib/redis.ts`'s existing `isAvailable` state + `lib/metrics.ts`.
- **Required changes**: Add a metric/alert on fallback-lock usage; audit each leader-locked job's idempotency under concurrent execution (not yet proven for all ~15 jobs, only spot-reasoned).
- **Impact**: Backend only.
- **Tests required**: Simulated Redis-down scenario confirming the metric fires and no job produces incorrect duplicated side-effects.
- **Real observation required**: Not urgent given current single-instance deployment — can be verified via test simulation rather than real multi-instance observation.
- **Certification required**: No.
- **LIVE implications**: None.
- **Priority note**: Genuinely dormant risk — could be reclassified P2 if horizontal scaling isn't imminent; kept at P1 because it's a correctness precondition for the scaling path prior audits already recommended.

### P1-6. `Provider.serviceCategories` schema-level null-safety gap
- **Problem**: The Prisma field lacks `@default([])` unlike sibling array fields; one call site was already patched defensively, but the schema-level gap means other call sites remain exposed to the same raw-NULL crash.
- **Desired behavior**: `@default([])` at the schema level, migration to backfill any existing NULLs to `[]`, removing the need for defensive per-call-site null checks going forward.
- **Existing reusable architecture**: The already-fixed call site in `partner-operations.service.ts` documents the exact failure mode.
- **Required changes**: Grep for all `.serviceCategories` usages across the codebase to find any other unguarded call sites before or alongside the schema fix; write an additive Prisma migration.
- **Impact**: Backend + one migration. Per project hazard memory, verify this table has no hand-written raw-SQL columns requiring the two-migration-directory pattern (booking-addons-pipeline precedent) — `Provider` is a different table, but confirm before running `prisma db push`.
- **Tests required**: Regression test confirming no crash on a NULL-then-migrated row; confirm existing tests touching provider matching still pass.
- **Real observation required**: No — schema-level fix, standard test coverage sufficient.
- **Certification required**: No.
- **LIVE implications**: None.

### P1-7. Data-archival job has no try/catch (unhandled rejection)
- **Problem**: Unlike every sibling job in `maintenance.ts`, the 24h data-archival tick has no try/catch around its fire-and-forget `void` call.
- **Desired changes**: Wrap in try/catch + `logger.error`, matching the pattern used elsewhere in the same file.
- **Impact**: Backend only, isolated one-line-scope fix.
- **Tests required**: None beyond a smoke check that the wrapped call still executes correctly.
- **Real observation required**: No.
- **Certification required**: No.
- **LIVE implications**: None.

### P1-8. Two parallel AI prompt-management architectures — INVESTIGATED, see `PHASE_8_P1_8_FINDINGS.md`
- **Problem, confirmed by full trace**: `AiPromptTemplate` (Phase 3, code-first, single mutable row per prompt, no versioning, no approval workflow, no admin API) vs `AiPromptRegistry`/`AiPromptVersion` (Phase 4, real version history, approval workflow, rollback, A/B experiment routing, full admin REST API). Traced the actual resolution order in `ai-gateway.ts`/`composePrompt()`: **Architecture B (registry) is genuinely authoritative today** — `aiBrainConfig.enabled` defaults true and is not overridden in this environment, so every real AI Gateway call resolves from the registry first, falling back to Architecture A only when ai-brain is disabled or a registry entry is missing/unapproved. Both are dual-written on every boot (confirmed via real row counts: 11/11/11). Zero drift currently exists, but a real, code-proven version-drift trap exists: the registry's seed only ever *creates* version 1 once, never refreshes it — so a future edit to a builtin prompt's code text will silently fail to reach production until someone separately calls an admin-only, UI-unsupported API.
- **Current behavior**: functions correctly today (no live incident), but the redundant DB table (Architecture A's) and the untested, drift-prone registry seed are real latent risks.
- **Desired behavior**: per the findings doc's evidence-backed recommendation — Architecture B as the single source of truth; Architecture A's code-defined `BUILTIN_TEMPLATES` array kept as the bedrock fallback (already serves that role safely); Architecture A's **DB table** (redundant with the array) is the one genuinely removable piece, not Architecture A's code.
- **Existing reusable architecture**: N/A — this item is about removing redundancy, not adding new architecture; explicitly must not become a "V2" of either.
- **Required changes**: **Not made — investigation only, as instructed.** Safe migration sequence (in the findings doc): (1) add test coverage for Architecture B's resolution/approval/rollback logic first — currently zero; (2) fix the version-drift trap; (3) only then consider dropping `AiPromptTemplate`'s DB table and pointing `getTemplate()` at `BUILTIN_TEMPLATES` directly; (4) build the missing admin UI actions or explicitly decide they stay API-only.
- **Impact**: Backend (`ai-brain/prompts/*`, `ai/templates/prompt-templates.ts`, `ai-gateway.ts`) + admin panel (read-only today, could gain create/approve/rollback UI) + a migration if the DB table is eventually dropped. No frontend/mobile impact (server-side only).
- **Tests required**: Substantial — Architecture B currently has zero coverage for its approval/versioning/rollback/experiment-routing logic, the most complex and now-confirmed-authoritative part of the system.
- **Real observation required**: Yes, for the drift-trap fix specifically — must observe an edited builtin prompt actually reach the registry without overwriting a human-approved version.
- **Certification required**: No (not an AI/automation capability requiring SHADOW/LIVE certification — this is prompt-content plumbing, not a new customer-facing capability).
- **LIVE implications**: None — no change proposed here activates anything new.
- **Additional finding**: prompt approve/rollback/reject/deprecate are gated by a blanket `role === "ADMIN"` check, not the granular `AdminResource`/`AdminAction` RBAC model used elsewhere — any admin can alter a production AI prompt regardless of their specific `AdminRoleType`. Recommended folding into P1-4's admin-RBAC-UI work rather than treating as fully separate.
- **Decision needed**: `HUMAN_DECISION_REQUIRED` — (1) whether to drop Architecture A's DB table, (2) which option to use for closing the version-drift trap (each has different governance implications), (3) whether to scope prompt-admin actions to a specific permission.

---

## P2 — Scalability / UX / Operational

### P2-1. Admin: wire `/vision` and `/observability/logs` into nav — DONE
Filed as "pure nav wiring"; only half was. `/observability/logs` was correctly built. **`/vision` was
actually broken**: bare `fetch()` with no Authorization header (admin auth is a Bearer token) → verified
**401**, and it read stats off the response instead of unwrapping `{success,data}` → every figure
`undefined`. Wiring it as-was would have shipped a permanently-empty page. Fixed: new authenticated
`adminApi.vision.*` (type verified against a live response), page rewritten onto design tokens with
honest `—`/`…` placeholders. Both pages wired; duplicate `/finance/reports` nav entry removed (**P3-2**).
Backend RBAC untouched and still authoritative (401 unauth / 401 forged, tested). **22/22 tests** incl.
live-browser render of real data, a11y (single h1, real button), mobile no-overflow, and a
no-duplicate-href regression guard. DB impact: none.

### P2-2. Add missing composite indexes
`Payment` (status+createdAt), `ActivityLog` (userId/providerId+createdAt), `AppLogEntry` (composite instead of 8 single-column), `EnterpriseAuditLog`. Additive migration, no data changes. Should be validated against real query patterns (EXPLAIN ANALYZE) before committing to exact column order, not guessed.

### P2-3. Wire the 4 zero-consumer feature flags or remove them
`AI_CONCIERGE`, `AI_BOOKING_RECOVERY`, `AI_VISION`, `AI_FOLLOW_UP` — each needs a decision: wire into its corresponding capability's actual gate, or remove if genuinely unnecessary. Overlaps with P0-2 for `AI_VISION` specifically. `HUMAN_DECISION_REQUIRED` on removal vs. wiring for the others, since removing a flag that governance assumed existed has certification-adjacent implications.

### P2-4. Test coverage: 163 service files vs. 72 test files, unevenly distributed
Thin coverage on notifications, geo, automation, many AI tools. Requires prioritizing which untested services are highest-risk (financial/security-adjacent first) rather than blanket coverage — needs a follow-up investigation pass, not a blind test-writing sprint.

### P2-5. CI: add lint step, add coverage threshold gate — DONE
Discovery found the backend `lint` script was **broken** (`--ext ts`, removed in ESLint 9) — the backend
was effectively unlinted, which is why no working gate existed. Fixed the script; **no dependency changed**
(the local ESLint 10.4.0 and the config were both fine — `npx` was resolving the root's stale 8.57.1, a
red herring). Extended the existing `ci.yml`, no duplicate workflow: new `lint` job — **blocking** for
web/admin-panel/partner-web (verified clean today, warnings only), **report-only** for backend
(**103 pre-existing problems**; blocking now would red-line every unrelated PR, and the flag flips in one
line once cleared). Coverage added to the existing `backend-tests` job via `bun test --coverage` + lcov
artifact. **No coverage threshold invented** — no measured baseline exists, so a made-up number would be
either meaningless or obstructive; reporting first makes the real figure visible. Verified not assumed:
YAML parses (5 jobs), coverage flags produce a real `coverage/lcov.info` at the uploaded path, `coverage/`
already gitignored. Follow-up: **P2-12**. DB impact: none.

### P2-12. Clear backend lint backlog + set a coverage threshold (from P2-5)
- **Problem**: 102 pre-existing backend lint errors (mostly `no-unused-vars`) keep the new CI lint gate in
  report-only mode; and no coverage threshold can be set until a baseline is measured.
- **Required changes**: clear the backlog (5 are `--fix`-able; the rest are unused imports/vars), then flip
  `continue-on-error` to `false` in `ci.yml`'s backend lint step. Separately, read the reported coverage
  figure from a real CI run and set a floor slightly below it so it ratchets rather than blocks.
- **Impact**: backend + CI config only. **DB impact**: none. **Certification**: no. **LIVE**: none.

### P2-6. DB backup job: add explicit timeout to the spawned child process
Currently only has an `.on("error")` handler; a hang runs indefinitely.

### P2-7. Vision on mobile (parity gap)
No camera/vision AI feature on either mobile app. Business-priority-dependent — likely `HUMAN_DECISION_REQUIRED` on whether this is in scope for Phase 8 or deferred, since it's a genuinely new mobile feature build, not a bug fix.

### P2-8. Staging/production deploy pipeline
`staging-deploy.yml`'s container build/push and Cloud Run/K8s deploy are commented-out placeholders; no production deploy workflow exists at all. `EXTERNAL_ARTIFACT_REQUIRED` — needs a configured container registry and cloud deploy target/credentials before this can be made real; the workflow YAML structure itself is already scaffolded correctly per the earlier Phase-6/Phase-8 manual Cloud Run deploy (per memory) that was proven to work and torn down.

### P2-9. "Dead endpoint" `GET /api/admin/incentives/rules` — NOT A DEFECT, nothing removed
**The discovery finding was FALSE and has been corrected in `PHASE_8_DISCOVERY.md`.** The endpoint
is called via `adminApi.incentiveRules()` from `app/(console)/academy/page.tsx:313` and rendered at
lines 1083-1092 on the nav-reachable `/academy` page (Marketplace HQ → Partner Academy). Verified
live end-to-end: **200** with real data (`DAILY_3_JOBS` ₹150, `WEEKLY_18_JOBS`, …), and its RBAC is
genuinely enforced — a `User` with `role: "ADMIN"` but no `AdminUser` row correctly gets **403**.
Removing it would have broken a working, user-visible panel. The false claim likely came from
grepping the route string rather than the client method name. **Action: none, deliberately.**
### P1-9. `DataArchivalService` performs irreversible hard-deletion with no cold-storage step (found during P1-7)
- **Problem**: `dataArchivalService.runArchival()` permanently `deleteMany`s `AppLogEntry` and
  archived `Notification` rows past retention — there is no copy-to-cold-storage step of any kind.
  This directly contradicts the service's own `getStrategy()` method, which describes
  `coldStorage: "S3 archive via backup-db.ts for PostgreSQL dumps"` as if one exists. It doesn't —
  `getStrategy()` returns a static description object; nothing in `runArchival()` calls S3, calls
  `backup-db.ts`, or writes the about-to-be-deleted rows anywhere before removing them.
- **Current behavior**: after `ARCHIVE_RETENTION_DAYS` (default 90), operational app logs and
  already-archived notifications are gone permanently, unrecoverable, with only a log line
  (`data_archival_completed`, now `data_archival_partial_failure` on error) recording that a prune
  happened — not what was in the deleted rows.
- **Severity note**: lower than it could be — `activityLog` (audit trail) is explicitly and
  deliberately excluded from this service ("Activity logs retained via enterprise audit retention
  (P4); do not hard-delete here"), so compliance/audit data is not at risk. This affects
  operational debug logs and already-dismissed notification history, not financial/audit records.
- **Desired behavior**: either (a) build a real archive-before-delete step (dump pruned rows to S3
  or equivalent before the `deleteMany`), or (b) correct `getStrategy()` to accurately describe the
  real behavior (pure retention-based deletion, no cold storage) so operators aren't misled by a
  status endpoint claiming a safety net that doesn't exist.
- **Existing reusable architecture**: `scripts/backup-db.ts` (full-DB dumps, unrelated granularity
  — would need adaptation for row-level archival) or `objectStorageService` (already used by
  Vision for S3-backed blob storage, the more directly reusable option).
- **Required changes**: not made — this is a real feature gap requiring a design decision, not a
  hotfix. Building it would be a genuinely new capability, not a bug fix; scoped as P1 because
  irreversible data loss (even of non-critical data) contradicts documented behavior, but not P0
  since no compliance/financial data is affected and the current behavior has presumably been live
  for a while without incident.
- **Decision needed**: `HUMAN_DECISION_REQUIRED` — build real cold storage vs. fix the documentation
  to match reality vs. accept current behavior as intentional (logs genuinely may not need
  retention beyond the hot window) and just fix `getStrategy()`'s claim.

### P2-10. `Provider.serviceRegions`/`workingDays`/`certifications` null-safety (sibling to P1-6, done)
Found during P1-6 investigation: same structural gap (no `DEFAULT`/`NOT NULL`) as
`serviceCategories`, but these three fields **already have real NULL rows today** (4/59/57
respectively, in dev data) — unlike `serviceCategories`, which had none. `service_regions` was
already patched defensively at one raw-SQL call site (`partner-operations.service.ts`) previously;
the schema-level gap remains open for all three, and other ORM-path consumers are safe today only
because Prisma's client coerces NULL→`[]` on read (same empirically-confirmed behavior as P1-6).
Fix pattern: same as P1-6 (`@default([])` + migration), but these need a **backfill** step
(`UPDATE ... SET x = '{}' WHERE x IS NULL`) before `SET NOT NULL`, since real NULL rows exist.

---

## P3 — Optimization / Polish

- **P3-1.** Remove or repurpose the 3 orphaned Prisma models (`DataVersion`, `DataFreshnessSnapshot`, `DataQualityResult`) — confirm zero references first, then a migration to drop.
- **P3-2.** Remove the duplicate `/finance/reports` nav entry (Finance HQ vs Platform HQ, same href).
- **P3-3.** Normalize `zustand` version between `homigo-mobile` (v4.5.5) and `homigo-partner-mobile` (v5.0.8) — low urgency since the apps don't share code today, but worth doing before any shared-package extraction.
- **P3-4.** Clean up or formally document the dead `apps/mobile` stub folder.
- **P3-5.** Consider consolidating the 5-file AI route fragmentation (`ai.ts`, `ai-gateway.routes.ts`, `ai-brain.routes.ts`, `vision.routes.ts`, AI-tools routes) under a clearer structure — architecture hygiene, not a functional fix.

---

## Frozen / Do-Not-Touch (Explicit Reminders)

- All 6 Phase-7 CERTIFIED_SHADOW capabilities (`mobile_ai_concierge`, `checkout_recovery`, `personalized_recommendations.v3`, `vision_intelligence`, `rebooking`, `satisfaction_intelligence`) plus `review_request`/`payment_recovery` — any touching change must STOP and assess re-certification impact first (P0-2 above is the one item that legitimately requires touching Vision, and it's flagged accordingly).
- `follow_up` stays `WAITING_FOR_REAL_BOOKING_EVENT` — no synthesis, no manual instantiation, no fast-forwarding.
- `maintenance` (ServiceIntervalPolicy) stays `DEFERRED_BY_HUMAN_DECISION` — no invented interval/policy.
- The 13 permanently-unbound HIGH_RISK AI tools (Phase-5 freeze) — not to be bound without separate explicit authorization; this discovery pass surfaced them only for completeness, not as a Phase 8 action item.
- No LIVE certification for any capability — everything above stays SHADOW-or-below unless a human explicitly authorizes otherwise.


### P3-6. `homigo-mobile` typecheck red — FIXED (0 errors); suites partially green
**Typecheck 111 → 0**, no weakening (no `@ts-ignore`/`any`/`skipLibCheck`/exclude/CI change).
68 dependency errors: the app had **no test runner at all** — installed the Expo-sanctioned stack
(`jest-expo`, `jest`, RNTL v14, `@types/jest`), omitting `react-test-renderer` (peer demanded
react 19.2.8 vs the app's pinned 19.1.0). 43 token errors: classified **obsolete token names**,
all mapped to real equivalents (`accentGreen`→`accent`, verified `#10b981`), no new tokens, no
hardcoded colours. Two **real defects** fixed: `AiChatScreen` misused `AiChatBlock` (per-message
props vs whole-chat props + async/sync composer mismatch) → now delegates like the live tab; and
**duplicate React** across the monorepo left the Jest dispatcher null → pinned to one instance.
Suites now execute: **0 → 12 running, 8 passing**. Also untangled **three** competing stale test
conventions (`bun:test`, Jest/RNTL, `vitest`).
**4 tests still fail — `FIXTURE_DEFECT`**: they assert against the superseded `AiChatScreen` UI
(inline "Thinking...", old placeholder, send-on-typing that could never pass). `AiChatScreen` has
**zero importers**, so further work tests an unused component. Not deleted, not suppressed.
Jest deliberately **not** added to CI — adding a knowingly-red gate is the inverse of the rule.
**DB impact**: none. **Security**: none.

### P3-7. Mobile CI startup-regression `SPLASH_HIDE` — FIXED (certifier defect)
**Classification: CI_CERTIFIER_DEFECT**, proven not assumed. Phase 12 matched marker strings
literally inside four startup files; `SPLASH_HIDE` is emitted from `src/lib/splash.ts` — a
**deliberate once-guard refactor** that exists because multiple paths were double-marking it and
corrupting the timeline. Proved it is genuinely EXECUTED: `hideSplashOnce()` is called from two of
the certifier's own allowlisted files (`AuthProvider.tsx:26`, `_layout.tsx:46`).
**Fix: certifier only — application source untouched.** Phase 12 now walks the startup module graph
one level deep for in-repo `@/` imports, so a marker emitted via a helper those entries call counts.
**A first version of the fix weakened the assertion and a negative test caught it** — the widened
graph matched two non-emitting occurrences (`sentry.ts` breadcrumb allowlist,
`startup-telemetry.ts`'s `since(...)`). Tightened to require a real `startupMark("MARKER"` emission,
making the check **stricter than the original**. Verified both directions: real code PASS 16/16;
emission removed FAIL 15/16; restored PASS.
**CI**: `npm run typecheck` PASS and `startup-regression-ci.mjs` PASS → **`mobile-startup` job GREEN**.
No dummy marker, no duplicated splash logic, Phase 12 not disabled/excluded, no `@ts-ignore`.
**DB impact**: none. **Security**: none.

### P3-8. Backend typecheck baseline — `IN_PROGRESS`: 195 → 31 (−84%)
Full inventory in **`PHASE_8_P3_8_ERROR_INVENTORY.md`**. The 195 were never 195 independent bugs —
**9 root-cause clusters** account for 164 of them: a non-module test file (−48), stale `lib: ES2020`
vs the ES2022 Bun runtime (−32), `rootDir` excluding the genuinely-live `analytics/` tree (−16), three
helpers mistyping Elysia's `set` (−45), two suites importing uninstalled **vitest** (−8), nullable
derefs in certification tests (−4), and **Prisma JSON typing** (`Record<string, unknown>` vs
`InputJsonValue`) retyped at source across 5 files (−28).
**Nothing suppressed**: no `@ts-ignore`/`any`/newly-added `as unknown as`/`skipLibCheck`/exclusion,
no test deleted. The tsconfig edits are corrections (lib matches the real runtime; rootDir covers
real program source) and `bun build` — CI's actual build — was re-verified PASS.
**Phase-7 safe**: `vision-shadow` (certified evidence) re-ran **17/17**, `phase7-db-probe` **1/1**.
**Regression**: backend 74/74 across 10 suites; mobile/partner/admin typechecks and mobile startup CI
all still PASS.
**Remaining 31 are individual, not clustered**, and several look like **real application defects**:
`ai-tools/execution/handlers/index.ts` passes 4 args to a 3-arg function and assigns `string` where
`number` is required; `brain-security.ts` reads `.content`/`.reason` off `OutputValidationResult`,
which declares neither. Left for investigation rather than force-fitted to satisfy the compiler.
- **Gate**: CI backend typecheck still fails → **P3-8 not complete**. **DB impact**: none.

### P3-9. AI-tools WRITE end-to-end coverage audit — NOT STARTED (evidence recorded during P3-8)
- **Problem**: P3-8's typecheck investigation found **4 semantic defects in production-reachable AI
  code** that compiled cleanly and were never caught by any test:
  1. `write.booking.cancelBooking` passed a bare string where an actor OBJECT was required, so
     `actor.userId` was `undefined` inside `bookingService.cancel`.
  2. `write.partner.acceptJob` passed `lat` as the third argument to `accept(providerId, id, eta?)`,
     recording the partner's **latitude as the job ETA in minutes**.
  3. `write.partner.rejectJob` passed `reason: undefined` into a required parameter forwarded to
     `assignmentEngine.onProviderRejected(...)`, i.e. into the live dispatch/reassignment path.
  4. `ai-gateway.ts` audited **every BLOCKED prompt with `promptHash: undefined`** whenever
     `AI_BRAIN_ENABLED=false` (the unsafe `PromptSecurityResult` variant carries no hash).
- **What this indicates**: these handlers are genuinely bound in production (only the 14 HIGH_RISK
  tools terminate at NO_HANDLER), yet three of them called their services with wrong arity or wrong
  argument *kinds*. They were type-correct enough to compile and semantically wrong. Existing
  coverage is contract/static (catalog shape, policy, approval) rather than service-backed
  end-to-end execution, so nothing exercised the real call.
- **Scope**: for each bound READ and WRITE tool, execute the handler against real services with a
  real actor and assert the resulting domain state — not just that the call type-checks. Priority
  order: booking/assignment writes, wallet/coupon writes, notification writes, then reads.
- **Explicitly NOT**: the 14 HIGH_RISK tools stay unbound (Phase-5 freeze) — this audit must not
  bind them.
- **Impact**: backend + test suite only. **DB impact**: tests must use the isolated `homigo_test`
  DB. **Certification**: no. **LIVE**: none.
- **Status**: deferred until P3-8 reaches zero, per instruction.

## P3-9 — AI-tools WRITE end-to-end coverage (COMPLETE)

| Item | Detail |
|---|---|
| Scope | 12 production-reachable WRITE tools; 14 HIGH_RISK excluded (0/14 bound, freeze untouched) |
| Method | Real `executeTool()` chain against isolated `homigo_p39` (schema clone, 188 tables) |
| Defects | 1 REAL_APPLICATION_DEFECT (acceptJob/rejectJob false SUCCESS) — fixed + regression |
| Product changes | `src/ai-tools/execution/errors.ts` (new), `execution-engine.ts`, `handlers/index.ts` |
| Tests added | `src/__tests__/p3-9-tool-domain-rejection.test.ts` (6) |
| Security | 9/9 attacks denied, zero domain mutation, positive controls pass |
| Concurrency | duplicate-key, double-accept and 5-way same-key all correct |
| Open | concurrent same-key returns raw P2002 (HUMAN_DECISION_REQUIRED, no integrity impact) |
| Evidence | PHASE_8_P3_9.md; harness `apps/backend/scratch-p39/` |
| homigo_db | unmutated (counts identical before/after) |

## P3-10 — Type-suppression audit (COMPLETE)

| Item | Detail |
|---|---|
| Found | 37 real casts / 26 files (P3-8 inventory of 6 was truncated) |
| Removed | 31 |
| Retained | 6, each documented with justification + removal condition |
| Unjustified remaining | 0 |
| New defects | 4 (WS identity, payment-gate unchecked query, Vertex nullability, 12-site admin route cluster) |
| Product changes | ws/booking+earnings, booking-payment-gate, booking.service, payments route+service, compliance route+service, context-cache, context-snapshot, model-providers, approval-engine, brain-security, activity-timeline, event-publisher, workflow-registry, geofence, vision-intelligence, notif template registry, partner-lead state machine, coverage, observability, lib/json-input (+toInputJsonArray) |
| Regression | typecheck 0; 211 pass / 0 fail; clean boot; HIGH_RISK 0/14 |
| Evidence | PHASE_8_P3_10_SUPPRESSION_AUDIT.md |
