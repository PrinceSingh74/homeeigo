# PHASE 15 — Security Forensic Audit

Second-pass discipline applied from the start: the question is not "does the control work" but
"can anything get **past** it". Phase 14 taught that lesson expensively — a spend cap that covered
the AI gateway and not the vision service.

---

## A. Bypass hunt

### A1. AI provider bypass — **guarded, and the guard is proven**

Every reference to a provider adapter (`callGroq`, `callGemini`, `callOpenAi`, `callAnthropic`,
`callGeminiVision`) across **579 backend source files** was enumerated:

| File | Allowed? | Governed? |
|---|---|---|
| `ai/providers/model-providers.ts` | yes — defines the adapters | n/a |
| `ai/router/model-router.ts` | yes — the only caller | n/a |
| `services/vision-intelligence.service.ts` | no | **yes** — `checkAndReserveBudget(` + `settleBudget(` |
| `services/knowledge-embedding.service.ts` (raw `fetch`) | no | **yes, after this pass** — `checkAiRateLimit(` + `recordEmbeddingSpend(` |
| `ai/config.ts` | allowlisted — holds base URLs, calls nothing | n/a |

**No ungoverned provider path exists.** The second entry was found by this pass and is described in
§A1b.

The guard is a test that walks the tree and fails on any new offender. It **asserts its own
coverage first** — the scan must find the adapter file and the one governed exception — because two
earlier versions of this guard passed while a real bypass was present:

1. It accepted an `import` of `checkAndReserveBudget` as evidence of governance, so deleting the
   *call* left it green.
2. Its regex contained a literal backspace byte from a mangled word-boundary escape, so it matched
   nothing and asserted `[] === []`.

**Verified by deletion:** removing the budget call from the vision service makes the test fail with
`services/vision-intelligence.service.ts` in the offender list; restoring it passes.

### A1b. A bypass the first pass missed — **FOUND AND FIXED**

The §36 clean-slate pass asked the required question — *"what path can bypass what I just built?"* —
and the honest answer was: my own guard.

**`services/knowledge-embedding.service.ts` calls Gemini's `embedContent` endpoint by raw
`fetch`.** It uses no adapter function, so the adapter-name guard could not see it. It had **no
rate limit, no spend accounting and no AI audit** — and it is not an occasional path: it runs on
**every RAG query** (`knowledge-retrieval.service.embed(query)`) plus every document indexed from
the admin route.

| Property | Before | After |
|---|---|---|
| Rate limit | none | `checkAiRateLimit` per actor |
| Spend accounting | none | `recordEmbeddingSpend` — counted as **unknown-cost** |
| AI audit | none | `recordAiRequest` with a prompt hash |
| Result on limit | n/a | `RATE_LIMITED`, a typed failure the caller already handles |

**Cost is recorded as UNKNOWN, not computed.** `computeTokenCostDetailed` would return a confident
number for GEMINI, but its table prices *generation* and embeddings bill at a different, much lower
rate. Pricing an embedding with the generation table would put a wrong figure into spend accounting
and make it look measured. `unknown_cost_requests` says plainly that spend is understated by that
many calls — the same distinction Phase 13 established for unpriced providers. No reservation is
taken either, because an upper bound cannot be derived without a price and reserving a made-up
amount is the same fabrication in a different field.

**The guard was widened**, and the widening is the durable part: it now matches provider **hosts**
(`generativelanguage.googleapis.com`, `api.openai.com`, `api.groq.com`, `api.anthropic.com`) as
well as adapter names, so any future raw-fetch bypass is caught whatever it calls the call.
`ai/config.ts` is allowlisted — naming a host in configuration is not calling it.

**Verified by deletion:** removing `recordEmbeddingSpend(` makes the guard fail with
`services/knowledge-embedding.service.ts` in the offender list; restoring it passes.

**Why the first pass missed it:** the guard was written against the *shape of the known bypass*
(an adapter call) rather than against the *property being protected* (reaching a paid provider).
That is the same class of error as the two earlier vacuous versions of the same guard.

---

### A2. Workflow execution bypass — **structurally impossible, then guarded anyway**

An AI-drafted workflow cannot execute. Workflows are **defined in code**; `workflow_definitions`
holds a frozen snapshot and the boot fingerprint check refuses to start if an activated version's
steps changed. Drafts therefore live in a separate table and can never be picked up by the engine.

On top of that structural barrier:

| Attack | Result |
|---|---|
| `ACTION` step naming `finance.refund` | **REFUSED** — `STEP_TYPE_ACTION_REFUSED`, risk `REJECTED_UNSAFE` |
| Unregistered condition id | **REFUSED** — `CONDITION_UNKNOWN` |
| Unregistered trigger | **REFUSED** — `TRIGGER_UNKNOWN` |
| Notification carrying `phone` and `body` | **REFUSED** — `NOTIFICATION_CARRIES_CONTENT` |
| Arbitrary recipient (`attacker@example.com`) | **REFUSED** — `RECIPIENT_INVALID` |
| 41 steps | **REFUSED** — `STEPS_TOO_MANY` |
| 400-day WAIT | **REFUSED** — `WAIT_TOO_LONG` |
| Duplicate step ids | **REFUSED** — `STEP_ID_DUPLICATE` |
| Approving an invalid draft | **REFUSED** — `REVALIDATION_FAILED` |
| Approving with a 2-char note | **REFUSED** — `NOTE_REQUIRED` |

**ACTION refusal verified by removal:** adding `"ACTION"` to the allowed step-type set makes the
test suite fail. The guard is not decorative.

**Why ACTION is refused even though it currently does nothing:** the executor has no route into the
Phase-5 tool layer, so an ACTION step is inert today. If that route is ever opened, every drafted
ACTION step sitting in the table becomes a way for a model to invoke a tool nobody reviewed.
Refusing it now costs nothing and closes the door before it exists.

### A3. Allowlist bypass — **allowlists are read at runtime, not hardcoded**

Validation reads `listConditions()`, `triggeredEventTypes()` and `notification_templates` where
`status = ACTIVE` — the same sources the executor consults. A hardcoded list drifts: someone adds a
condition and the list does not know, so either a valid draft is rejected or a stale entry lets
through an id the engine no longer has.

**Draft templates are excluded deliberately.** A `DRAFT` template exists but cannot render, so
accepting one would let a reviewer approve a workflow whose notification fails the first time it
fires.

**Re-validated at approval**, against the live registries. A draft that passed last week is not
approvable today if a condition it names has since been removed.

### A4. Simulation → production write bypass — **verified by counting**

`bookings`, `payments` and `ledger_entries` counted before and after an extreme scenario
(+200% demand, −90% supply, festival) and a what-if: **unchanged**.

Structural, not just tested: `scenario-simulation.service` imports the digital twin, metrics and
the logger. No repository, no finance service, no workflow entry point.

### A5. Model governance bypass — **not reachable, for an unexpected reason**

The cancellation model cannot be promoted because **`ml_model_versions` does not exist in
production** and the service registers no version anywhere. It is an offline evaluation with no
serving path. `limitations` says `NOT_SERVING` explicitly.

Phase-12 governance (`ALLOWED` transition map, approval-before-promotion, partial unique index on
the production stage) is unchanged by this phase.

---

## B. Multimodal injection

**Finding: the classic image → OCR → prompt-injection path does not exist, because there is no
second hop.**

A source-wide search for consumers of vision output (`observations`, `observedCategory`,
`analyzeImage`, `VisionResult`) outside the vision service and its own route returns **zero
matches**. The pipeline is one-way — image in, structured analysis stored and returned to its
owner. Nothing re-ingests it into a prompt, so there is nothing for injected text in an image to
influence.

| Vector | State |
|---|---|
| Image → prompt injection | **No path** — vision output reaches no LLM |
| OCR text → prompt injection | **No path** — same |
| Document injection | No document-ingestion pipeline exists |
| Audio injection | No audio pipeline exists (capability 1 blocked) |
| Workflow-input injection | Drafted content is validated against closed allowlists; free text is confined to `intent`, which is stored and never executed |
| Model output as authorisation | A drafted workflow authorises nothing; approval is a human act, audited fail-closed |

**Follow-up, stated rather than buried:** this finding expires the moment any consumer feeds vision
output into a prompt. The bypass guard catches ungoverned *provider calls*, not ungoverned *content
flow* — a different property that would need its own guard.

---

## C. Prompt-as-data discipline

Untrusted text reaches no governance decision in any Phase-15 capability:

- **Simulation** takes five numeric/boolean parameters, bounded −100…500 at the route. No free text
  enters the computation.
- **Workflow drafting** stores `intent` as free text but validates only structured fields against
  closed allowlists. The prompt is recorded and hashed for traceability; it is never interpreted.
- **Cancellation model** takes no text input at all.

---

## D. RBAC

| Route | Resource / action |
|---|---|
| `GET /governance/workflow-drafts` | `ANALYTICS` / `READ` |
| `POST /governance/workflow-drafts` | `SETTINGS` / `UPDATE` |
| `POST /governance/workflow-drafts/:id/review` | `SETTINGS` / **`APPROVE`** |
| `GET /governance/models/cancellation-risk/evaluation` | `ANALYTICS` / `READ` |
| `POST /digital-twin/:city/scenario` | `requireRole("ADMIN")` |
| `POST /digital-twin/:city/what-if` | `requireRole("ADMIN")` |

Reviewing a draft is `APPROVE`, matching model promotion — approving automation somebody else will
implement is an approval, not an edit. Routes under `/api/admin` are **denied by default when
unmapped**, which is what makes adding one safe.

---

## E. Concurrency

| Property | Test | Result |
|---|---|---|
| Two reviewers decide one draft | `Promise.all` of APPROVE and REJECT | **1 succeeds, 1 `LOST_RACE`**; the row ends in exactly one terminal state |
| Draft already reviewed | second review attempt | `ALREADY_REVIEWED` |

The winner is decided by an optimistic `updateMany … where status = DRAFT`, the same discipline
Phase 14 used for workflow recovery.

---

## F. PII

No Phase-15 capability introduces a new sensitive data flow:

- **Simulation** operates on city-level aggregates. No customer, booking or partner identifier
  enters or leaves.
- **Workflow drafts** store an intent string and structured steps. Notification steps are
  **forbidden from carrying** a phone, email, `to`, `body`, `message` or `html` — tested.
- **Cancellation model** uses `user_id` only as a grouping key for history counts. It is not a
  feature, not logged and not returned.

The Phase-14 logger scrubbing (Prisma argument echoes, email and phone patterns) covers these paths
as it does every other.

---

## G. What was NOT tested, and why

Stated rather than implied:

- **Production behaviour.** Nothing here ran against production; the maturity gate fails on 10
  unapplied migrations.
- **Voice injection.** No audio pipeline exists to attack.
- **Recommendation feedback loops.** No recommender was built.
- **Fraud adversarial adaptation.** No fraud model was built.
- **Load and chaos on the new services.** Simulation is a cached read and drafting is a single
  insert; neither was load-tested, and neither is on a traffic-serving path.

---

## H. Verdict

| Area | Result |
|---|---|
| AI provider bypass | **PASS** — 0 ungoverned calls; guard proven by deletion |
| Workflow execution bypass | **PASS** — structurally impossible + 10 refusal cases tested |
| Allowlist bypass | **PASS** — runtime-derived, re-validated at approval |
| Simulation write isolation | **PASS** — verified by counting |
| Model promotion bypass | **PASS** — no serving path exists |
| Multimodal injection | **PASS** — no second hop; follow-up recorded |
| RBAC | **PASS** — mapped, deny-by-default |
| Concurrency | **PASS** — exactly one reviewer wins |
| PII | **PASS** — no new sensitive flow |
