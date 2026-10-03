# HOMEEIGO — AI / ML / AUTOMATION AUDIT

The most accuracy-sensitive section. Every capability is classified as
**IMPLEMENTED**, **IN DEVELOPMENT**, or **ROADMAP**, and no performance improvement is claimed
anywhere, because none is measured in the repository.

---

## 1. The governing principle, enforced in code

**The LLM is not the source of truth.** Deterministic services and ML models produce facts; the LLM
explains them.

Verified: surge is computed only in `booking-pricing.service.ts`, `dynamic-pricing.service.ts`,
`geo-intelligence.service.ts`, `geofence.service.ts`, `digital-twin.service.ts` and
`platform-intelligence.service.ts`. A repository-wide search of `src/ai/`, `src/ai-brain/` and
`src/ai-tools/` finds **no surge computation** in any AI module.

## 2. AI Gateway — IMPLEMENTED

Single entry point for every LLM call (`ai/gateway/ai-gateway.ts`, `routes/ai-gateway.routes.ts`).

| Property | Verified detail |
|---|---|
| Providers | **4** — Groq, Gemini, OpenAI, Anthropic, called over direct HTTPS (no vendor SDK) |
| Failover | Ordered chain, default `GROQ → GEMINI → OPENAI`, overridable via `AI_PROVIDER_ORDER` |
| Endpoints | `/api/ai/gateway/chat`, `/api/ai/customer`, `/api/ai/partner`, `/api/ai/admin` |
| RBAC | `mapUserRoleToAiRole(userRole, endpoint)` — an unmapped role returns 403 |
| Input security | Prompt-injection screening + secret detection before any provider call |
| Output security | Output validation before the response is returned |
| Cost accounting | `AiGatewayCost` per provider/role/day, token-priced |
| Audit | `AiGatewayRequest`, `AiGatewayAudit`, prompt hashing |

**Benefit:** provider outages degrade rather than break the feature, and every AI call is auditable
and cost-attributed. **No latency or quality improvement is claimed.**

## 3. AI Tool layer — IMPLEMENTED, with a deliberate freeze

Runtime enumeration of `TOOL_CATALOG`: **55 tools — 29 READ, 12 WRITE, 14 HIGH_RISK.**

| Category | Count | Bound in production |
|---|---|---|
| READ | 29 | 29 / 29 |
| WRITE | 12 | 12 / 12 |
| **HIGH_RISK** | **14** | **0 / 14 — fail-closed** |

All 14 high-risk tools are `riskLevel: CRITICAL`, `approvalRequired: true`, and cover refunds,
wallet adjustments, settlements, payouts, ledger entries, account freeze, partner suspension,
customer ban, role escalation, feature flags, secrets, configuration and infrastructure.
`financialSandboxVerdict()` returns `{allowed:false, reason:"PRODUCTION_ENVIRONMENT"}`, so
`registerToolHandlers` binds **none** of them. The catalog is byte-identical to the Phase-5 freeze
commit `7ce2e71`.

**Execution pipeline (verified):**
`tool registry → policy engine → actor resolution → approval gate → handler → service → database → audit → response`.

Controls proven by service-backed execution against an isolated database:
- Identity is server-derived (`resolveProviderId(actor.actorId)`); arguments are never trusted for
  ownership.
- **9 of 9 attack cases denied** — cross-role, IDOR, `actorId` spoofing, injected
  `admin:true`/`allUsers:true`/`role:"ADMIN"`, self-asserted `confirmed:true`, forged `approvalId` —
  with zero domain mutation. Positive controls confirm the engine is not simply denying everything.
- Idempotency: replay of a key returns the prior outcome; 5 concurrent same-key calls produced
  exactly **1** row.
- Circuit breaker and retry, with business refusals excluded from both (see §4).

> **Methodology warning for future audits:** a grep of the tool catalog reports 41 tools and **zero**
> high-risk, because the 14 high-risk entries are generated from a compact `([...] as const).map(...)`
> literal. Only runtime enumeration is authoritative.

## 4. AI Brain — IMPLEMENTED

`src/ai-brain` (23 files): enterprise context engine with six collectors (customer, partner, admin,
finance, operations, support), prompt registry with approval status and versioning, context cache
with actor-isolation checks, context snapshots, activity timeline, and memory
(`AiMemory`, 10 memory types with per-type TTL).

**Notable safety property:** the context cache re-checks actor/role ownership **on read**, not just
on cache-key construction — so a key-format change cannot leak one user's assembled context to
another.

## 5. Machine learning — IMPLEMENTED (BigQuery ML), with honest gaps

| Model | Technique | Input | Output | Status |
|---|---|---|---|---|
| `model_demand_forecast` (+ daily, weekly, city) | `ML.FORECAST` — ARIMA_PLUS | historical booking volume | predicted demand per horizon with confidence interval | **IMPLEMENTED** |
| `model_eta` | `ML.PREDICT` | trip features | ETA estimate | **IN DEVELOPMENT** — candidate MAE 98.3 s; promotion blocked at 0/50 real labels |
| `model_fake_gps` | `ML.PREDICT` | location telemetry | anomaly signal | **IN DEVELOPMENT** |

**Confidence is derived, not asserted:** demand confidence = inverse of mean relative
confidence-interval width, clamped to 0.5–0.97. On live data it currently reports **0.5** — the
floor — which honestly indicates wide intervals on sparse data.

**Failure behaviour:** the `intel()` wrapper **throws** when a model is unavailable rather than
returning a default, and consumers translate that into an explicit `MODEL_UNAVAILABLE` state. No
fabricated model score exists anywhere.

**ETA training data — recorded limitation:** the supplied dataset was quarantined
(`is_training_eligible = false`) because its own sheets contradicted the row count and a duration
bound was wrong by 2.2×. This is a deliberate refusal to train on unverified data.

## 6. Geo-Intelligence — IMPLEMENTED

`/api/geo-intel/*` — **8 endpoints**: `demand-forecast`, `surge`, `zone-scoring`,
`provider-density`, `revenue-forecast`, `eta`, `fraud`, `exec-kpis`.

Every response carries `confidence`, `freshness`, `source` and `generatedAt`, with L1/L2 caching and
bounded Prometheus labels. Consumed by partner web (`use-partner-intelligence.ts`, 60 s refresh),
partner mobile, and the admin console.

**Verified live values:** 7 zones with real variance — surge 1.00–3.00, active bookings 0–24,
demand delta −100 % to +2300 %.

## 7. Vision intelligence — IMPLEMENTED, governance decision outstanding

`vision-intelligence.service.ts` calls Gemini vision via Vertex AI. `VisionObservationMode` is
`REAL_PROVIDER` or `FALLBACK`; a failed provider call is deliberately recorded as `REAL_PROVIDER`
with a `PROVIDER_ERROR` flag so "no provider" and "provider broken" stay distinguishable.

**Status: HUMAN_DECISION_REQUIRED.** With a real `GEMINI_API_KEY` configured, the service returns
`REAL_PROVIDER` today; the governance choice about that exposure is unresolved and is recorded, not
decided.

## 8. Partner Intelligence — IMPLEMENTED (foundation + one capability), flag OFF

Built during this audit cycle and deliberately not activated.

| Capability | Status |
|---|---|
| `PartnerIntelligenceContext` (`pi.rules.v1`) — 9 signals | **IMPLEMENTED**, 32 tests |
| Zone Recommendations (`zone.rules.v1`) | **IMPLEMENTED**, 17 tests, flag OFF |
| Earnings Coach | **IN DEVELOPMENT** |
| Shift planning, nudges, morning briefing, surge alerts, copilot | **ROADMAP** |

Every signal carries `state`, `value`, `source`, `observedAt`, `freshness`, `confidence` and a
`reasonCode`. Missing signals become `UNAVAILABLE` / `STALE` / `INSUFFICIENT_DATA` /
`MODEL_UNAVAILABLE` — never `0`, `false` or `[]`.

**A finding worth stating plainly:** the platform's operational `zoneScoring.compositeScore` is
**inverted for partners** — because `serviceHealth = activeBookings === 0 ? 100 : …`, an idle zone
scores 100. Measured live: a zone with 0 active bookings ranked first at composite 100, while a zone
with 24 waiting bookings and 2.88× surge ranked last at composite 1. Partner ranking therefore uses
its own dimensions and carries the platform score only as evidence.

## 9. Automation engine — IMPLEMENTED

`EVENT → CONDITION → GOVERNANCE → ACTION`, with **14 registered workflows**:

| Workflow | Domain |
|---|---|
| `PARTNER_LEAD_INTAKE`, `PARTNER_LEAD_FOLLOWUP` | acquisition |
| `PARTNER_ONBOARDING_NUDGE`, `PARTNER_KYC_REMINDER`, `PARTNER_TRAINING_REMINDER` | onboarding |
| `PARTNER_APPROVAL_ESCALATION`, `PARTNER_APPROVED_NOTIFY`, `PARTNER_CHANGES_REQUESTED_RESUME`, `PARTNER_WELCOME` | activation |
| `PAYMENT_RECOVERY`, `CHECKOUT_RECOVERY` | revenue recovery |
| `REVIEW_REQUEST`, `FOLLOW_UP` | retention |
| `ENGINE_SELFTEST` | platform assurance |

**Governance before every send:** `routeNotification` → quiet hours → preferences → cadence →
cooldown → channel policy → containment → decision audit. Shadow mode (`executionMode: LIVE | SHADOW`)
lets a workflow compute what it *would* have done without sending.

**Certification is hardened:** `certifyAutomation` defaults to `SHADOW` and requires a real human
approver; `assertLiveAllowed` blocks uncertified LIVE. Its comment records the incident that
motivated it — a system actor once certified nine workflows LIVE with no human involved.

**What automation replaces:** manual lead chasing, manual KYC/training reminders, manual approval
escalation, manual payment-recovery outreach and manual review requests.
**Benefit:** consistency, auditability and lower manual workload. **No time-saved figure is claimed.**

## 10. Scheduled operations — IMPLEMENTED

**18 leader-locked timers** (`runWithLeaderLock`, Redis `SET NX EX` with in-memory fallback):
location retention, OTP cleanup, reconciliation, backup, deletion, assignment, finance
reconciliation, integrity, settlement sync, alert evaluation, ops-alert dispatch, archival, token
cleanup, retention tick, refund retry, AI-brain maintenance, incentive evaluation, ETL.

Leader locking is what makes these safe to run on more than one instance.

## 11. What is explicitly NOT claimed

- No measured improvement in dispatch efficiency, conversion, earnings or latency — the repository
  contains no such measurement.
- No autonomous financial action by AI — the 14 financial/administrative tools are unbound.
- No government or vendor KYC verification.
- No emergency-services dispatch.
- No AI involvement in surge, pricing or authorization decisions.
