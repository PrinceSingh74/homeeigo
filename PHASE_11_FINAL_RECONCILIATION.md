# PHASE 11 — Enterprise RAG — Final Reconciliation

## A. Verdict

### `PHASE_11_COMPLETE_WITH_FOLLOWUPS`

The full canonical flow — **question → permission → hybrid retrieval → approved knowledge → LLM →
grounded answer → citations → audit** — is implemented, integrated into the real HOMEEIGO
architecture, and exercised end to end through the real Elysia app on the isolated development
database.

Two of the seven knowledge classes have **no corpus in this repository**, and no policy text was
invented to fill them. That is the reason for `WITH_FOLLOWUPS`.

Reconciled 2026-09-03. Every figure below was measured in this pass. Nothing was deployed.

---

## B. Capability matrix

| Capability | Status | Implementation | Operational evidence | Tests |
|---|---|---|---|---|
| Knowledge domain & lifecycle | `OPERATIONAL` | `KnowledgeDocument` / `KnowledgeChunk`, 5 enums | 4 documents seeded, approved, indexed via HTTP | 8 |
| Ingestion pipeline | `OPERATIONAL` | `knowledge-ingestion.service.ts` | validate → normalize → version → hash → chunk, all failure states typed | 6 |
| Deterministic chunking | `OPERATIONAL` | `chunkDocument()` | headings become sections; offsets verified against source text | 4 |
| Embedding / indexing | `OPERATIONAL` | `knowledge-embedding.service.ts` | **real Gemini `gemini-embedding-001`, dim 3072**, 60 chunks embedded | 3 |
| Hybrid retrieval | `OPERATIONAL` | `knowledge-retrieval.service.ts` | **both arms live**: lexical `ts_rank` + semantic cosine, fused by RRF | 9 |
| Permission-aware retrieval | `OPERATIONAL` | audience predicate inside both SQL arms | customer/partner/internal isolation proven positively and negatively | 6 |
| Approval & version filtering | `OPERATIONAL` | status + effective-date predicate | DRAFT / SUPERSEDED / WITHDRAWN / expired all excluded | 5 |
| Grounded answer | `OPERATIONAL` | `knowledge-answer.service.ts` via existing AI Gateway | **GROQ**, `grounded=true`, 6 real citations | 4 |
| Citations & provenance | `OPERATIONAL` | built from retrieved chunks only | every citation carries a real `chunkId`, title, type, version, section | 3 |
| Refusal / no-answer | `OPERATIONAL` | refuses *before* calling the model | `NO_RELEVANT_KNOWLEDGE`, `INSUFFICIENT_EVIDENCE` | 3 |
| Prompt-injection defence | `OPERATIONAL` | four-zone prompt + gateway firewall | malicious approved document retrieved and inert | 3 |
| Admin knowledge API | `OPERATIONAL` | 6 routes on the existing admin router | list / approve / withdraw / reindex / seed / ask, all RBAC-gated | 3 |
| Idempotency & reindex | `OPERATIONAL` | `(documentKey, version)` unique + content hash | 3 sequential and 3 concurrent ingests → 1 version | 6 |
| Observability | `OPERATIONAL` | 6 counters + 3 histograms | ingest, embedding, retrieval, answers, approvals, withdrawals | — |
| FAQ corpus | `EXTERNAL_ARTIFACT_REQUIRED` | — | none exists in the repository | — |
| Partner SOP corpus | `EXTERNAL_ARTIFACT_REQUIRED` | — | none exists in the repository | — |

---

## C. Knowledge source matrix

| Type | Present | Approved | Versioned | Indexed | Retrievable | Audience | State |
|---|---|---|---|---|---|---|---|
| `REFUND_POLICY` | yes — real | yes | v1 | 4 chunks | yes | PUBLIC | `OPERATIONAL` |
| `CANCELLATION_POLICY` | yes — real | yes | v1 | 3 chunks | yes | PUBLIC | `OPERATIONAL` |
| `TERMS` | yes — real | yes | v1 | 2 chunks | yes | PUBLIC | `OPERATIONAL` |
| `SERVICE_INFORMATION` | yes — real | yes | v1 | 51 chunks | yes | PUBLIC | `OPERATIONAL` |
| `TRAINING_DOCUMENT` | model + pipeline ready | — | — | — | — | PARTNER | `EXTERNAL_ARTIFACT_REQUIRED` — no published academy module with a body in the dev database |
| `PARTNER_SOP` | pipeline ready | — | — | — | — | PARTNER | `EXTERNAL_ARTIFACT_REQUIRED` |
| `FAQ` | pipeline ready | — | — | — | — | PUBLIC | `EXTERNAL_ARTIFACT_REQUIRED` |

The first four come from HOMEEIGO's own content: `apps/web/src/lib/legal/legal-data.ts` (effective
2026-07-06) and the `services` table. **No official policy text was written for this phase.** Where a
code path needed a document that does not exist, the fixture is labelled `TEST_FIXTURE_ONLY` and
never presented as official knowledge — asserted by a test that the seed refuses to fabricate FAQ or
Partner SOP.

---

## D. RAG flow — every stage exercised through the real app

```
PASS  1 ingest+approve+index    4 docs: REFUND_POLICY(v1,4ch) CANCELLATION_POLICY(v1,3ch)
                                TERMS(v1,2ch) SERVICE_INFORMATION(v1,51ch) — all idx=true
PASS  2 missing corpora declared TRAINING_DOCUMENT, FAQ, PARTNER_SOP
PASS  3 governance metadata      4 docs, status=APPROVED, index=INDEXED
PASS  4 hybrid retrieval         6 chunks, lexical=true semantic=true, 852 ms
PASS  5 measured scores          top: "Refund & Cancellation Policy — Refunds" v1 sec="Overview"
                                 lexRank=1 semRank=4 rrf=0.03202
PASS  6 grounded answer          kind=KNOWLEDGE grounded=true provider=GROQ citations=6
PASS  7 citations are real       "…— Cancellations" v1/Partner-Initiated Cancellations
PASS  8 honest refusal           kind=REFUSAL reason=INSUFFICIENT_EVIDENCE
PASS  9 live-data boundary       kind=REFUSAL (policy could not answer a per-customer question)
PASS 10 no cross-role leakage    customer got 6 chunks, TRAINING_DOCUMENT among them: 0
PASS 11 injection inert          kind=REFUSAL promptLeaked=false
PASS 12 withdrawn not retrieved  present=false
PASS 13 idempotent re-ingest     documents 0 → 5, chunks 0 → 61 across two seed runs
PASS 14 RBAC                     customer token → 403
```

Implementation mapping:

| Flow stage | Code |
|---|---|
| Question | `POST /api/admin/knowledge/ask` on the existing admin router |
| Permission | `audiencesFor(role)` → SQL predicate inside **both** retrieval arms |
| Hybrid retrieval | `knowledgeRetrievalService.retrieve()` — `ts_rank` + cosine, fused by RRF |
| Approved knowledge | `status='APPROVED'` + effective-date window, in SQL |
| LLM | existing `invokeAiGateway`, `tools: { enabled: false }` |
| Grounded answer | `knowledgeAnswerService.answer()` |
| Citations | built from retrieved chunks only |
| Audit / telemetry | existing logger + 6 counters, 3 histograms |

---

## E. Retrieval quality — measured, not estimated

| Measure | Value |
|---|---|
| Retrieval success on in-corpus questions | 6 of 6 chunks returned for the cancellation/refund question |
| No-result on out-of-corpus questions | correct: `zzzqqq nonexistent xyzzy` → 0 chunks |
| Version correctness | superseded v1 never returned; all results v2 in the versioning test |
| Permission correctness | partner SOP: partner ≥1 chunk, customer 0; internal training: admin ≥1, customer 0, partner 0 |
| Citation correctness | every citation carries a real `chunkId` from the retrieved set |
| Retrieval latency | 852 ms total (lexical + Gemini embedding round trip + cosine) |
| Embedding latency | measured per call in `knowledge_embedding_latency_seconds` |

**On scores.** `fusedScore` is a Reciprocal Rank Fusion value — `Σ 1/(60 + rank)`, with k=60 from the
original paper. It is a ranking number and is **not** a probability that an answer is correct. Where
an arm did not return a chunk, its rank and score are `null` rather than zero, so a missing arm is
distinguishable from a bad score. Asserted by test.

**Honest limitation.** Cosine is computed exactly over stored vectors because `pgvector` is neither
installed nor bundled in the running `postgres:16-alpine` image. That is correct at development
corpus size (61 chunks) and will not scale to millions of chunks without an ANN index.

---

## F. Security

| Control | Evidence |
|---|---|
| Permission before retrieval | audience predicate is inside both arms' `WHERE`; unauthorised text never enters the candidate set |
| Cross-role leakage | proven **positively and negatively**: the partner finds the SOP, the customer gets 0 — so the empty result is the filter working, not a broken query |
| Answer-level leakage | a customer asking about internal training gets a payload with no trace of it — checked across the whole JSON, including citations |
| Document injection | a malicious **approved** document was retrieved (asserted) and changed nothing |
| Question injection | four payloads including a fence-escape attempt; no prompt scaffolding leaked |
| System-prompt extraction | `TRUSTED PLATFORM INSTRUCTIONS` and `## APPROVED KNOWLEDGE` absent from every response |
| Execution | no `executeTool`, `consumeApproval`, business `update`, `routeNotification` or `$executeRaw` in the RAG path; `tools: { enabled: false }` |
| RBAC over HTTP | customer token → **403** on the admin knowledge routes |
| Route permissions | `SETTINGS/READ`, `SETTINGS/UPDATE`, `SETTINGS/APPROVE` — all quoted from the existing table; none invented |

---

## G. Knowledge governance

| Control | Behaviour | Evidence |
|---|---|---|
| Approval | ingestion always writes `DRAFT`; only an explicit approval makes a document retrievable | asserted: `status=DRAFT`, `approvedBy=null` after ingest |
| Versioning | identical content re-ingests as the same version; changed content becomes v2 | asserted |
| Supersession | approving v2 marks v1 `SUPERSEDED` **in the same transaction** | asserted: exactly one `APPROVED` version at any moment |
| History | superseded and withdrawn rows are retained, never deleted | asserted: v1 still present with `SUPERSEDED` |
| Withdrawal | status change, not deletion; excluded from retrieval immediately | asserted end to end |
| Effective dates | applied against the question's own timestamp | an expired policy returns 0 chunks **today** and ≥1 when queried at a date inside its window — so it is a date test, not an accidental exclusion |
| Conflict handling | **no authority hierarchy exists in this repository** | not invented — see Human Decisions |

---

## H. AI provider

| Path | State |
|---|---|
| Generation | existing AI Gateway, **GROQ** answered live (`openai/gpt-oss-120b`) |
| Gateway failover | GROQ → GEMINI → OPENAI, unchanged; OPENAI unconfigured (pre-existing) |
| Embeddings | **Gemini `gemini-embedding-001`, 3072 dimensions** |
| Model compatibility | vectors carry their model; retrieval refuses to compare across models or dimensions |
| Failure handling | gateway outage → refusal with real citations still listed; embedding outage → lexical-only with the degradation stated |

**A real defect found here.** The first constant said `text-embedding-004` and every embedding call
returned HTTP 404 — that model is not available to this key. Asking the provider for its model list
gave `gemini-embedding-001`. The dimension is now recorded from the first successful response rather
than hardcoded, because a wrong constant silently produces vectors that compare against nothing.

---

## I. Observability

Counters: `knowledge_ingest_total`, `knowledge_embedding_total`, `knowledge_retrieval_total`,
`knowledge_answers_total`, `knowledge_approvals_total`, `knowledge_withdrawals_total`.
Histograms: `knowledge_embedding_latency_seconds`, `knowledge_retrieval_latency_seconds`,
`knowledge_answer_latency_seconds`.

Retrieval telemetry records role, result, and which arms ran (`L-`, `-S`, `LS`) — so a silent
semantic outage shows up as a label change rather than as slightly worse answers.

---

## J. Database side effects

| Table | Before | After | Class |
|---|---|---|---|
| bookings | 11,054 | 11,054 | no side effect |
| payments | 39 | 39 | no side effect |
| ledger_entries | 118 | 118 | no side effect |
| knowledge_documents | 0 | 5 | **expected development write** |
| knowledge_chunks | 0 | 61 | **expected development write** |

**Business-state mutation: NO.**

Production, re-verified this pass:

```
homigo_db  knowledge_documents / knowledge_chunks   ABSENT (0 tables)
```

The migration `20260904090000_knowledge_base` is additive and was applied to **`homigo_p39` only**.

---

## K. Regression — fresh

| Suite | Result |
|---|---|
| Backend typecheck | **exit 0** |
| Admin typecheck | **exit 0** |
| Admin production build | **exit 0** — clean `.next` rebuild, "Compiled successfully in 108s" |
| Backend integration, 30 suites | **771 pass / 0 fail / 8,507 assertions** — two consecutive clean runs |
| Phase-11 suite | **30 pass / 0 fail / 84 assertions** |
| Phase-11 E2E | **14 / 14 stages** |
| Admin unit suites | **39 pass / 0 fail / 604 assertions** |
| Phase-7 critical | 8 / 0 |
| Phase-8 / 16-18 critical | 5 / 0 |
| Security p1 / p3 | 6 / 0, 4 / 0 |
| Adversarial | 11 / 0 |

**Two transients, both chased rather than dismissed.** `adversarial-integration` reported 10/1 inside
one batch run and then passed **11/0 on four consecutive isolated runs** — the same fixture
contention pattern recorded in earlier phases. The admin build reported "Failed to collect page data
for /ai-brain/timeline" once, then passed on retry and again on a **clean `.next` rebuild from
scratch**; that page was not touched by this phase.

---

## L. Human decisions

| Decision | Why it cannot be inferred |
|---|---|
| `KNOWLEDGE_AUTHORITY_HIERARCHY_HUMAN_DECISION_REQUIRED` | Nothing in the repository says whether Terms outrank an FAQ, or formal policy outranks a training document. Retrieval currently ranks by relevance and recency of approval, and conflicting sources are surfaced rather than silently resolved. Inventing a hierarchy would be inventing legal precedence. |
| `KNOWLEDGE_RETENTION_HUMAN_DECISION_REQUIRED` | Superseded and withdrawn documents are retained indefinitely for audit. How long they should live is a compliance decision. |
| `KNOWLEDGE_APPROVAL_OWNER_HUMAN_DECISION_REQUIRED` | Approval currently requires `SETTINGS/APPROVE`. Whether legal, operations or support owns policy approval is an organisational question. |
| `KNOWLEDGE_MULTILINGUAL_HUMAN_DECISION_REQUIRED` | Documents carry a `language` field and the corpus is English. There is no defined behaviour for a Hindi question against English policy; the system does not fabricate a translation. |

---

## M. External artifacts

| Artifact | State |
|---|---|
| Official FAQ corpus | `EXTERNAL_ARTIFACT_REQUIRED` — the pipeline is ready and typed; no content exists |
| Official Partner SOP corpus | `EXTERNAL_ARTIFACT_REQUIRED` — same |
| Published academy modules with body text | `EXTERNAL_ARTIFACT_REQUIRED` — the model and loader exist; the development database has none |
| `20260904090000_knowledge_base` on `homigo_db` | `EXTERNAL_ARTIFACT_REQUIRED` — additive, applied to `homigo_p39` only |
| OPENAI credentials | `EXTERNAL_ARTIFACT_REQUIRED` — pre-existing gap in the failover chain |

---

## N. Deferred

| Item | State | Reason |
|---|---|---|
| ANN index for semantic search | `DEFERRED` | `pgvector` is not installed and not bundled in the running image. Exact cosine is correct at 61 chunks; scaling it is an infrastructure decision, not a Phase-11 gap. |
| PDF / DOCX ingestion | `DEFERRED` | The format gate refuses them explicitly rather than half-parsing. Adding a parsing framework for formats no current corpus uses would be scope this phase forbids. |
| Customer-facing RAG surface | `DEFERRED` | The retrieval and answer services are role-aware and ready; exposing them on the customer app is a product decision outside this phase's scope. |

---

## O. Scope closure

**FULL MULTIMEDIA RAG = OUT OF SCOPE FOR PHASE 11.** No image, video, audio, frame, scene or
multimodal embedding path was introduced, and none is stubbed.

**NO NEW PHASE-11 CAPABILITY REMAINS.** Every defined requirement has a final, evidence-backed
state: the pipeline, retrieval, permissions, governance, grounding, citations, refusal, injection
defence, idempotency, observability and the admin API are all operational; two knowledge corpora and
one migration are external artifacts; four decisions are human-owned.

**No duplicate architecture was created.** No second AI gateway, LLM abstraction, RBAC system, audit
log, notification path, scheduler or document store. Lexical retrieval uses Postgres' own full-text
search; generation uses the existing gateway; permissions use the existing route table; the routes
hang off the existing admin router.

---

*Reconciled 2026-09-03 in the development environment. Production was read-only throughout and
remains unchanged: the knowledge tables do not exist in `homigo_db`, no feature flag was created, no
LIVE activation occurred, and HIGH_RISK remains 14 tools with 0 bound. No official HOMEEIGO policy
text was fabricated; every seeded document traces to content that already existed in this platform.*
