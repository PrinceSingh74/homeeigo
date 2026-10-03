# PHASE 15 — AI Governance Audit

## A. The control hierarchy, and whether Phase 15 respected it

HOMIGO's stated hierarchy is: **RULES = control · ML = prediction · LLM = understanding ·
RAG = knowledge · AUTOMATION = execution · HUMAN = high-risk authority.**

| Capability | What the AI does | What decides | Inverted? |
|---|---|---|---|
| Scenario simulation | nothing — deterministic arithmetic | a formula over live aggregates | **No** |
| Executive what-if | nothing — same engine | same | **No** |
| Workflow drafting | **proposes** a step array | validation against closed allowlists, then a **human**, then a **developer** | **No** |
| Cancellation risk | predicts a probability | nothing — it does not serve | **No** |

No Phase-15 capability makes an LLM the source of truth for arithmetic, balances, entitlement,
policy thresholds, fraud verdicts, authorisation or promotion.

**Two places where the temptation was explicit and declined:**

1. **What-if refuses to produce a currency figure.** Multiplying `revenuePct` by real revenue is one
   line of code. It would be arithmetic outside the authoritative finance services, on a number
   resting on five unvalidated priors, arriving in an executive report indistinguishable from a
   ledger entry. `financialProjection.available` is `false` with that reason attached.

2. **An approved workflow draft still does not run.** The obvious "completion" of capability 7 is to
   write the approved definition into `workflow_definitions`. That would make a language model the
   author of production automation. It is not done, and the response says
   `nextStep: "NOT YET RUNNING…"` because "APPROVED" on a screen invites the opposite assumption.

---

## B. Provider governance coverage

Phase 14 established that a spend cap covering one entry point is not a control. Phase 15 re-ran
that hunt from zero across **579 backend source files**.

| Provider entry point | Callers outside the router | Governed |
|---|---|---|
| `callGroq` / `callGemini` / `callOpenAi` / `callAnthropic` | none | n/a |
| `callGeminiVision` | `vision-intelligence.service` | **yes** — budget + rate limit + cost + audit |
| **raw `fetch` to `generativelanguage.googleapis.com`** | **`knowledge-embedding.service`** | **yes, after this pass** — rate limit + unknown-cost accounting + audit |

**Zero ungoverned provider paths.** The second row is a bypass this phase found: a raw `fetch` to
Gemini's `embedContent` endpoint, running on **every RAG query**, invisible to an adapter-name
guard. §18 lists embeddings explicitly as a path that must be checked, and it had not been.

The regression guard now matches provider **hosts** as well as adapter names, asserts its own
coverage before asserting the result, and was verified by reintroducing the bypass.

**Phase 15 added no new provider call.** Capabilities 5, 6 and 8 make none at all — the simulation
is arithmetic and the model is logistic regression computed in-process. Capability 7 accepts a
generated draft from whatever produced it; if that is a gateway call, it is governed by the
gateway, and the service records `modelProvider` / `modelName` / `promptHash` so the origin is
traceable either way.

---

## C. Untrusted content is data, never authority

| Input | Where it goes | Can it influence a decision? |
|---|---|---|
| Scenario parameters | five numeric/boolean fields, bounded −100…500 at the route | No — no free text enters the computation |
| Draft `intent` (free text) | stored, hashed, shown to the reviewer | **No** — never parsed, never executed |
| Draft `steps` | validated field-by-field against closed allowlists | Only by matching an allowlisted id |
| Vision `observations` | stored, returned to the image's owner | **No consumer exists** — verified by source search |

**The strongest statement available about multimodal injection here is structural**: vision output
reaches no LLM prompt, because a source-wide search for its consumers outside the vision service
returns zero matches. There is no second hop for injected text to travel along.

That finding is time-limited and recorded as such — it expires the moment any consumer feeds vision
output into a prompt.

---

## D. Human authority classification

| Capability | Class | Justification |
|---|---|---|
| Scenario simulation | `LOW_RISK_AUTOMATABLE` | Read-only; mutates nothing; verified by counting |
| Executive what-if | `LOW_RISK_AUTOMATABLE` | Same engine; refuses currency conversion |
| Workflow drafting — *proposing* | `LOW_RISK_AUTOMATABLE` | A draft cannot execute |
| Workflow drafting — *approving* | **`HIGH_RISK_HUMAN_AUTHORITY`** | Authorises automation somebody will implement; RBAC `SETTINGS/APPROVE`, ≥10-char note, fail-closed audit |
| Workflow drafting — *activating* | **`NOT_AUTOMATABLE_YET`** | Requires a code commit and a deploy. No API can do it |
| Cancellation risk — *evaluating* | `LOW_RISK_AUTOMATABLE` | Offline, read-only |
| Cancellation risk — *serving* | **`NOT_AUTOMATABLE_YET`** | Advantage is inside its own error bar |

---

## E. Audit coverage

| Action | Audited | Mode |
|---|---|---|
| Draft approved | `AI_WORKFLOW_DRAFT_APPROVED` | **fail-closed** (`recordGoverned`) |
| Draft rejected | `AI_WORKFLOW_DRAFT_REJECTED` | **fail-closed** |
| Draft created | metric + structured log | not audited — a proposal is not yet a decision |
| Scenario run | structured log with `scenarioId`, `snapshotId` | read-only; no governance act |
| Model evaluated | structured log + gauges | read-only |

Approval uses Phase-14's fail-closed path: the audit row's id is checked and a failure throws, so a
governance decision cannot succeed with its record silently lost.

**Deliberately not audited:** draft *creation*. It writes a row that is itself the record, and
auditing every generated proposal would bury the approvals in noise — the same reasoning that keeps
per-request AI `ALLOW` decisions out of the audit log.

---

## F. Budget and rate-limit coverage

| Path | Budget | Rate limit |
|---|---|---|
| AI gateway (text) | ✓ Phase 14 | ✓ |
| Vision | ✓ Phase 14 | ✓ |
| Scenario simulation | **n/a** — no provider call |
| Cancellation model | **n/a** — no provider call |
| Workflow drafting | **n/a** at this layer — generation happens upstream, and if via the gateway it is governed there | — |
| **Knowledge embeddings** | **unknown-cost accounting** | **✓ per actor** |

**The gap that existed here is now closed.** Embeddings were entirely ungoverned — §18 names them
as a path to check and the first pass had not. They now rate-limit per actor, audit, and count
against every active budget policy as **unknown-cost** rather than being priced with the wrong
table.

**Residual gap, recorded rather than speculatively fixed:** if a future caller generates a workflow
draft through some path other than the AI gateway, that generation is ungoverned. The widened guard
would catch it if it reached a provider by adapter *or* by host — which is now both known routes —
but not if it called some third service that does the reaching. No such caller exists.

---

## G. No duplication

| Existing system | Phase-15 use |
|---|---|
| AI Gateway, router, failover | not duplicated; not modified |
| AI budget / rate limit / cost / audit | reused via Phase-14 services |
| RBAC + admin route permissions | 4 entries added to the existing table |
| Audit service | `recordGoverned` reused |
| Workflow engine, registries | **read** for allowlists; engine untouched |
| ML registry | not duplicated; deliberately not written to |
| Digital twin | wrapped, not reimplemented |
| Prometheus/Grafana | 6 metrics on the existing exporter |

**No second gateway, budget engine, RBAC, audit system, workflow engine, scheduler, model registry
or observability stack was created.**

---

## H. Verdict

| Property | Result |
|---|---|
| Control hierarchy preserved | **PASS** |
| LLM never authoritative | **PASS** — two explicit declines documented |
| Provider governance complete | **PASS** — 0 ungoverned calls, guard proven |
| Untrusted content is data | **PASS** |
| Human authority on high-risk acts | **PASS** |
| Governance audit fail-closed | **PASS** |
| No duplicate engines | **PASS** |
| Budget coverage of new paths | **PASS** — new paths make no provider calls; one follow-up recorded |
