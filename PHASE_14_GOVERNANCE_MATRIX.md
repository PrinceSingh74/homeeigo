# PHASE 14 — Governance Matrix

Every control below was inspected in source and exercised against a running platform. Environment:
backend `:3010` → **`homigo_p39`**, test suite → **`homigo_test`**. `homigo_db` was never written to.

`ENFORCEMENT_POINT` is where the control actually acts — not where it is described.

---

## A. AI policy engine

| Field | Value |
|---|---|
| **Control** | Centralised policy decision for every AI tool invocation |
| **Source** | `ai-tools/policy/policy-engine.ts`, `policy-rules.ts` (10 rules) |
| **Implementation** | **PRE-EXISTING, VERIFIED** — ordered rule chain, first match wins, terminal `default.allow` |
| **Enforcement point** | `ai-tools/execution/execution-engine.ts` before any handler runs |
| **Fail mode** | **FAIL-CLOSED, verified** — a throwing rule propagates; `tool-bridge` turns it into a FAILED tool result the model sees as a failure, never a silent allow |
| **Audit** | `ai_tool_policy_logs`, **every** decision including ALLOW (probe: 34 → 35 rows on one allow) |
| **Test** | `phase14-governance.test.ts` — version stamped on a persisted decision |
| **E2E** | Probe 1 — ALLOW path audited, columns enumerated |
| **RBAC** | Rules 2–4 are the RBAC check (`rbac.role_check`, `rbac.permission_check`, `resource.ownership`) |
| **Status** | **OPERATIONAL** |
| **Blocker** | — |

**Correction to my own first reading.** I initially judged the engine's trailing
`return { decision: "ALLOW", ruleMatched: "fallback.allow" }` to be an unaudited fail-open path.
It is unreachable: `default.allow` is a terminal rule that returns a decision, so the audit write
always runs. The probe proved the ALLOW was recorded. Reported because the conclusion changed
between reading and running.

### A2. Policy versioning — **DEFECT FIXED**

| Field | Value |
|---|---|
| **Defect** | `ai_tool_policy_logs` had no policy version. `ruleMatched` names a rule; it does not say what that rule *did*. Editing a rule silently changed the meaning of every historical row naming it |
| **Fix** | `POLICY_RULESET_VERSION`, derived from the rule ids rather than hand-maintained, stamped on every decision |
| **Evidence** | `ALLOW \| default.allow \| rules.v10.282c390e`; the pre-fix row beside it carries `NULL` |
| **Deliberate limit** | The hash covers rule *identity*, not rule *bodies*. Editing a rule's logic does not change it — so the version is paired with a git revision, never presented as a complete description |
| **Status** | **OPERATIONAL** |

---

### A3. Whole-project bypass search — **DEFECT FOUND AND FIXED**

§8 and §63 require searching for consequential actions that reach a provider or mutate state
outside the canonical governance path. The search found one, and it mattered:

| Property | Finding |
|---|---|
| **Defect** | `services/vision-intelligence.service.ts` called `callGeminiVision` **directly**, bypassing the AI gateway entirely |
| **What it bypassed** | AI rate limit · **the spend cap** · cost accounting · the `AiGatewayRequest` audit trail |
| **Reachability** | `POST /api/vision/images/:imageId/analyze` behind `requireAuth` — **any authenticated customer**, not an admin |
| **Severity** | The budget cap built in this phase covered one of two doors. A vision loop would have spent unbounded money that no cap could see, let alone stop |
| **Fix** | Rate limit, budget reserve/settle, cost record and AI audit applied at the call site, reusing the same services the gateway uses |
| **Why not routed through `invokeAiGateway`** | That entry expects a text conversation — messages, prompt templates, output-schema validation. Forcing an image through it would mean bending the gateway around a shape it does not have |
| **Secondary fix** | `callGeminiVision` discarded Gemini's `usageMetadata`, so every vision call reported no tokens and therefore no cost — the spend was real and the accounting was blank. It now reads real token counts, and reports `null` (a genuine UNKNOWN) when the provider omits them |
| **Route semantics** | `RATE_LIMITED → 429`, `BUDGET_EXCEEDED → 402`, so a client can tell "try later" from "the platform is out of budget" |

**Regression guard, verified by deletion.** A test walks all 579 backend source files and fails if
any file outside the router calls a provider adapter without `checkAndReserveBudget(` **and**
`settleBudget(` beside it.

Two earlier versions of that guard passed while the bypass was present, and both are worth
recording because they are the ways such a guard usually fails:

1. It accepted an `import` of `checkAndReserveBudget` as evidence of governance — so deleting the
   *call* left the test green.
2. Its regex contained a literal backspace byte — a word-boundary escape mangled during
   authoring — so it matched nothing and asserted `[] === []`.

The guard now asserts its own coverage first — the scan must find the adapters and the one governed
exception — and was confirmed by reintroducing the bypass and watching it fail.

---

## B. PII controls

| Field | Value |
|---|---|
| **Control** | Audience/purpose-scoped PII shaping; field-level encryption |
| **Source** | `lib/privacy-policy.engine.ts`, `lib/pii-crypto.ts`, `lib/prisma-pii-extension.ts`, `services/user-pii.service.ts`, `address-pii.service.ts` |
| **Implementation** | **PRE-EXISTING, VERIFIED** — `PrivacyContext{audience, purpose}`, `assertBookingAudience`, partner-safe projections |
| **Enforcement point** | Response shaping; Prisma extension for encrypted columns |
| **Fail mode** | Deny-by-default — an unmatched audience returns the masked projection |
| **Audit** | `ADMIN_ADDRESS_ACCESSED` |
| **Test** | Metric-label scan (below) + pre-existing privacy suites |
| **E2E** | 690 live label-carrying series scanned |
| **Status** | **OPERATIONAL** |

### B2. Log PII — **DEFECT FOUND AND FIXED**

Last round covered metric labels. This round covered logs, and found a real leak.

`lib/logger.ts` redacts by **key name** (`REDACT_KEYS`), which stops `{ password: "…" }` and does
nothing about `{ error: "…phone: '+919812345678'…" }` — the key is `error` and the PII is inside
the value.

That shape is not hypothetical. **Prisma echoes the arguments of a failed call into its error
message**, and this codebase logs `err.message` in dozens of places, correctly. Demonstrated: a
`prisma.user.create` with an unknown argument produced a message containing the caller's phone
number verbatim.

Scoped precisely rather than assumed:

| Error class | Leaks values? |
|---|---|
| Prisma **validation** error (unknown/missing argument) | **YES** — echoes the invocation arguments |
| Database **constraint** violation (unique, foreign key) | **No** — names the field, not the value |

**Fix:** `scrubText` at the logger's own choke point replaces a Prisma argument dump with its error
*kind*, and substitutes email and phone patterns in place.

```
raw error contains phone : YES
LOGGED contains phone    : no
logged value: {"error":"[prisma-error] Argument `password` is missing (arguments withheld)"}
normal message intact    : yes
```

Observability is preserved deliberately — the failure stays identifiable, and an ordinary error
message is untouched. Over-scrubbing would trade one problem for a worse one.

**Static-scan result across 579 files:** after excluding the `err.message` idiom, **0 logger calls
pass a PII-named field**. The five remaining flags were all local variables holding
`err.message`, verified individually.

### B3. Metric-label PII — **VERIFIED CLEAN**

Scraped `/metrics` from the running backend and parsed every label key **and value**:

| Measure | Result |
|---|---|
| Series carrying labels | **690** |
| Distinct label keys | **48** |
| Forbidden keys (`user_id`, `email`, `phone`, `prompt`, `token`, `address`, …) | **NONE** |
| PII-shaped **values** (email regex, phone, cuid/uuid, `eyJ`/`sk-`/`rzp_`/`AIza` credentials) | **NONE** |

**A false alarm I chased down rather than reported.** The `zone` label showed 61 values of the form
`Twin Zone 1788004917417` — timestamp-suffixed and apparently unbounded. It is test residue:
`homigo_p39` holds 122 such geofences, all created by `surge-alert.integration.test.ts`;
`homigo_db` holds **7 zones and zero test-named rows**. The label is bounded by real geofences in
production. Recorded because the honest finding is "my isolated database was dirty", not "the
platform has an unbounded label".

---

## C. DPDP-oriented data controls

| Field | Value |
|---|---|
| **Control** | Consent, policy versions, export, erasure, purpose limitation |
| **Source** | `ConsentRecord`, `PolicyVersion`, `ComplianceRequest`, `DataExportRequest`, `DeletionRequest`, `lib/legal-policy.ts` |
| **Implementation** | **PRE-EXISTING** — consent keyed to a policy **version**, not a boolean |
| **Enforcement point** | Compliance routes under `/api/compliance/admin/*` |
| **Fail mode** | Requests require approval (`DISPUTES/APPROVE`) |
| **Audit** | `ComplianceRequestAudit` |
| **Status** | **OPERATIONAL (technical controls)** |
| **Blocker** | **LEGAL_DECISION_REQUIRED** — no legal interpretation exists in-repo. These are DPDP-*oriented* technical controls; this phase does not and cannot assert legal compliance |

---

## D. Prompt / version audit

| Field | Value |
|---|---|
| **Control** | Every AI request traceable to the prompt version that produced it |
| **Source** | `AiPromptRegistry`, `AiPromptVersion`, `AiGatewayRequest.promptVersion` |
| **Implementation** | **PRE-EXISTING + FIXED** |
| **Enforcement point** | `ai-gateway.ts` `recordAiRequest` |
| **Immutability** | **VERIFIED** — a new version is a new row; the previous row is retained with `isActive: false`, plus a stored `diffFromPrevious` |
| **Defect fixed** | The **failure path** recorded no `promptVersion`, so a request that resolved a prompt and then errored could not be traced to it. Failures are exactly where that trace is wanted |
| **Status** | **OPERATIONAL** |

---

## E. Workflow versioning

| Field | Value |
|---|---|
| **Control** | Running instances pinned to the version they started under |
| **Source** | `automation/registry/workflow-registry.ts`, `WorkflowDefinition`, `WorkflowInstance` |
| **Implementation** | **PRE-EXISTING — the strongest control found in this phase** |
| **Enforcement point** | Boot-time fingerprint comparison; **hard boot failure** if an activated version's steps changed |
| **Fail mode** | Refuses to boot rather than run a mutated definition |
| **Immutability** | Steps frozen on activation; authorization metadata deliberately still mutable |
| **Instance pinning** | `workflowVersion` **and** `executionMode` pinned at creation — republishing as LIVE cannot turn a running rehearsal real |
| **Idempotency** | `idempotencyKey` unique (workflow + version + subject + trigger) |
| **DR** | 25 definitions restored at parity |
| **Status** | **OPERATIONAL** |

---

## F. Shadow mode

| Field | Value |
|---|---|
| **Control** | Rehearsal that cannot touch business state |
| **Source** | `automation/engine/step-executor.ts`, `AutomationShadowExecution`, `MlShadowPrediction` |
| **Implementation** | **PRE-EXISTING, VERIFIED** |
| **Enforcement point** | Step executor — ACTION/ESCALATION steps in SHADOW are **never executed**; evidence is written and the step is SKIPPED |
| **Isolation** | High-risk targets recorded `SHADOW_HIGH_RISK_BLOCKED`, everything else `SHADOW_UNSUPPORTED_ACTION`. A WAIT step's deferral is answered rather than scheduled, so no notification arrives hours later |
| **ML shadow** | `MlShadowPrediction` is the only thing the shadow path writes |
| **Live state** | 25 SHADOW / 0 LIVE definitions — a governance state, reported as such |
| **Status** | **OPERATIONAL** |

---

## G. A/B experiments — **DEFECTS FIXED**

| Field | Value |
|---|---|
| **Source** | `PlatformExperiment`, `services/dynamic-pricing.service.ts`, `platform-intelligence.service.ts` |
| **Assignment** | sha256(`experiment:customerId`) — deterministic and sticky; **verified stable** over 20 repeats |
| **Enforcement point** | `assignExperiment`, consulted per call |
| **Status** | **OPERATIONAL WITH A HUMAN DECISION OUTSTANDING** |

| # | Defect found | Fix | Evidence |
|---|---|---|---|
| G1 | **No stop switch.** The registry row was never consulted — pausing or deleting an experiment changed nothing; callers kept being bucketed and exposure kept being counted | Status read on every assignment; anything but `running` returns control for everyone and records no exposure | 200 callers: unregistered → 0 active; running → 107/200 treatment; paused → 0 active, all control |
| G2 | **Creation unaudited.** `updateFlag` beside it recorded `PLATFORM_FLAG_UPDATED`; `createExperiment` wrote a row and returned | `EXPERIMENT_CREATED` through `AuditLogService`, flagging `activatedOnCreate` | Test suite |
| G3 | **A fabricated "running" experiment in the inventory.** A code-defined experiment with no registry row was injected into the admin list as `status: "running"` — no owner, no stored variants, no off switch | Listed as `status: "unregistered"`, `registered: false`, with its suppression stated | Source |
| G4 | **The arms are identical.** `variant === "treatment" ? 1.0 : 1.0` under a comment claiming they differed. Exposure is counted, no effect exists, and `recordConversion` is **never called from production code** — so the conversion counter is permanently 0 | **Not silently fixed.** Making treatment move prices would be inventing pricing policy. Surfaced as `differentiated: false` | Test asserts `differentiated === false` |

**G4 is `HUMAN_DECISION_REQUIRED`**: what the treatment arm should do, and where `recordConversion`
should be called, are product decisions. Until then the experiment measures nothing, and now says so.

---

## H. Model versioning

| Field | Value |
|---|---|
| **Source** | `MlModelVersion` (Phase 12), `services/ml-registry.service.ts` |
| **Implementation** | **PRE-EXISTING, VERIFIED** |
| **Enforcement point** | `ALLOWED` transition map; `promote()` refuses anything not already APPROVED; `approve()` requires a ≥10-char note **and** metrics |
| **Reproducibility** | `datasetVersion`, `featureVersion`, `codeVersion`, `artifactRef`, `artifactHash`, `hyperparameters`, `seed` |
| **Integrity** | `artifactHash` **nullable** — null for warehouse-hosted models whose bytes the platform never sees, rather than a fabricated digest |
| **Single production** | Partial unique index `ON ml_model_versions(model_name) WHERE stage='PRODUCTION'` |
| **DR** | Approval survived restore with approver intact |
| **Status** | **OPERATIONAL** |

---

## I. AI budget caps — **BUILT (was entirely absent)**

| Field | Value |
|---|---|
| **Control** | Enforceable spend ceiling at the AI execution boundary |
| **Source** | `services/ai-budget.service.ts`, `AiBudgetPolicy`, `AiBudgetWindow` |
| **Implementation** | **NEW.** Before this, nothing in the platform could stop AI spend — Phase 13 measured cost precisely and a runaway loop would have been observed in high resolution all the way to the invoice |
| **Enforcement point** | `ai-gateway.ts`, after prompt composition and **before** the provider call — the last point at which nothing has been spent |
| **Concurrency** | **Atomic reserve-then-settle.** One `UPDATE … WHERE reserved+settled+amount <= limit` does the check and the increment together |
| **Fail mode** | Per policy (`FAIL_OPEN` / `FAIL_CLOSED`); "cap exceeded" and "cap unreadable" are separate decisions and never conflated |
| **UNKNOWN cost** | Increments `unknown_cost_requests`, contributes **nothing** to `settled_usd` |
| **Audit** | `AI_BUDGET_BLOCKED` / `AI_BUDGET_POLICY_CHANGED` via `AuditLogService`; ALLOW is a metric, not an audit row |
| **Observability** | `homigo_ai_budget_{limit,committed,unknown_cost_requests}_usd`, `homigo_ai_budget_decision_total` |
| **RBAC** | GET `ANALYTICS/READ`; PUT `SETTINGS/UPDATE` |
| **Status** | **OPERATIONAL — no cap configured** |
| **Blocker** | **HUMAN_DECISION_REQUIRED** — the table ships empty. `NO_POLICY_CONFIGURED` is a named, counted decision, not silence |

**§43 evidence.** 30 simultaneous requests against a cap sized for exactly 5:

```
limit $0.1380   per-request reservation $0.027600   => cap allows 5
concurrent  : 30      allowed : 5      denied : 25
committed   : $0.138000  limit $0.138
VERDICT     : PASS — cap held under concurrency
```

Committed landed on the limit exactly — not a cent over.

**Design note.** The reservation is priced against the **dearest provider in the eligible failover
chain**, not the primary. A request that starts at GROQ can be answered by OPENAI three attempts
later; pricing only the primary under-reserves every failover, and under-reserving is how a cap
silently stops capping.

---

## J. Automation frequency caps

| Field | Value |
|---|---|
| **Source** | `NotificationCadenceWindow`, `NotificationCadenceReservation` |
| **Implementation** | **PRE-EXISTING** — per-recipient daily window with a cap, plus one durable reservation row per logical notification |
| **Enforcement point** | Notification governance before send |
| **Idempotency** | `idempotencyKey` unique — a replay never takes a second slot |
| **Anti-spam** | Window rows carry the count, reservation rows carry the identity, so "five were sent" is provable from rows rather than a number. Workflow cooldown reads these because `NotificationDelivery` cannot say *which workflow asked* |
| **Status** | **PARTIAL** |
| **Gap** | Coverage is notification-shaped. There is no general "same ticket / same action within window" limiter for non-notification automation. The window sizes are also existing values this phase did not re-derive |

---

## K. Disaster recovery

| Field | Value |
|---|---|
| **Source** | `scripts/backup-postgres.sh`, `restore-postgres.sh`, `verify-backup-restore.ts`, `dr-chaos-drill.ts` |
| **Implementation** | **PRE-EXISTING + governance-aware drill executed this phase** |
| **Drill** | `pg_dump -Fc` (10,871,736 bytes, 204 TABLE DATA entries) → restore into isolated `homigo_dr_drill` → `pg_restore` **exit 0** |
| **§90 result** | **Every governance category restored at parity** |
| **Status** | **OPERATIONAL** |
| **Blocker** | **RPO/RTO are `HUMAN_DECISION_REQUIRED`** — no target exists in this project and none was invented |

See `PHASE_14_RESILIENCE_MATRIX.md` for the full table.

---

## L. Event replay — **DEFECTS FIXED**

| Field | Value |
|---|---|
| **Source** | `events/core/replay.ts`, `services/admin-automation.service.ts` |
| **Enforcement point** | `POST /api/admin/automation/dead-letters/:id/replay` |
| **RBAC** | `SETTINGS/UPDATE` — **pre-existing and correct** |
| **Idempotency** | `hasConsumerProcessed` gate; `ALREADY_PROCESSED` closes the ticket without re-running the side effect |
| **Status** | **OPERATIONAL** |

| # | Defect | Fix |
|---|---|---|
| L1 | **Audit failed open.** The only record was `activityLog.create(...).catch(() => undefined)` — a replay could re-run a consumer against a real event with **no record at all** | Canonical `EVENT_REPLAY_EXECUTED` through `AuditLogService`, recording actor, target consumer, event id/type and outcome |
| L2 | **No stated reason.** "Someone replayed event X" is a log line, not an audit | `reason` required, min 10 chars, enforced at the route and again in the service |

**On `force`.** `replayOutboxEvent({force: true})` deletes the consumer receipt — the only thing
preventing a duplicate side effect. It is **not reachable from any HTTP route**: the single caller
is `replayDeadLetterById(id)` with `force` defaulting false. Recorded as a bounded internal
capability rather than fixed, because closing a path nothing calls would be speculative.

---

## M. Stuck workflow recovery — **BUILT (was absent)**

| Field | Value |
|---|---|
| **Source** | `services/workflow-recovery.service.ts` |
| **Implementation** | **NEW.** Phase 13 exposed running-instance *age* and explicitly declined to call anything "stuck" because no threshold existed. This defines stuck without inventing one |
| **Detection** | `STALE_LEASE` (the executor's own `jobLeaseMs` predicate) · `LOST_WAKEUP` (the instance's own `nextRunAt` passed **and** no pending `ScheduledJob`) · `EXPIRED_UNTERMINATED` (the definition's own `maxAgeMs`) |
| **Recovery** | `REQUEUE`, `CANCEL` — and nothing else |
| **Concurrency** | Optimistic conditional update on the observed `status` + `updatedAt` |
| **Audit** | `WORKFLOW_INSTANCE_RECOVERED` with before/after state, version, actor, reason |
| **RBAC** | GET `ANALYTICS/READ`; POST `SETTINGS/UPDATE` |
| **Status** | **OPERATIONAL** |

**Why the vocabulary is small.** No `rewind` or `compensate`: this platform has no step-level
compensation model, so a compensating action would have to be invented per workflow at the moment
an operator most needs to trust it. `STALE_LEASE` is **reported but not actionable** — the executor
already reclaims expired leases, so an operator acting there would only race the engine.

**§60 evidence.** Two operators, same observation, simultaneously:

```
succeeded: 1   codes: LOST_RACE / RECOVERED
wake-up jobs created: 1
```

Two winners would mean two wake-ups on one instance — the next step executed twice.

**Detection precision.** A parked instance with a future `nextRunAt` and one with a pending job
were both correctly **excluded**. (My first probe reported two false failures here; it had
hard-coded `"workflow_step"` instead of importing `WORKFLOW_STEP_JOB_TYPE`, whose real value is
`"automation.workflow_step"`. The code was right and the probe was wrong.)

---

## N. Model rollback

| Field | Value |
|---|---|
| **Source** | `mlRegistryService.rollback()` |
| **Implementation** | **PRE-EXISTING, VERIFIED** |
| **Predecessor** | `supersededVersionId` recorded **at promotion time** — a stored fact, not reconstructed from timestamps later |
| **History** | The rolled-back version is retained as `ROLLED_BACK` with actor, timestamp and reason. Nothing is erased |
| **Audit** | `ML_MODEL_ROLLED_BACK` — now retained as a security event rather than a 1-year system log |
| **Status** | **OPERATIONAL** |

---

## O. Audit retention — **DEFECTS FIXED**

| Field | Value |
|---|---|
| **Source** | `services/data-retention.service.ts`, `AuditRetentionPolicy`, `RetentionJobRun`, `EnterpriseAuditLogArchive` |
| **Implementation** | **PRE-EXISTING + extended** — archive with an integrity hash, then hard delete past retention |
| **Status** | **OPERATIONAL — durations undecided for the new classes** |

| # | Defect | Fix | Evidence |
|---|---|---|---|
| O1 | **`enterprise_audit_logs.trace_id` was UNIQUE** — the audit log could hold at most ONE event per request, and every event after the first was swallowed by the audit service's own catch | Dropped the unique index, kept a plain index | `ML_MODEL_APPROVED` + `ML_MODEL_PROMOTED` on one trace: **1 stored → 2 stored** |
| O2 | **Governance acts retained as `SYSTEM_LOGS` (1 year)** — model approvals, promotions, rollbacks all fell through to the shortest bucket, while the ledger entry a workflow produced was kept for ten years | Routed to `SECURITY_EVENTS`, an existing agreed category. **No new duration invented** | Test asserts none map to `SYSTEM_LOGS`, and that financial/login mappings are unchanged |
| O3 | **Whole data classes had no retention path** | Added `AI_TELEMETRY`, `AUTOMATION_TELEMETRY`, `OPERATIONAL_ACTIVITY` + `enforceTelemetryRetention()` | Measured below |
| O4 | **`retentionExpiry` fell back to one year** for any unrecognised category — adding a category would have silently stamped a deletion date on it | Returns `null`; the purge never selects those rows | `Partial<Record<…>>` makes "no agreed duration" expressible |

**O3 — measured in production before building anything:**

| Table | Rows | Oldest | Retention before |
|---|---|---|---|
| `activity_logs` | **113,704** | 2026-06-08 | **none** |
| `ai_tool_policy_logs` | 14,607 | 2026-08-07 | **none** |
| `workflow_step_runs` | 4,053 | 2026-08-19 | **none** |
| `event_outbox` | 3,240 | 2026-08-07 | **none** |
| `ai_gateway_requests` | 2,249 | 2026-08-07 | **none** |
| `ai_gateway_audit` | 1,913 | 2026-08-07 | **none** |

The sharpest form: `AuditLogService.record` writes the **same governance event** to
`enterprise_audit_logs` (archived, purged, policy-driven) *and* to `activity_logs` (ungoverned,
kept forever). One event, two lifetimes.

**It deletes nothing today, by design:**

```
=== with NO policy rows (the shipped state) ===
  ai_gateway_requests    NO_POLICY  purged=0
  ai_gateway_audit       NO_POLICY  purged=0
  ai_tool_policy_logs    NO_POLICY  purged=0
  workflow_step_runs     NO_POLICY  purged=0
  activity_logs          NO_POLICY  purged=0
  rows before=35 after=35  PASS nothing deleted

=== with an explicit human-set policy (30 days, AI_TELEMETRY only) ===
  ai_gateway_requests    PURGED     days=30
  ai_gateway_audit       PURGED     days=30
  ai_tool_policy_logs    PURGED     days=30
  workflow_step_runs     NO_POLICY          <- independent boundary, correctly untouched
  activity_logs          NO_POLICY          <- independent boundary, correctly untouched
```

`workflow_step_runs` purges only steps of **finished** instances — deleting the history of a
running instance would erase the record of what it has already done to a customer.

---

## Summary

| Area | Status | Blocker |
|---|---|---|
| A. AI policy engine | **OPERATIONAL** | — |
| B. PII controls | **OPERATIONAL** | — |
| C. DPDP-oriented controls | **OPERATIONAL (technical)** | LEGAL_DECISION_REQUIRED |
| D. Prompt/version audit | **OPERATIONAL** | — |
| E. Workflow versioning | **OPERATIONAL** | — |
| F. Shadow mode | **OPERATIONAL** | — |
| G. A/B experiments | **OPERATIONAL** | HUMAN_DECISION_REQUIRED (treatment behaviour) |
| H. Model versioning | **OPERATIONAL** | — |
| I. AI budget caps | **OPERATIONAL** | HUMAN_DECISION_REQUIRED (the limit) |
| J. Automation frequency caps | **PARTIAL** | Non-notification automation uncovered |
| K. Disaster recovery | **OPERATIONAL** | HUMAN_DECISION_REQUIRED (RPO/RTO) |
| L. Event replay | **OPERATIONAL** | — |
| M. Stuck workflow recovery | **OPERATIONAL** | — |
| N. Model rollback | **OPERATIONAL** | — |
| O. Audit retention | **OPERATIONAL** | HUMAN_DECISION_REQUIRED (telemetry durations) |
