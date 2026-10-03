# PHASE 8 — DISCOVERY REPORT

**Completed:** 2026-08-24. Mode: read-only discovery, 7 parallel agents, zero code/schema/DB changes made.
**Scope:** Backend (Prisma schema, ~650 routes across 44 files, automation/AI/notification subsystem, infra/scheduler/queues/security/tests/CI), Web app, Admin panel (81 pages), Mobile apps (homigo-mobile, homigo-partner-mobile, dead apps/mobile stub).

This file is the factual map. `PHASE_8_WORK_MANIFEST.md` turns it into a prioritized roadmap.

---

## 1. Existing Capabilities (what's real and working)

- **Customer web + mobile**: full marketplace — booking flow, provider browsing, live GPS tracking (Kalman-filtered, real WS), wallet/invoices, AI chat concierge, ratings, Razorpay payments (production-gated, no silent mock in prod).
- **Partner web-adjacent (mobile) HQ**: 38 registry-driven screens (work, earnings, performance, territory, academy, trust/compliance, rewards, wellbeing, account) — genuinely built, not stubs.
- **Admin console**: 81 pages across 9 HQ domains (Executive, Operations, Marketplace, Growth, Finance, Risk & Compliance, AI, Monitoring, Platform) with real CRUD/ops actions (refund/payout approval, chargeback workflows, lead CRM, coupon mgmt, alert resolution).
- **Event platform**: mature transactional-outbox pattern (`EventOutbox` → claim via `SELECT FOR UPDATE SKIP LOCKED` → dispatch → DLQ on exhaustion), 7 registered consumers, idempotency-checked, crash-safe stale-claim recovery.
- **Automation/workflow engine**: 13 workflows registered (14 counting `payment_recovery` v1/v2 dual-registration), all SHADOW/DRAFT — 4 core (`engine_selftest`, `payment_recovery`, `checkout_recovery`, `review_request`, `follow_up`) + 9 partner-acquisition workflows.
- **AI Gateway**: GROQ/GEMINI/OPENAI live in provider-order failover chain; ANTHROPIC adapter built but deliberately parked (never served a live request, per code comment).
- **AI Tools registry**: 55 tools (29 READ + 12 WRITE fully wired to real services; 14 HIGH_RISK cataloged but frozen — see §6).
- **Notification governance**: quiet hours/cooldown/caps/preferences real; 27 templates registered, only 2 activated (`booking.review_request` push en/hi).
- **Redis layer**: genuinely optional everywhere touched — locks, rate limits, cache, pub/sub all have working in-memory/local fallback paths.
- **Observability**: Sentry wired, Prometheus metrics pre-seeded to avoid NO-DATA, structured+redacted logging, and a mature incident-driven log-governance system (hard DB-persist allowlist + startup guardrail + rate limiter + self-heal thresholds).
- **Secrets**: GSM in production, `.env` in dev, explicit env always wins, fail-open-to-unset (never crashes on missing secret fetch).
- **RBAC (backend)**: real, granular, 6 admin roles × resource/action permission matrix, denials metered.

## 2. Architecture Map (subsystem relationships)

```
apps/web, apps/admin-panel, homigo-mobile, homigo-partner-mobile
        │  (HTTP + WS)
apps/backend/src/routes/*  (~650 endpoints, 44 files, t.Object validation on 36/41)
        │
        ├─ services/*.ts (163 files)  — booking/payment hub-and-spoke, financial-ledger = clean leaf
        │       │
        │       ├─ events/core/event-publisher.ts → EventOutbox (transactional)
        │       │       └─ events/core/outbox-processor.ts (leader-locked poll+claim+dispatch)
        │       │               └─ events/core/event-bus.ts → 7 consumers (metrics, audit,
        │       │                   automation-trigger, automation-scheduler, ml-feature-sink,
        │       │                   eta-label, ai-context-indexer) → DLQ on exhaustion
        │       │
        │       ├─ automation/registry/* (trigger-registry → condition-registry [6 resolvers only]
        │       │       → workflow engine → certification.ts [hardened admin-gated path])
        │       │
        │       ├─ ai/gateway (provider-order failover: GROQ→GEMINI→OPENAI, ANTHROPIC parked)
        │       │       ├─ ai-brain/ (context/memory/prompt-versioning, sits under gateway)
        │       │       └─ ai-tools/ (55-tool catalog + execution-engine, calls back into gateway)
        │       │
        │       ├─ vision-intelligence.service.ts — SEPARATE pipeline, calls Gemini DIRECTLY,
        │       │       bypasses the AI gateway/failover chain entirely
        │       │
        │       └─ notifications/ (router + governance + 27 templates, 2 activated)
        │
        └─ lib/maintenance.ts — 17+ setInterval jobs, most leader-locked via lib/distributed-scheduler.ts
                (Redis SET NX EX; silently degrades to "always run" if Redis down)
```

## 3. Reusable Infrastructure (build on these, don't duplicate)

- Transactional outbox + event-bus + DLQ + idempotency (`src/events/`) — any new async side-effect should route through this, not a new queue.
- `distributed-scheduler.ts` leader-lock pattern — reuse for any new periodic job.
- `certification.ts` hardened path (real admin, audit-before-cert, unique per version, voided-not-deleted) — reuse for any new automation needing human sign-off.
- `feature-flag.service.ts` (Redis-cached, rollout-bucketed, fail-closed) — reuse for any new capability gate; do not invent a second flag mechanism (note: several existing Phase-7 flags are already unused — see §6, fix consumption before adding more).
- AI Gateway provider-order/failover chain — any new AI-calling feature should route through `invokeAiGateway`, not call a provider SDK directly (Vision's direct-Gemini-call pattern is the one exception that already exists and is a discovered inconsistency, not a template to repeat).
- Admin `ui/` primitives + `--color-biz-*` tokens + `GlassPanel`/`PageShell` — reuse for any new admin page (Vision page is the one outlier using raw Tailwind — don't repeat that).
- `rbac.service.ts` resource/action model — extend with new `AdminResource`/`AdminAction` enum members rather than inventing parallel authorization.

## 4. Already-Implemented Phase-8-Candidate Capabilities (found built, not previously tracked)

- Partner acquisition CRM pipeline (lead → application → verification → approval) — fully built in admin panel, real workflow engine backing (9 partner-acquisition workflows), but all SHADOW/DRAFT — no certification path has been run for these post-incident (see §8).
- `ai-brain` context/memory/prompt-versioning layer — a distinct, already-built governance layer for AI prompts, separate from and possibly duplicating `AiPromptTemplate` (see §7 duplicate-architecture risk).
- Customer-intelligence `/api/customer-intel/:userId` admin endpoint — exists, RBAC-gated, not previously known/documented.
- Digital-twin, geo-intelligence, MLOps platform — all real, all previously certified in earlier phases (per memory), still present and untouched.

## 5. Missing Capabilities (real gaps, nothing exists)

- No push notifications anywhere in `homigo-partner-mobile` (`expo-notifications` not even a dependency) — partners cannot receive real-time new-job alerts; `RequestsScreen.tsx` is poll-only with no `refetchInterval` and no `AppState`-triggered refetch.
- No in-app map rendering in the partner app's "Live Map" screen — it's a list that deep-links to Google Maps in-browser; `react-native-maps` isn't even a dependency.
- No image generation, no voice/audio, no SSE/streaming completion in the AI Gateway.
- No vision/camera-based AI feature on either mobile app (web-only today).
- No admin UI for role/permission management (create/edit role, assign permissions, invite admin) despite the backend RBAC model fully supporting it.
- No dedicated Disaster Recovery console page in admin despite `/api/admin/recovery/status|simulate` existing and being consumed only as small dashboard widgets.
- No functioning automated deploy pipeline — `staging-deploy.yml`'s container build/push and Cloud Run/K8s deploy steps are commented-out/placeholder scaffolding; no production deploy workflow exists at all.
- No lint step and no coverage-threshold gate in CI.

## 6. Broken / Incomplete Capabilities

- **`AiImageDiagnosis.tsx`** (web, inside `/ai`) is a fully fabricated fake-AI widget sitting beside the real, certified Vision feature — presents synthetic output as if it were real AI analysis. This is a live customer-facing fake-data defect, not a discovery artifact.
- **`vision_intelligence` certification is structurally orphaned**: `scripts/final-certify-vision.ts` certifies an automationId `vision_intelligence` in the `AutomationCertification` table, but **no workflow with that ID is registered anywhere** in `src/automation/registry/definitions/`. Vision is a standalone feature/route, not a workflow-engine automation. The SHADOW certification and the actual runtime feature share only a name — nothing in the workflow engine enforces "SHADOW" for Vision. Its actual behavior gate is `visionObservationMode()` inside `vision-intelligence.service.ts`, entirely independent of both the certification record and the `AI_VISION` feature flag (which is also never checked anywhere in `src/`).
- **`AI_CONCIERGE`, `AI_BOOKING_RECOVERY`, `AI_VISION`, `AI_FOLLOW_UP` feature flags have zero consumers** in `src/` — declared in `PHASE7_FLAGS` but never checked by any route/service/workflow. The flag layer is cosmetic for these four; actual gating (where it exists at all) happens ad hoc per-service.
- **Assignment dispatch (30s tick)** — the single highest-frequency, most business-critical scheduled job — runs with **no distributed lock**, unlike every other "locked" job in `maintenance.ts`. Currently safe only because the deployment is single-instance.
- **Redis-down leader-lock fallback** silently makes every "locked" job run on every instance with no cross-instance coordination — a duplicate-execution risk that only manifests once the backend is horizontally scaled (which prior enterprise-scale-audit findings indicate is the eventual direction).
- **`event-bus.ts::processConsumer`**: the `await recordDeadLetter(...)` call has no surrounding try/catch. If the DB is unavailable at the exact moment of dead-lettering, the event is lost with no DLQ row — inconsistent with `outbox-processor.ts`'s own DLQ write, which *does* have a `.catch()` guard for this exact scenario.
- **`Provider.serviceCategories` schema-level null-safety gap persists.** One call site (`partner-operations.service.ts`) was already fixed this project (per memory), but the underlying Prisma field still lacks `@default([])` unlike sibling array fields — other call sites remain exposed to the same raw-NULL crash pattern.
- **Data archival job** (`dataArchivalService.runArchival()`, 24h tick) has no try/catch around the call — an unhandled promise rejection inside a fire-and-forget `void` call, unlike every sibling job in the same file.
- **DB backup job** spawns a child process with no explicit timeout — a hang would run indefinitely with only an `.on("error")` handler, no kill.
- ~~`GET /api/admin/incentives/rules` — dead capability, no UI.~~ **CORRECTED (P2-9): this claim was FALSE.** It is called via `adminApi.incentiveRules()` from `app/(console)/academy/page.tsx:313` and rendered at lines 1083-1092 on the nav-reachable `/academy` page. Verified live: 200 with real rules (`DAILY_3_JOBS`, `WEEKLY_18_JOBS`); a non-RBAC admin correctly gets 403. Nothing was removed.
- **Admin panel**: `/vision` and `/observability/logs` pages are fully built but reachable only by direct URL — missing from `HQ_SECTIONS` nav config entirely.
- **Admin panel**: `/finance/reports` is registered twice in nav (Finance HQ + Platform HQ, same href).
- **13 of 14 HIGH_RISK AI tools have zero execution path in production by design** (Phase-5 freeze, already known/frozen per memory — not a new gap, listed here for completeness only). `high_risk.compliance.partnerSuspend` is additionally hard-`DISABLED` because no backing service exists.

## 7. Duplicate-Architecture Risks (per the explicit "no V2" rule — flagged for investigation, not yet judged)

- **Two parallel AI prompt-management systems**: Phase-3 `AiPromptTemplate` vs Phase-4 `AiPromptRegistry`/`AiPromptVersion` (from schema discovery). Needs investigation into which is actually consumed at runtime before any decision — do not assume either is dead.
- **Two parallel AI execution paths**: the AI Gateway's provider-order/failover chain (used by chat/tools) vs Vision's direct-Gemini-call pattern (bypasses the gateway entirely). Not necessarily wrong (Vision's needs — image bytes, specific model — may justify a direct call) but worth a designed decision rather than accidental divergence.
- **AI domain fragmented across 5 separate route files** (`ai.ts`, `ai-gateway.routes.ts`, `ai-brain.routes.ts`, `vision.routes.ts`, plus AI-tools routes) with no unifying structure — not a functional bug, but a maintainability/onboarding risk as the AI surface grows.

## 8. Security Risks

- Rate limiting silently degrades from cluster-global (Redis `INCR`+`EXPIRE`) to per-instance in-memory counters under Redis outage — a real security-relevant degradation (an attacker distributed across requests hitting different instances could exceed the intended global limit), though it fails soft rather than fails open entirely.
- `SUPER_ADMIN` role has an **empty explicit permission list** in `rbac.service.ts`'s `DEFAULT_ROLES` seed — implies wildcard/bypass logic elsewhere that was not fully traced in this pass; worth a dedicated confirmation read before relying on it.
- Admin panel has **no role-based UI gating** — `AdminAuthGuard` only checks `isAuthenticated`, not role; every admin sees every nav section (Finance, Risk & Compliance, etc.) regardless of their actual `AdminRoleType`. Backend RBAC still enforces real denial server-side, so this is a UX/defense-in-depth gap, not a bypass — but a SUPPORT_ADMIN currently sees and can attempt actions that will 403, which is confusing and a minor attack-surface/social-engineering consideration.
- Historical partner-acquisition self-certification incident (documented in code comments: 81 notification-bearing instances queued against real leads/providers before an activation-at-boot bug was caught) — the self-cert path has been ripped out, but this is the clearest evidence in the whole codebase of exactly the failure mode this project's certification discipline exists to prevent. No current exposure, but worth keeping as a live cautionary reference for any Phase 8 work touching partner-acquisition workflows.
- `mlops.ts`, `observability.ts`, `stats.ts` route files don't use `t.Object` validation and were not deep-read (unlike `notifications.ts`/`webhooks.ts`, which were checked and are legitimately fine) — worth a closer pass if any accept POST bodies.

## 9. Data-Model Gaps

- ~~3 genuinely orphaned Prisma models with no code references: `DataVersion`, `DataFreshnessSnapshot`, `DataQualityResult`.~~ **CORRECTED (P3-1): this claim was FALSE.** All three are consumed by `apps/backend/analytics/` (versioning/freshness/data-quality services) — outside `src/`, which is why the search missed them — and reach production via live routes (`src/routes/analytics.ts`, mounted at `index.ts:208`) and the ETL scheduler started in `maintenance.ts:452`. Real data exists: 457 / 18 / 5,905 rows. Nothing deleted.
- Missing composite indexes flagged: `Payment` (status+createdAt pattern), `ActivityLog` (userId/providerId+createdAt), `AppLogEntry` (8 single-column indexes, no composites — write-amplification risk given this table's documented history of runaway growth), `EnterpriseAuditLog`.
- `Provider.serviceCategories` (and possibly sibling `String[]` fields) lack `@default([])` unlike comparable fields — see §6.

## 10. Governance Implications

- The certification/freeze discipline built up through Phase 7 (real-admin-gated, audit-before-cert, voided-not-deleted) is sound and should be the template for any Phase 8 capability needing sign-off — but Vision's case (§6) shows the discipline can be satisfied on paper (a real certification row exists) while the actual runtime enforcement of that certification's stated execution mode (SHADOW) is disconnected from it. Any Phase 8 work touching Vision must resolve this before treating the existing certification as meaningful, and per the Phase 7 freeze rule, must STOP and assess re-certification impact first.
- Feature-flag governance (§6) is currently decorative for 4 of 8 Phase-7 flags — a real gap between "we built a flag system for exactly this reason" and "the capabilities it was built for don't check it."

## 11. Automation Opportunities

- 9 partner-acquisition workflows are fully built, SHADOW/DRAFT, registered — genuine candidates for the same hardened certification path used for Vision/rebooking/satisfaction in Phase 7, once a human decision authorizes proceeding (given the historical self-cert incident, this should go through explicit human sign-off, not autonomous certification).
- `follow_up` remains the one Phase-7 item genuinely waiting on a real event — untouched, correctly so.

## 12. AI Opportunities

- Routing Vision through the AI Gateway's failover chain (GROQ/GEMINI/OPENAI with ANTHROPIC available) rather than a direct Gemini call would give it the same resilience/observability the rest of the AI surface has — currently a single point of failure with no fallback provider.
- The `ai-brain` context/memory/prompt-versioning layer is more mature infrastructure than most callers currently exploit — worth surfacing for any new AI feature rather than rebuilding lighter-weight equivalents.

## 13/14. Mobile/Web/Admin Parity Gaps

- Vision (customer-facing, certified) has zero mobile presence on either app.
- Partner mobile lags the customer mobile app significantly in production-readiness: no EAS build profiles, no Sentry, no push notifications — while the customer app has all three, real and verified.
- Admin panel has 2 fully-built pages unreachable from nav (Vision, observability/logs) — a pure wiring gap, zero new code needed.
- `zustand` major-version mismatch (v4.5.5 customer app vs v5.0.8 partner app) — low risk today since the apps don't share code, but worth normalizing before any shared-package extraction.

## 15. Performance Risks

- `payment.service.ts` and `booking.service.ts` are 15+-import hubs — not a defect, but the highest-risk surface for accidental circular imports as Phase 8 adds more cross-cutting features; a full `madge`-style circular-dependency audit was not performed (only spot-checks, which found none) and is recommended before heavy modification of either file.
- `AppLogEntry`'s 8 single-column indexes are a write-amplification risk on a table with documented prior explosive growth (per memory: log-governance-platform).

## 16. Scalability Risks

- Assignment-dispatch's missing distributed lock (§6) and the Redis-down leader-lock fallback (§6) are both currently dormant (single-instance deployment) but become live correctness risks the moment horizontal scaling is introduced — which prior audits (enterprise-scale-audit memory: "load ceiling = CPU not pool") suggest is the intended future direction.

## 17. Observability Gaps

- No gap found in the core Sentry/Prometheus/structured-logging/log-governance stack — this area is mature. The only observability-adjacent gap is administrative: `/observability/logs` (a fully built log-search/export page) is unreachable from admin nav.

## 18. Migration Risks

- None identified requiring a Prisma migration in this discovery pass — all identified schema-level fixes (`@default([])`, new indexes) are additive, non-breaking migrations when eventually applied. Per project hazard memory, any migration touching tables with hand-written raw-SQL columns (e.g. slot-exclusion columns noted in booking-addons-pipeline memory) must use raw `ALTER`, never a blind `prisma db push`.

## 19. Dependency Graph / Recommended Order

See `PHASE_8_WORK_MANIFEST.md` for the full prioritized list with dependencies. Summary ordering logic:
1. Isolated P0 fixes with no cross-dependencies (fake AI widget removal/fix, event-bus DLQ try/catch, assignment-dispatch lock) can proceed in any order, independently and in parallel.
2. Vision governance/certification gap must be **investigated and a decision reached** before any other Vision-touching work, per the Phase 7 freeze rule.
3. P1 items are largely independent of each other (partner-mobile push, admin RBAC UI, schema null-safety, data-archival try/catch) and can proceed in parallel once P0s are clear.
4. P2/P3 cleanup items have no dependencies on anything and can be done opportunistically alongside P0/P1 work.
