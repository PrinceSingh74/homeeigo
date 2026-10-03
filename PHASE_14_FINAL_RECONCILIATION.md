# PHASE 14 — Final Reconciliation

**Date:** 2026-09-05 (second forensic pass; first pass 2026-09-04)
**Scope:** governance, experimentation and production hardening across the whole platform.
**Environment:** backend `:3010` → **`homigo_p39`** · tests → **`homigo_test`** · DR drill →
**`homigo_dr_drill`**. **`homigo_db` was never written to.** No production deployment. No
destructive migration.

---

## A. Executive verdict

**`PHASE_14_COMPLETE_WITH_FOLLOWUPS`**

Fifteen requirement areas. Thirteen operational, one partial, one operational-but-legally-unclosed.
Two areas were **built from nothing** — AI spend caps and stuck-workflow recovery, neither of which
existed in any form. **Eleven** real defects were found and fixed across two forensic passes; one
of them has been silently destroying governance audit records in production since the table was
created, and **is still doing so** — the fix is verified and rehearsed but not deployed.

The second pass (this one) was not a formality. Re-auditing from zero, on the assumption that the
first pass was wrong, found **four further defects the first pass had missed**, including one that
made the phase's headline control incomplete:

| # | Found in pass 2 | Why the first pass missed it |
|---|---|---|
| **P1** | `vision-intelligence.service` reached a paid AI provider **directly**, bypassing the spend cap, rate limit, cost accounting and audit — reachable by any authenticated customer | Pass 1 verified the gateway *was* governed; it never asked whether the gateway was the **only** door |
| **P2** | Prisma echoes call arguments into error messages, so `logger.error(…, { error: err.message })` wrote a customer's phone number into the logs | Pass 1 scanned metric labels and stopped there |
| **P3** | Governance acts could succeed with their audit silently lost — `void AuditLogService.success(...)` discarded the promise on model promote/approve/rollback | Pass 1 named this a "known limitation" and left it |
| **P4** | `callGeminiVision` discarded Gemini's token usage, so every vision call reported zero cost | Not reached — it sits behind P1 |

The pattern worth naming: pass 1 verified that each control *worked*. Pass 2 asked whether anything
could get **past** it. Those are different questions, and the second one is where the defects were.

The phase's most useful finding is not a feature. It is that this platform could **measure**
almost everything and **stop** almost nothing. Phase 13 had made AI cost accurate to eight decimal
places, and a runaway agent loop would have been observed in exquisite detail all the way to the
invoice. Governance is the layer that says no, and much of it was reporting.

The follow-ups are not unfinished code. They are `HUMAN_DECISION_REQUIRED` (what the cap should
be, what the experiment's treatment arm should do, how long AI telemetry lives, RPO/RTO, ownership)
and `EXTERNAL_ARTIFACT_REQUIRED` (BigQuery billing, backup encryption verification, legal
interpretation). Writing code to close any of them would mean inventing a decision nobody made.

---

## B. Previous claim vs current reality

There was no prior Phase-14 report to re-audit. What existed were **implicit claims made by the
code and the admin console**, and those are what this phase tested.

| Implicit claim | Verdict | What was actually true |
|---|---|---|
| "`surge_v1` is a running experiment" (admin console) | **FALSE** | Injected into the list as `status: "running"` with no registry row, no owner, no stop switch, and two arms returning the same number |
| "Experiments can be paused" | **FALSE** | The status column was never read. Pausing changed nothing |
| "The audit log records governance actions" | **PARTIALLY FALSE** | `trace_id` was UNIQUE — at most **one** event per request; every event after the first was swallowed by the audit service's own catch |
| "Governance actions are retained" | **FALSE** | Model approvals, promotions and rollbacks fell through to `SYSTEM_LOGS` — **one year** |
| "Replaying a dead letter is audited" | **PARTIALLY FALSE** | An `activityLog.create(...).catch(() => undefined)` — audit failed open on exactly the operation that most needs a trail, and no reason was captured |
| "AI cost is controlled" | **FALSE** | Cost was *measured*. Nothing anywhere could stop spend |
| "Policy decisions are auditable" | **TRUE, and I was initially wrong to doubt it** | I read the engine's trailing `fallback.allow` as an unaudited fail-open path. It is unreachable — `default.allow` is a terminal rule and the audit always runs. The probe proved it: 34 → 35 rows on one ALLOW |
| "Policy decisions are reconstructable" | **FALSE** | No policy version. `ruleMatched` names a rule; it does not say what that rule did |
| "Workflow versions are immutable" | **TRUE** | The strongest control on the platform — editing an activated version is a **hard boot failure** |
| "Shadow mode cannot touch business state" | **TRUE** | ACTION/ESCALATION steps are never executed in SHADOW; evidence is written instead |
| "Prompt history is preserved" | **TRUE** | New version = new row; previous retained with a stored diff |
| "Model promotion requires approval" | **TRUE** | `promote()` refuses anything not `APPROVED`; approval requires a person, a note and metrics |
| "No PII in metrics" | **TRUE** | 690 live series, 48 label keys, 0 forbidden keys, 0 PII-shaped values |

---

## C. AI Policy Engine

**PRE-EXISTING, VERIFIED — plus one fix.**

Ten ordered rules, first match wins, terminal `default.allow`. Enforced in the tool execution
engine before any handler runs. **Fail-closed, verified**: a throwing rule propagates, and
`tool-bridge` turns it into a FAILED tool result the model sees as a failure — never a silent
allow. Every decision is audited, including ALLOW.

**Fixed — no policy version (§10).** `ai_tool_policy_logs` recorded *which* rule fired but nothing
about what that rule contained. Editing a rule silently rewrote the meaning of every historical row
naming it. `POLICY_RULESET_VERSION` is now derived from the rule ids — not hand-maintained,
because a hand-maintained constant is one someone forgets to bump, and a version that silently
stops changing asserts a stability that is not there.

```
ALLOW | default.allow | rules.v10.282c390e     <- after
REQUIRES_APPROVAL | high_risk.approval_required | (null)   <- before, deliberately not backfilled
```

Backfilling old rows with the current version would assert something untrue about the past.

**Stated limit:** the hash covers rule *identity*, not rule *bodies*. Editing a rule's logic does
not change it, so the version is paired with a git revision and never presented as complete.

---

## D. PII Controls

**PRE-EXISTING, VERIFIED CLEAN.**

Live `/metrics` scrape, parsed by label key **and value**: 690 series, 48 distinct keys, **0**
forbidden keys, **0** values matching email, phone, cuid/uuid or credential patterns. Checking
values matters — a label named `subject` carrying a cuid passes a key-only audit and still
publishes a user identifier.

Purpose limitation is real and narrow: address disclosure to a partner requires **both**
`purpose === "booking_fulfilment"` **and** an active fulfilment status. A partner who finished
yesterday cannot read the address today.

**Logs — a real leak, found in pass 2 and fixed.** `lib/logger.ts` redacts by **key name**, which
stops `{ password: … }` and does nothing about `{ error: "…phone: '+919812345678'…" }`. Prisma
echoes the arguments of a failed call into its error message, and this codebase logs `err.message`
in dozens of places, correctly. Demonstrated: a `prisma.user.create` with an unknown argument
produced a message containing the caller's phone number verbatim.

Scoped rather than assumed — a *database constraint* violation names the field and not the value;
only Prisma's *client-side validation* errors echo arguments. `scrubText` now replaces an argument
dump with its error kind at the logger's own choke point:

```
raw error contains phone : YES
LOGGED contains phone    : no
logged value: {"error":"[prisma-error] Argument `password` is missing (arguments withheld)"}
normal message intact    : yes
```

Observability is preserved deliberately: the failure stays identifiable and ordinary messages are
untouched. Across 579 files, **0 logger calls pass a PII-named field** once the `err.message` idiom
is excluded — the five remaining flags were each verified to be local error strings.

**A false alarm I chased down rather than reported.** The `zone` label showed 61 timestamp-suffixed
values (`Twin Zone 1788004917417`) — apparently unbounded cardinality. It is test residue:
`homigo_p39` holds 122 such rows, all from `surge-alert.integration.test.ts`; `homigo_db` holds
**7 zones and zero test-named rows**. The label is bounded in production. Reported because the
honest finding was "my isolated database was dirty", not "the platform has a defect".

---

## E. DPDP-Oriented Controls

**OPERATIONAL (technical) — `LEGAL_DECISION_REQUIRED`.**

Consent is recorded against a policy **version**, not a boolean. Export, deletion and compliance
requests are tracked and approval-gated. Field-level encryption covers sensitive columns.
Processing traceability runs through the audit log.

What does not exist is any legal interpretation: no document states which DPDP obligations apply,
what lawful basis each purpose relies on, or what retention the law requires. **These are
DPDP-*oriented* technical controls. This phase does not assert compliance**, and building controls
does not produce it.

Specifically unresolved and deliberately not invented: whether a deletion request should erase
financial and KYC evidence. This phase neither deleted audit evidence to satisfy a request nor
invented an exemption to justify keeping it.

---

## F. Prompt / Version Audit

**PRE-EXISTING + ONE FIX.**

Immutability verified: a new version is a new row, the previous retained with `isActive: false` and
a stored `diffFromPrevious`.

**Fixed:** the gateway's **failure path** recorded no `promptVersion`. A request that resolved a
prompt and then errored could not be traced back to the prompt that produced it — and failures are
exactly where that trace is wanted. "Which prompt version was serving when this started erroring"
is unanswerable if only successes carry the version.

---

## G. Workflow Versioning

**PRE-EXISTING — the strongest control found in this phase. No changes.**

Steps are frozen on activation and compared by fingerprint at boot; a changed activated version is
a **hard boot failure**, not a warning. Instances pin both `workflowVersion` **and**
`executionMode`, so republishing a definition as LIVE cannot quietly turn a running rehearsal real.
`idempotencyKey` is unique per workflow + version + subject + trigger.

25 definitions restored at parity in the DR drill.

---

## H. Shadow Mode

**PRE-EXISTING, VERIFIED. No changes.**

In SHADOW, ACTION and ESCALATION steps are **never executed** — evidence is recorded and the step
is SKIPPED, with high-risk targets distinguished (`SHADOW_HIGH_RISK_BLOCKED`) from merely
unsupported ones. A WAIT step's deferral is answered rather than scheduled, so a rehearsal cannot
produce a real notification hours later when nobody is watching.

`MlShadowPrediction` is the only thing the ML shadow path writes.

Live state: **25 SHADOW / 0 LIVE** — a governance posture, reported as one.

---

## I. A/B Experiments

**FOUR DEFECTS. Three fixed, one deliberately escalated.**

| # | Defect | Resolution |
|---|---|---|
| G1 | **No stop switch** — the registry row was never consulted; pausing changed nothing | Status read per assignment. Verified: unregistered 0/200 active, running 200/200, paused 0/200 |
| G2 | **Creation unaudited** while the feature-flag change beside it was audited | `EXPERIMENT_CREATED`, flagging `activatedOnCreate` |
| G3 | **A fabricated running experiment** in the admin inventory | Listed as `unregistered`, `registered: false`, suppression stated |
| G4 | **The arms are identical** and no outcome is ever recorded | **Escalated, not fixed** |

G4 in full: `variant === "treatment" ? 1.0 : 1.0`, under a comment claiming the arms differed —
and `recordConversion` is **never called from production code**, so the conversion counter is
permanently zero. The experiment buckets users, counts exposure, applies no difference and observes
no outcome.

Making treatment move prices would be **inventing pricing policy**. That is a business decision and
not one to smuggle in behind a governance fix, so the state is surfaced instead:
`differentiated: false` on every assignment, with a test asserting it.

Assignment itself is sound: sha256 bucketing, deterministic (20 repeats → 1 variant), stateless, so
no cached assignment can survive a stop.

---

## J. Model Versioning

**PRE-EXISTING (Phase 12), VERIFIED.**

`ALLOWED` transition map; PRODUCTION reachable only through `promote()`, which refuses anything not
`APPROVED`; approval requires a person, a ≥10-char note and metrics; one production version per
model enforced by a partial unique index; `supersededVersionId` recorded **at promotion time** so
the rollback target is a stored fact rather than something reconstructed from timestamps later.

`artifactHash` is nullable **on purpose** — null for warehouse-hosted models whose bytes this
platform never sees, rather than a fabricated digest.

No model is in governed PRODUCTION. Four warehouse models are marked production with no governed
approval — surfaced as `registry_reconciliation = WARN`.

---

## K. AI Budget Caps

**BUILT. Nothing existed before — every prior "budget" in the codebase was a token or timeout
budget, not money.**

Enforced in `ai-gateway.ts` after prompt composition and **before** the provider call: the last
point at which nothing has been spent. A cap enforced after the provider answers is a report.

**Reserve-then-settle**, because AI cost is only knowable *after* the call. A pre-flight check
against settled spend lets N concurrent requests all read the same headroom and all proceed — the
cap becomes a suggestion exactly when it matters most. One atomic statement does the check and the
increment together:

```sql
UPDATE ai_budget_windows
   SET reserved_usd = reserved_usd + $amt, request_count = request_count + 1
 WHERE policy_id = $p AND window_key = $w
   AND reserved_usd + settled_usd + $amt <= $limit
```

**§43 evidence — 30 simultaneous requests against a cap sized for exactly 5:**

```
allowed : 5      denied : 25
committed : $0.138000   limit : $0.138
PASS — cap held under concurrency
```

Exact, not a cent over.

The reservation is priced against the **dearest provider in the eligible failover chain**, not the
primary — a request starting at GROQ can be answered by OPENAI three attempts later, and pricing
only the primary under-reserves every failover.

Four decisions are kept distinct and never collapsed: `ALLOW`, `NO_POLICY_CONFIGURED`,
`BUDGET_EXCEEDED`, `BUDGET_UNAVAILABLE`, `UNPRICED_PROVIDER`. "No cap is set" and "the cap store is
unreachable" both permit the request and mean opposite things to whoever is on call.

**It ships with no cap.** `ai_budget_policies` is empty and `NO_POLICY_CONFIGURED` is counted, so
the absence is visible rather than silent. Seeding a number would either control nothing or break
AI in production. **`HUMAN_DECISION_REQUIRED`.**

---

## L. Automation Frequency Caps

**PARTIAL — pre-existing, real, and narrower than the requirement.**

`NotificationCadenceWindow` carries the count and cap; `NotificationCadenceReservation` carries one
durable row per logical notification with a unique `idempotencyKey`, so "five were sent" is
provable from rows rather than from a number, and a replay never takes a second slot. Workflow
cooldown reads these because `NotificationDelivery` cannot say *which workflow asked*.

**Gap:** coverage is notification-shaped. There is no general "same ticket / same action within
window" limiter for non-notification automation. The window sizes are also pre-existing values this
phase did not re-derive.

---

## M. Disaster Recovery

**OPERATIONAL — drill executed with a governance-specific question.**

A restore that returns bookings and payments but loses *who approved the model that was serving*
has restored the business and lost the governance. §90 makes that the test.

```
pg_dump -Fc          : 10,871,736 bytes
pg_restore --list    : 204 TABLE DATA entries
restore → homigo_dr_drill : exit 0
```

**All 10 governance tables restored at parity.** The 11th, `enterprise_audit_logs`, showed
16,568 vs 16,563 — and that was verified, not assumed:

```
src rows at or before the snapshot instant : 16,563
restored                                   : 16,563
PASS — complete as of the snapshot instant
```

The gap is rows the live backend wrote *after* the dump. That is the concrete meaning of RPO here.

Content, not just counts: **16,563 of 16,563 audit hashes preserved**, ML approval intact with
approver, budget cap intact with fail mode, experiment state intact.

**RPO and RTO remain `HUMAN_DECISION_REQUIRED`** — no target exists and none was invented.

*(The drill's first run reported total failure. Git Bash rewrote the container path
`/tmp/p14_dr.dump` into a Windows path before `docker exec` saw it, so `pg_dump` wrote nothing.
Recorded because a harness artefact that looks like a system failure is exactly what gets
misreported.)*

---

## N. Event Replay

**TWO DEFECTS FIXED.**

**L1 — audit failed open.** The only record was
`prisma.activityLog.create(...).catch(() => undefined)`. A replay could re-run a consumer against a
real event with **no record at all**, and it was an `ActivityLog` row rather than the canonical
governance audit. Now `EVENT_REPLAY_EXECUTED` through `AuditLogService`, carrying actor, target
consumer, event id and type, and outcome.

**L2 — no stated reason.** "Someone replayed event X" is a log line, not an audit. A ≥10-character
reason is now required at the route and again in the service.

Idempotency was already sound: the `hasConsumerProcessed` gate returns `ALREADY_PROCESSED` and
closes the ticket rather than re-running the side effect.

**On `force`:** `replayOutboxEvent({force: true})` deletes the consumer receipt — the only thing
preventing a duplicate consequential side effect. It is **not reachable from any HTTP route**; the
single caller passes `force` defaulting false. Recorded as a bounded internal capability rather
than fixed, because closing a path nothing calls would be speculative. Any future caller must gate
it.

---

## O. Stuck Workflow Recovery

**BUILT. Nothing existed — Phase 13 exposed instance *age* and explicitly declined to call anything
"stuck" because no threshold existed.**

Each condition is derived from a value the system already had, so no threshold was invented:

- **`STALE_LEASE`** — the executor's own `jobLeaseMs` predicate.
- **`LOST_WAKEUP`** — the instance's own `nextRunAt` has passed **and** no pending `ScheduledJob`
  references it. Nothing will ever move it again.
- **`EXPIRED_UNTERMINATED`** — past the definition's own `maxAgeMs`.

A parked instance with a future wake-up is **healthy** and never reported.

Recovery is **`REQUEUE` and `CANCEL`, and nothing else.** No "rewind" or "compensate": this
platform has no step-level compensation model, so a compensating action would have to be invented
per workflow at the moment an operator most needs to trust it. `STALE_LEASE` is reported but
**not actionable** — the executor already reclaims expired leases, so an operator would only race
the engine.

**§60 — two operators, same observation, simultaneously:**

```
succeeded: 1   codes: LOST_RACE / RECOVERED
wake-up jobs created: 1
```

Two winners would mean two wake-ups on one instance and the next step executed twice. The winner is
decided by an optimistic conditional update carrying the observed `status` and `updatedAt`.

*(My first probe reported two false failures here. It hard-coded `"workflow_step"` where the real
constant is `"automation.workflow_step"`. The code was right; the probe was wrong. It now imports
the constant rather than re-typing it.)*

---

## P. Model Rollback

**PRE-EXISTING, VERIFIED.** Predecessor stored at promotion time; the rolled-back version retained
as `ROLLED_BACK` with actor, timestamp and reason — nothing erased. Rollback cannot mix feature
versions because `featureVersion` is pinned per version and rollback selects a stored version
rather than reconstructing one.

Its audit record is now retained for seven years instead of one.

---

## Q. Audit Retention

**FOUR DEFECTS FIXED. The most serious findings of the phase.**

**O1 — `enterprise_audit_logs.trace_id` was UNIQUE.** The audit log could hold **at most one event
per request**, and every event after the first failed its insert and was swallowed by the audit
service's own catch. Demonstrated:

```
events emitted : 2
events stored  : 1  -> ML_MODEL_APPROVED            (before)
events stored  : 2  -> ML_MODEL_APPROVED, PROMOTED  (after)
```

An approval and the promotion it authorises are precisely the pair that share a request — so the
single most consequential two-event sequence in the ML lifecycle was the one guaranteed to lose its
second half. The trail was thinnest on the complex actions an investigation cares about. Nothing
depended on the uniqueness; the only `findUnique` on the table is by `id`.

**How much was lost historically is unknowable by construction** — the dropped rows were never
written. `homigo_db` holds 336,380 audit rows with 336,380 distinct traces, which is what the
constraint forced. Most callers pass no `traceId` and get a fresh UUID, which is why this went
unnoticed.

**O2 — governance acts retained as `SYSTEM_LOGS` (one year).** Model approvals, promotions,
rollbacks, budget refusals, replays, recoveries and experiment activations all fell through to the
shortest bucket — while the ledger entry a workflow produced was kept for ten years. Routed to
`SECURITY_EVENTS`, an **existing agreed category**; no new duration invented.

**O3 — whole data classes had no retention path at all.** Measured in production first:

| Table | Rows | Oldest | Retention before |
|---|---|---|---|
| `activity_logs` | **113,704** | 2026-06-08 | none |
| `ai_tool_policy_logs` | 14,607 | 2026-08-07 | none |
| `workflow_step_runs` | 4,053 | 2026-08-19 | none |
| `event_outbox` | 3,240 | 2026-08-07 | none |
| `ai_gateway_requests` | 2,249 | 2026-08-07 | none |
| `ai_gateway_audit` | 1,913 | 2026-08-07 | none |

The sharpest form: `AuditLogService.record` writes the **same governance event** to
`enterprise_audit_logs` (archived, purged, policy-driven) *and* to `activity_logs` (ungoverned,
kept forever). One event, two lifetimes.

Three categories added with a sweep that **deletes nothing today**:

```
with NO policy rows (the shipped state):  all five tables NO_POLICY, 35 rows -> 35 rows
with an AI_TELEMETRY policy (30 days)  :  AI tables PURGED; workflow and activity still NO_POLICY
```

Independent boundaries, as §64 requires. `workflow_step_runs` purges only steps of **finished**
instances — deleting a running instance's history would erase the record of what it has already
done to a customer.

**O4 — `retentionExpiry` fell back to one year** for any unrecognised category. Adding a category
would have silently stamped a deletion date on it. It now returns `null`, and both retention maps
became `Partial<Record<…>>` so that "no agreed duration" is expressible. The compiler had been
demanding a number for each new category; a total map is exactly how an invented duration becomes
policy — not by decision, but by an entry someone adds to silence an error.

---

## R. Cross-Phase Governance

| Phase | Integration | Result |
|---|---|---|
| 9 — Executive AI | Scheduled reporting inherits budget enforcement at the gateway | **PASS** |
| 10 — Support | Support AI passes the same cap, policy engine and audit | **PASS** |
| 11 — RAG | Knowledge answers route through `invokeAiGateway`, so they are now budget-governed | **PASS** |
| 12 — MLOps | Registry verified, not rebuilt; approval/promotion/rollback audit now retained 7y | **PASS** |
| 13 — Observability | Budget and stuck-workflow gauges registered through the existing `registerScrapeSampler`, on the same boards — no second stack | **PASS** |
| Finance / booking / payment | Untouched | **PASS** — no change to any money path |

No duplicate policy engine, experiment service, audit service, RBAC, registry or observability
stack was created. Every new control extends an existing one.

---

## S. Security

| Property | Result |
|---|---|
| Unauthorized policy update | **N/A** — rules are code, not data; changing them requires a deploy |
| Unauthorized experiment creation | **DENIED** — `/api/admin/*`, RBAC-mapped |
| Unauthorized model promotion | **DENIED** — `SETTINGS/APPROVE` |
| Unauthorized rollback | **DENIED** — `SETTINGS/APPROVE` |
| Unauthorized replay | **DENIED** — `SETTINGS/UPDATE`, and now requires a stated reason |
| Unauthorized workflow recovery | **DENIED** — `SETTINGS/UPDATE` (new mapping) |
| Unauthorized budget change | **DENIED** — `SETTINGS/UPDATE` (new mapping) |
| Unauthorized retention execution | **DENIED** — `AUDIT_LOGS/READ` for reporting; execution is system-scheduled |
| Audit mutation | **No update/delete path exists** outside the retention job |
| Unmapped admin route | **DENIED BY DEFAULT** — the property that makes adding a governance route safe |

**Prompt injection (§97).** Untrusted text — user prompts, ticket bodies, RAG documents — reaches
no governance decision. The policy engine reads tool metadata and actor role; the budget reads
token counts and provider; RBAC reads the admin session; promotion reads the registry. **None of
them read prompt content**, so there is no path from injected text to a policy, budget, approval or
promotion outcome.

**Data injection (§98).** `policyName`, `experimentName`, `modelVersion` and `workflowName` are
stored and compared as strings; nothing evaluates them. Workflow definitions are **code**, and the
database row is a frozen snapshot that "can never introduce new behaviour, only describe behaviour
that already exists in code".

**Secrets (§70).** 0 credential-shaped values across 690 metric series. `EncryptionKey` material is
never logged.

---

## S2. Whole-project bypass search

§8 and §63 require hunting for consequential actions outside the canonical path — and forbid
settling for a report that merely notes one.

**Found: `services/vision-intelligence.service.ts` called `callGeminiVision` directly.** It reached
a paid provider without the AI gateway, and therefore without the rate limit, **the spend cap**,
cost accounting or the `AiGatewayRequest` audit trail. The route behind it,
`POST /api/vision/images/:imageId/analyze`, is `requireAuth` — any authenticated customer, not an
admin. A cap that covers one of two doors is not a cap, and this one was the door with no
attribution.

**Fixed** by applying the rate limit, budget reserve/settle, cost record and AI audit at the call
site — reusing the same services the gateway uses rather than reimplementing them. It is not routed
*through* `invokeAiGateway` because that entry expects a text conversation; forcing an image through
it would mean bending the gateway around a shape it does not have.

**A second defect behind the first:** `callGeminiVision` never read Gemini's `usageMetadata`, so
every vision call reported no tokens and therefore no cost. The spend was real and the accounting
was blank. It now reads real counts and reports `null` — a genuine UNKNOWN — when the provider
omits them.

**Guard, verified by deletion.** A test walks all 579 backend source files and fails if any file
outside the router calls a provider adapter without `checkAndReserveBudget(` and `settleBudget(`
beside it. Two earlier versions of that guard passed while the bypass was present: the first
accepted an *import* as evidence of governance, the second contained a literal backspace byte from
a mangled escape and matched nothing at all. The guard now asserts its own coverage before
asserting the result, and was confirmed by reintroducing the bypass and watching it fail.

**Clean elsewhere:** tool execution reaches `executeTool` in both call sites; `routeModelRequest`
is exported but imported by no route; the refund handler requires sandbox clearance, an approval id
and an ADMIN role, and passes an idempotency key the financial service checks itself.

---

## S3. Audit failure is now fail-closed for governance acts

Pass 1 recorded "audit persistence fails open" as a known limitation. §46 does not permit that for
high-risk governance, so pass 2 closed it.

`AuditLogService.recordGoverned` writes the enterprise audit row, **checks the returned id**, and
throws when it is absent. Awaiting alone would not have been enough — `enterpriseAuditService.log`
catches its own errors and returns `null`, so the failure this method exists to surface would have
been swallowed by the very call meant to detect it.

Applied to: model approve / promote / rollback (which were `void`-discarded promises), budget policy
change, event replay and workflow recovery.

**Verified with a real outage**, not a stub — the audit table was renamed away in the isolated
database so the insert genuinely failed:

```
=== audit table PRESENT ===
governed act                 returned normally
=== audit table RENAMED AWAY ===
governed act                 THREW  GOVERNANCE_AUDIT_UNAVAILABLE: ML_MODEL_PROMOTED could not be recorded
LOGIN (must stay open)       returned normally

healthy governed act succeeds : PASS
governed act fails closed     : PASS
LOGIN stays fail-open         : PASS
```

The fail-open default is deliberately untouched: making authentication fail closed on an audit blip
would log every user out of the platform.

**Stated limit.** The ML audit is written outside the transaction that changed the stage, so a
throw surfaces the problem to the caller but does **not** roll the stage change back. Making it
atomic means threading a transaction client through `enterpriseAuditService` — a change to a shared
service with many callers, and one to make deliberately rather than as a side effect of this phase.

---

## T. Privacy

Full inventory in `PHASE_14_PRIVACY_MATRIX.md`. Summary: 0 forbidden metric labels, 0 PII-shaped
label values, prompts stored as hashes only, purpose limitation genuinely enforced on booking PII,
field-level encryption on sensitive columns, retention categories now exist for the classes that
had none.

**Stated honestly:** the five pre-existing retention durations (7y/8y/10y/2y/1y) were inherited
from the codebase. This phase did not re-derive or legally validate them, and they should not be
read as reviewed.

---

## U. E2E

**25 / 25 required scenarios · 10 / 10 fault probes.** Full detail in
`PHASE_14_FINAL_E2E_MATRIX.md`.

---

## V. Regression

Fresh measurements, second pass.

| Suite | Result |
|---|---|
| Backend `tsc --noEmit` | **0 errors from Phase-14 code** |
| Phase-14 governance tests | **26 pass / 0 fail** |
| Full backend suite (139 files, split in halves) | **1,978 pass / 16 fail** |

**Typecheck:** 3 errors exist, all in `src/__tests__/partner-four-axis.test.ts` — **untracked**,
created 2026-09-05 01:26 between the two passes by neither of them, and testing `PARTNER_AXIS`
literals from a module this phase never touched. Somebody's work in progress; left alone rather
than silently edited.

**The 16 failures are proven pre-existing.** Zero are Phase-14 tests. They are timeouts from
Postgres deadlocks (`40P01`) under each suite's own 50- to 500-way concurrent booking creation:
Chaos & resilience ×4, Enterprise scalability ×3, Money matrix ×2, Release blocker ×2, Adversarial
×1, unnamed ×1, plus in-suite duplicates.

The proof is threefold. Half 1 produced **exactly 14 failures in exactly the same suites both
before and after this pass** — a regression introduced here would have moved that number. Running
`release-blocker-elimination.test.ts` **alone**, with the database to itself, produced **278
deadlocks and 8 failures**, nearly three times what it produces in a batch, so contention from
other files cannot be the cause. And nothing changed in either pass touches `booking.service.ts`
or its transaction.

---

## W. Database Safety

`homigo_db` was **never written to**. Verified by query after the fact: 0 rows matching `p14%`
across experiments, workflow instances, audit, policy logs and scheduled jobs; 0 writes in the
preceding five minutes to audit, policy logs or workflow instances.

All three migrations are additive (`CREATE TYPE`, `CREATE TABLE`, `ADD COLUMN`, `ADD VALUE`) plus
one `DROP INDEX` on a constraint nothing depended on. All were applied to **`homigo_p39`** and
**`homigo_test`** only.

**One near-miss, reported rather than buried.** The first budget-race probe set `DATABASE_URL`
inside the script *after* importing prisma, so dotenv's `.env` won and it connected to `homigo_db`.
It failed immediately on `P2021: table does not exist` — before any write — and the audit confirmed
zero rows. Every later probe passed `DATABASE_URL` on the shell command line. Recorded because the
safety came from the migration *not* having been applied to production, which is luck; the
shell-env discipline is the actual control.

---

## X. Human Decisions Required

| # | Decision | Why it is not ours |
|---|---|---|
| 1 | The AI spend limit | Too high controls nothing, too low breaks production AI. The mechanism is engineering; the number is a business decision |
| 2 | What the `treatment` arm should do | Pricing policy |
| 3 | Where `recordConversion` should be called from | Product instrumentation |
| 4 | Retention for AI telemetry, automation telemetry and activity logs | Decides how far back an incident stays investigable |
| 5 | RPO and RTO | No target exists in this project |
| 6 | Whether deletion requests should erase KYC and financial evidence | Legal |
| 7 | Governed approval for the 4 warehouse models marked production | Currently `registry_reconciliation = WARN` |
| 8 | Drift thresholds (PSI/KL) | A tolerance nobody has set |
| 9 | Owners — for `surge_v1`, for alerts, for the platform | Naming someone puts them on the hook for something they never accepted |
| 10 | Whether audit persistence should fail **closed** | Would change the availability of every authenticated path |
| 11 | Non-notification automation frequency windows | No canonical window exists |

Every one has its mechanism in place. What is missing is the judgement, not the plumbing.

---

## Y. External Artifacts Required

| # | Artifact | Blocks |
|---|---|---|
| 1 | **BigQuery billing re-enabled** | Every BLOCKED model; ETL, warehouse freshness, forecast horizons |
| 2 | Legal DPDP interpretation | Any compliance assertion; the deletion-vs-evidence question |
| 3 | Backup encryption + off-host storage verification | §91 — the scripts exist; the infrastructure to verify them does not here |
| 4 | 50 real ETA ground-truth labels | ETA model promotion |
| 5 | Production migration window | **The `trace_id` fix is not yet live in production** |

---

## Z. Known Limitations

- **Audit persistence still fails open.** `AuditLogService` catches and logs write failures, so a
  governed action proceeds if the audit store is down. The O1 fix removed the *silent, routine*
  loss (every second event per request); this residual case requires an actual outage. Making it
  fail closed is item X-10.
- **`force` replay** can delete a consumer receipt and duplicate a consequential side effect. Not
  reachable over HTTP today. The sharpest edge in the replay surface.
- **Frequency caps are notification-shaped** — no general per-action limiter.
- **Policy version tracks rule identity, not rule bodies.** Editing a rule's logic does not change
  the hash.
- **Experiments cannot currently measure anything** — identical arms, no outcome recording.
  Reported as `differentiated: false` rather than hidden.
- **Chaos testing was partial.** The DR restore drill ran; worker kills, Redis cuts and scheduler
  pauses under load were not re-run — those paths carry their Phase-5 certification and were not
  modified here.
- **Inherited retention durations were not legally validated.**
- **Historical audit loss from O1 is unquantifiable** — the dropped rows were never written.

---

## AA. Final Scope Closure

| Requirement | State |
|---|---|
| A. AI policy engine | **OPERATIONAL** (+ versioning fixed) |
| B. PII controls | **OPERATIONAL** — metrics clean; **log leak found and fixed in pass 2** |
| C. DPDP-oriented controls | **OPERATIONAL (technical)** — `LEGAL_DECISION_REQUIRED` |
| D. Prompt/version audit | **OPERATIONAL** (+ failure path fixed) |
| E. Workflow versioning | **OPERATIONAL** — verified, unchanged |
| F. Shadow mode | **OPERATIONAL** — verified, unchanged |
| G. A/B experiments | **OPERATIONAL** — 3 fixed, 1 escalated |
| H. Model versioning | **OPERATIONAL** — verified, unchanged |
| I. AI budget caps | **OPERATIONAL** — **built**; **one bypass found and closed in pass 2**; limit is `HUMAN_DECISION_REQUIRED` |
| J. Automation frequency caps | **PARTIAL** |
| K. Disaster recovery | **OPERATIONAL** — drill executed; RPO/RTO undecided |
| L. Event replay | **OPERATIONAL** — 2 fixed |
| M. Stuck workflow recovery | **OPERATIONAL** — **built** |
| N. Model rollback | **OPERATIONAL** — verified, unchanged |
| O. Audit retention | **OPERATIONAL** — 4 fixed; **fail-closed for governance acts in pass 2**; durations undecided |

**No scope was silently expanded.** No `PolicyEngineV2`, `ExperimentEngineV2`, `AuditV2`,
`RBACV2`, second registry or second observability stack. No Capability 15, no Phase 14.1.

**Verdict: `PHASE_14_COMPLETE_WITH_FOLLOWUPS`.**

Not `PHASE_14_COMPLETE`, for one specific and checkable reason: §80 reserves that for when the
required production deployment state is *verified*, and it is not. `enterprise_audit_logs.trace_id`
is still `UNIQUE` in `homigo_db` — confirmed by direct query, not inferred — so production is still
losing the second governance event on any shared trace. The migration is written, rehearsed against
346,070 real production rows with a byte-identical checksum, timed at 1,457 ms, and verified to
restore the intended invariant. It is not applied, and no production change was made without
authorization. See `PHASE_14_PRODUCTION_HARDENING_CHECKLIST.md`.

The governance layer now says no where it previously only reported. The two controls that did not
exist — a spend cap and a recovery path for stuck work — exist, are enforced at the right boundary,
and hold under concurrency. The audit log stopped silently discarding governance records. What
remains open is a set of decisions and external artifacts, held open deliberately rather than
closed with an invented value.
