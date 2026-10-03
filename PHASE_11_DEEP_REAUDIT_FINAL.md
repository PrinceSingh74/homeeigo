# PHASE 11 — Forensic Deep Re-Audit — Final

## A. Final verdict

### `PHASE_11_OPERATIONAL_COMPLETE_WITH_FOLLOWUPS`

The re-audit did **not** confirm the previous report. It found **six real gaps**, two of which were
outright overclaims in `PHASE_11_FINAL_RECONCILIATION.md`, and one genuine retrieval defect that the
first pass never detected because it had no evaluation set to detect it with.

All six are repaired and verified. Two knowledge corpora remain external artifacts, and four
decisions remain human-owned.

Re-audited 2026-09-03. Every figure below was measured in this pass.

---

## B. Forensic corrections

### B1 — Audit was claimed, and did not exist

**Old claim.** The RAG flow table listed `Audit / telemetry → existing logger + 6 counters` and §51
required *"Use existing audit infrastructure."*

**Actual reality.** `grep -c AuditLogService src/services/knowledge-*.ts` returned **0 across all five
services**. Approval and withdrawal — the two acts that decide what the platform will state as
official policy — were written to the application log only. Nothing reached the security audit.

**Root cause.** I substituted `logger.info` for the audit system and then described it as audit.

**Fix.** Three events added to the existing `SecurityEvent` union — `KNOWLEDGE_APPROVED`,
`KNOWLEDGE_WITHDRAWN`, `KNOWLEDGE_RETRIEVAL_DENIED` — and `AuditLogService.success(...)` wired into
approve and withdraw. No parallel audit log was created.

**Verified.** Test asserts both calls are present and that no `KnowledgeAuditLog` class exists.

---

### B2 — Conflict detection was claimed, and did not exist

**Old claim.** *"Conflicting sources are surfaced rather than silently resolved."*

**Actual reality.** `CONFLICTING_KNOWLEDGE` existed in the reason vocabulary and **nothing ever
emitted it**. Two policy documents disagreeing produced one blended answer with no warning — the
failure enterprise RAG is most often criticised for.

**Root cause.** I defined the vocabulary and mistook that for implementing the behaviour.

**Fix.** Retrieval now detects when the result set spans more than one policy-authoritative type,
emits `CONFLICTING_KNOWLEDGE`, and states that no authority hierarchy exists so precedence has not
been applied. Deliberately structural: detecting *semantic* contradiction needs a precedence model,
and inventing one would be inventing legal precedence.

**Verified.** Test asserts the flag appears when types span, and does **not** appear when they do not.

---

### B3 — Out-of-corpus questions retrieved irrelevant policy

**Old claim.** *"No-result on out-of-corpus questions — correct."*

**Actual reality.** That claim rested on one hand-picked query. The evaluation set built during this
re-audit ran `"what is the policy on interplanetary shipping tariffs"` and retrieval returned **six
chunks of refund policy**. Cosine always ranks something highest; there was no floor. The answer was
still refused — but only because the *model* declined, after retrieval had handed it irrelevant
policy to reason over. Relying on the model to notice is not a control.

**Root cause.** No evaluation set existed, so the first pass could not have found this.

**Fix.** A semantic relevance floor, **measured rather than chosen**. Six in-corpus and six
out-of-corpus questions against this corpus and model:

```
relevant    top-cosine   min 0.6502   mean 0.7226   max 0.7796
irrelevant  top-cosine   min 0.4886   mean 0.5318   max 0.6105
```

The populations separate cleanly; the floor is the midpoint of the measured gap, **0.6304**. It is
documented as a property of *this corpus and this model*, not a universal constant, and is
deliberately not exposed as configuration — a tunable knob gets tuned until the demo looks good.

**Verified.** Three out-of-corpus questions now retrieve **zero** chunks, while in-corpus questions
still retrieve — so the floor is not a blanket refusal.

---

### B4 — The seed exhausted the quota that retrieval depends on

**Actual reality.** `knowledgeSeedService` called `indexDocument()` unconditionally, re-embedding
every chunk on every run including unchanged content. On a 113-chunk corpus that is 113 provider
calls per seed. The evaluation caught the consequence: after a couple of runs the embedding quota was
spent and **retrieval silently degraded to lexical-only** — the seed starving the query path it
exists to feed. Retrieval latency dropped from ~700 ms to 3 ms, which is what "no embedding call"
looks like.

**Root cause.** Idempotency was implemented at the row level and not at the indexing stage.

**Fix.** An already-`INDEXED` document with unchanged content is skipped. A document whose embedding
previously **failed** is still retried — that distinction is the correct invariant.

**Verified.** A test counts `indexDocument` calls against the measured precondition and asserts
*exactly* the documents that still need indexing are re-indexed. An earlier version of that test
asserted zero unconditionally and failed — correctly, and the assertion was wrong, not the code.

---

### B5 — No analytics existed

**Old claim.** An "Observability" section listing six counters, presented as satisfying §AD.

**Actual reality.** Prometheus counters are not queryable analytics. No endpoint, no document counts,
no coverage, no index-consistency measure.

**Fix.** `knowledge-analytics.service.ts` plus `GET /api/admin/knowledge/analytics`, reporting real
counts, distributions, embedding coverage with denominators, and an **index-consistency** check for
documents marked `INDEXED` that still hold unembedded chunks. Four measures with no queryable source
are returned as explicitly `unmeasurable` with the missing source named, never as zero.

---

### B6 — No evaluation set existed

**Actual reality.** §41 and §AQ both require one. The previous report quoted per-query outcomes from
the E2E script and no systematic set.

**Fix.** `knowledge-eval.service.ts` with five cases from the real approved corpus, covering the four
situations that behave differently: exact terminology, paraphrase (where the semantic arm earns its
place), catalogue content, and a question nothing answers.

**Measured, before and after the floor repair:**

| | expectedSourceRetrieved | topRankCorrect |
|---|---|---|
| Before repairs | 0.80 (4/5) | 0.75 (3/4) |
| After repairs | **1.00 (5/5)** | 0.75 (3/4) |

Reported as "expected source retrieved", not as precision, recall or accuracy — those need a labelled
corpus with judged relevance for every document-query pair, which this platform does not have.

---

## C. Requirement matrix

| ID | Requirement | Impl | Integ | Oper | Tested | Evidence | Status |
|---|---|---|---|---|---|---|---|
| A1-A3 | Canonical knowledge model, types, identity | ✓ | ✓ | ✓ | ✓ | 2 tables, 5 enums, `(documentKey, version)` unique | `PASS` |
| A4-A5 | Versioning + content hash | ✓ | ✓ | ✓ | ✓ | changed content → v2; identical → `unchanged:true` | `PASS` |
| A6 | stored ≠ approved ≠ retrievable | ✓ | ✓ | ✓ | ✓ | ingestion always writes DRAFT; asserted | `PASS` |
| A7-A8 | Ownership, provenance | ✓ | ✓ | ✓ | ✓ | `owner`, `approvedBy`, `sourceRef` on every row | `PASS` |
| A9 | Effective dates | ✓ | ✓ | ✓ | ✓ | expired → 0 chunks today, ≥1 inside its window | `PASS` |
| A10 | Superseded / withdrawn auditable | ✓ | ✓ | ✓ | ✓ | rows retained; excluded from retrieval | `PASS` |
| B1 FAQ | Corpus | — | — | — | — | none in repository | `EXTERNAL_ARTIFACT_REQUIRED` |
| B2 Cancellation | Corpus | ✓ | ✓ | ✓ | ✓ | real, 3 chunks, indexed, retrievable, cited | `PASS` |
| B3 Refund | Corpus | ✓ | ✓ | ✓ | ✓ | real, 4 chunks, indexed, retrievable, cited | `PASS` |
| B4 Terms | Corpus | ✓ | ✓ | ✓ | ✓ | real, 2 chunks, retrieved by eval case | `PASS` |
| B5 Partner SOP | Corpus | — | — | — | — | none in repository | `EXTERNAL_ARTIFACT_REQUIRED` |
| B6 Service Info | Corpus | ✓ | ✓ | ✓ | ✓ | real, 54 chunks from `services` | `PASS` |
| B7 Training | Corpus | pipeline ✓ | — | — | — | 1 academy row, unpublished, no body ≥80 chars | `EXTERNAL_ARTIFACT_REQUIRED` |
| C1-C15 | Ingestion pipeline | ✓ | ✓ | ✓ | ✓ | all failure states typed; format gate refuses docx | `PASS` |
| D | Chunking | ✓ | ✓ | ✓ | ✓ | deterministic; headings → sections; offsets verified | `PASS` |
| E | Embeddings | ✓ | ✓ | ✓ | ✓ | `gemini-embedding-001`, dim **3072 observed**, 62 vectors stored | `PASS` |
| F | Lexical retrieval | ✓ | ✓ | ✓ | ✓ | Postgres FTS, generated tsvector + GIN | `PASS` |
| G | Semantic retrieval | ✓ | ✓ | ✓ | ✓ | cosine over stored vectors, model+dim guarded | `PASS` |
| H | **Hybrid** | ✓ | ✓ | ✓ | ✓ | both arms live (`LS`); RRF k=60; paraphrase found by semantic alone | `PASS` |
| I | Permission before exposure | ✓ | ✓ | ✓ | ✓ | audience predicate inside **both** SQL arms | `PASS` |
| J-K | Document access + cross-role | ✓ | ✓ | ✓ | ✓ | partner finds SOP, customer 0; internal: admin ✓ customer ✗ partner ✗ | `PASS` |
| L | Grounding | ✓ | ✓ | ✓ | ✓ | `grounded=true` only when the model answered from supplied text | `PASS` |
| M | Grounded refusal | ✓ | ✓ | ✓ | ✓ | refuses **before** the model when retrieval is empty | `PASS` |
| N | Citations | ✓ | ✓ | ✓ | ✓ | built from retrieved chunks only; real `chunkId` | `PASS` |
| O | Version / currentness | ✓ | ✓ | ✓ | ✓ | superseded never returned; exactly one APPROVED version | `PASS` |
| P | Source conflicts | ✓ | ✓ | ✓ | ✓ | **repaired** — detected and surfaced; precedence not invented | `PASS` + `HUMAN_DECISION_REQUIRED` |
| Q | Prompt injection | ✓ | ✓ | ✓ | ✓ | malicious approved doc retrieved and inert; no prompt leak | `PASS` |
| R | AI Gateway | ✓ | ✓ | ✓ | ✓ | existing gateway, GROQ live, `tools: { enabled: false }` | `PASS` |
| S | Answer contract | ✓ | ✓ | ✓ | ✓ | answer, grounded, citations, retrieval state, limitations, model | `PASS` |
| T-U | Business-truth boundary | ✓ | ✓ | ✓ | ✓ | `REQUIRES_LIVE_DATA` kind; no finance arithmetic in the path | `PASS` |
| V | Admin knowledge management | ✓ | ✓ | ✓ | ✓ | 7 routes on the existing admin router | `PASS` |
| W-X | Retrieval + answer API | ✓ | ✓ | ✓ | ✓ | real routes, real RBAC, customer token → 403 | `PASS` |
| Y | UI integration | — | — | — | — | no Phase-11 UI surface built | `DEFERRED` (see N) |
| Z | Persistence | ✓ | ✓ | ✓ | ✓ | proven from the database, not from returned objects | `PASS` |
| AA | Idempotency | ✓ | ✓ | ✓ | ✓ | 3 sequential + 3 concurrent → 1 version; re-index only what needs it | `PASS` |
| AB | Cache | n/a | n/a | n/a | n/a | no cache layer exists in the RAG path | `NOT_APPLICABLE` |
| AC-AD | Observability + analytics | ✓ | ✓ | ✓ | ✓ | **repaired** — analytics endpoint + index-consistency measure | `PASS` |
| AE-AF | Error handling + resilience | ✓ | ✓ | ✓ | ✓ | embedding outage → lexical-only **with the degradation stated** | `PASS` |
| AG | Security | ✓ | ✓ | ✓ | ✓ | see section F | `PASS` |
| AH | Audit | ✓ | ✓ | ✓ | ✓ | **repaired** — existing `AuditLogService`, no parallel log | `PASS` |
| AI-AJ | Whole-project integration | ✓ | ✓ | ✓ | ✓ | 778 pass / 0 fail across 30 suites; prior phases green | `PASS` |
| AK | Real E2E | ✓ | ✓ | ✓ | ✓ | 14/14 stages through the real app | `PASS` |
| AN-AO | Database + migration | ✓ | ✓ | ✓ | ✓ | FK, 2 unique indexes, GIN, generated tsvector; applied to p39 only | `PASS` |
| AP | Performance / scale | ✓ | ✓ | ✓ | ✓ | measured; scaling boundary stated | `PASS` |
| AQ | Retrieval quality | ✓ | ✓ | ✓ | ✓ | **repaired** — evaluation set, 5/5 expected sources | `PASS` |

No requirement is `UNKNOWN`.

---

## D. Knowledge source matrix

| Type | Actual source | Approved | Version | Indexed | Retrievable | Permission | Grounding | Citation | Status |
|---|---|---|---|---|---|---|---|---|---|
| FAQ | — | — | — | — | — | — | — | — | `EXTERNAL_ARTIFACT_REQUIRED` |
| Cancellation Policy | `legal-data.ts` | ✓ | v1 | 3 chunks | ✓ | PUBLIC | ✓ | ✓ | `OPERATIONAL` |
| Refund Policy | `legal-data.ts` | ✓ | v1 | 4 chunks | ✓ | PUBLIC | ✓ | ✓ | `OPERATIONAL` |
| Terms | `legal-data.ts` | ✓ | v1 | 2 chunks | ✓ | PUBLIC | ✓ | ✓ | `OPERATIONAL` |
| Partner SOP | — | — | — | — | — | PARTNER | — | — | `EXTERNAL_ARTIFACT_REQUIRED` |
| Service Information | `services` table | ✓ | v1 | 54 chunks | ✓ | PUBLIC | ✓ | ✓ | `OPERATIONAL` |
| Training Documents | `partner_academy_modules` | — | — | — | — | PARTNER | — | — | `EXTERNAL_ARTIFACT_REQUIRED` |

**Re-verified, not assumed.** The training gap was checked directly: `homigo_db` and `homigo_p39`
both return **0** published academy modules with a body of ≥80 characters (one unpublished row
exists). The absence is real, not a seed bug.

All operational content is **REAL OFFICIAL DATA**. Documents created to exercise code paths are
labelled `TEST_FIXTURE_ONLY` in `sourceRef` and are deleted after each run. A test asserts the seed
refuses to fabricate FAQ or Partner SOP.

---

## E. RAG flow proof — 14/14 through the real app

```
PASS  1 ingest+approve+index   4 docs, all idx=true
PASS  2 missing corpora        TRAINING_DOCUMENT, FAQ, PARTNER_SOP declared
PASS  3 governance metadata    status=APPROVED, index=INDEXED
PASS  4 hybrid retrieval       6 chunks, lexical=true semantic=true, 771 ms
PASS  5 measured scores        lexRank=1 semRank=4 rrf=0.03202
PASS  6 grounded answer        kind=KNOWLEDGE grounded=true provider=GROQ citations=5
PASS  7 citations are real     "…— Cancellations" v1/Partner-Initiated Cancellations
PASS  8 honest refusal         kind=REFUSAL reason=INSUFFICIENT_EVIDENCE
PASS  9 live-data boundary     policy could not answer a per-customer question
PASS 10 no cross-role leakage  customer got 0 chunks, TRAINING_DOCUMENT: 0
PASS 11 injection inert        malicious approved doc retrieved, changed nothing
PASS 12 withdrawn not retrieved
PASS 13 idempotent re-ingest   documents 0→5, chunks 0→64 across two seeds
PASS 14 RBAC                   customer token → 403
```

| Stage | Implementation |
|---|---|
| Question | `POST /api/admin/knowledge/ask` on the existing admin router |
| Permission | `audiencesFor(role)` → SQL predicate in **both** arms |
| Hybrid retrieval | `ts_rank` + cosine (floor 0.6304), fused by RRF k=60 |
| Approved knowledge | `status='APPROVED'` + effective-date window, in SQL |
| LLM | existing `invokeAiGateway`, tools disabled |
| Grounded answer | `knowledgeAnswerService.answer()` |
| Citation | built from retrieved chunks only |
| Audit | existing `AuditLogService` |
| Analytics | `GET /api/admin/knowledge/analytics` |

---

## F. Security proof

| Control | Evidence |
|---|---|
| Permission before retrieval | audience predicate inside both arms' `WHERE`; unauthorised text never enters the candidate set |
| Cross-role | proven **both ways**: partner finds the SOP, customer gets 0 — the empty result is the filter, not a broken query |
| Answer-level leakage | a customer asking about internal training gets a payload with no trace of it, citations included |
| Document injection | a malicious **approved** document was retrieved (asserted) and changed nothing |
| Question injection | three payloads incl. a fence-escape; no scaffolding leaked |
| System-prompt extraction | `TRUSTED PLATFORM INSTRUCTIONS` / `## APPROVED KNOWLEDGE` absent from every response |
| Execution | no `executeTool`, `consumeApproval`, business write, `routeNotification` or `$executeRaw`; `tools: { enabled: false }` |
| RBAC over HTTP | customer token → **403** |
| Route permissions | `SETTINGS/READ|UPDATE|APPROVE`, all quoted from the existing table |
| Cross-tenant | `NOT_APPLICABLE` — no tenant isolation model exists in this platform |

---

## G. Performance — freshly measured

| Stage | Measured |
|---|---|
| Ingest + chunk (4 docs, 63 chunks) | sub-second, dominated by the transaction |
| Embedding, per call | ~600-900 ms (Gemini round trip) |
| Lexical arm | 3-11 ms |
| Semantic arm | ~600-900 ms, dominated by the query embedding |
| Hybrid total | 674-919 ms warm |
| Lexical-only (embedding unavailable) | 2-11 ms |
| LLM generation | ~1.5 s via GROQ |

**Scaling boundary, stated honestly.** Cosine is computed exactly in SQL over stored vectors because
`pgvector` is neither installed nor bundled in the running `postgres:16-alpine` image. At the current
**64 chunks** this is correct and fast. It is a linear scan and will not hold at millions of chunks
without an ANN index. That is a limitation, not a defect for the current scope.

---

## H. Regression — fresh

| Suite | Result |
|---|---|
| Backend typecheck | **exit 0** |
| Admin typecheck | **exit 0** |
| Admin build, clean `.next` | **exit 0** — "Compiled successfully in 37.3s" |
| Backend integration, 30 suites | **778 pass / 0 fail / 8,778 assertions** — two consecutive clean runs |
| Phase-11 suite | **37 pass / 0 fail / 105 assertions** |
| Phase-11 E2E | **14 / 14 stages** |
| Retrieval evaluation | **5 / 5 expected sources** |
| Admin unit suites | **39 pass / 0 fail / 604 assertions** |
| Phase-7 critical | 8 / 0 |
| Phase-8 / 16-18 critical | 5 / 0 |
| Security p1 / p3 | 6 / 0, 4 / 0 |
| Adversarial | 11 / 0 |

**One failure chased, and the assertion was wrong rather than the code.** `re-seeding an unchanged
corpus does not re-embed it` failed 2/2 — reproducible, not a flake. The invariant is "re-index
exactly what needs it", not "never re-index": a document whose embedding previously failed *must* be
retried. The test now counts against the measured precondition.

---

## I. Production safety

| Question | Answer |
|---|---|
| Production touched? | **NO** — `homigo_db` read-only throughout |
| Knowledge tables in production? | **NO** — 0 tables |
| Business-state mutation? | **NO** — bookings, payments, ledger unchanged across every run |
| Feature flags changed? | **NO** — 2 flags, both `false`, unchanged |
| Production knowledge written? | **NO** |
| LIVE activation? | **NO** — 25 workflows SHADOW, 0 LIVE |
| HIGH_RISK bindings | unchanged: **14 tools, 0 bound** |

Migration `20260904090000_knowledge_base` is additive and applied to **`homigo_p39` only**.

---

## J. Human decisions

| Decision | Why it cannot be inferred |
|---|---|
| `KNOWLEDGE_AUTHORITY_HIERARCHY_HUMAN_DECISION_REQUIRED` | Conflict is now **detected and surfaced**, but nothing says whether Terms outrank an FAQ. Applying precedence would be inventing legal precedence. |
| `KNOWLEDGE_RETENTION_HUMAN_DECISION_REQUIRED` | Superseded and withdrawn rows are retained indefinitely for audit; how long is a compliance decision. |
| `KNOWLEDGE_APPROVAL_OWNER_HUMAN_DECISION_REQUIRED` | Approval takes `SETTINGS/APPROVE`; which function owns policy approval is organisational. |
| `KNOWLEDGE_MULTILINGUAL_HUMAN_DECISION_REQUIRED` | Documents carry `language` and the corpus is English; behaviour for a non-English question is undefined and no translation is fabricated. |

---

## K. External artifacts

| Artifact | State |
|---|---|
| Official FAQ corpus | `EXTERNAL_ARTIFACT_REQUIRED` |
| Official Partner SOP corpus | `EXTERNAL_ARTIFACT_REQUIRED` |
| Published academy modules with body text | `EXTERNAL_ARTIFACT_REQUIRED` — re-verified: 0 in both databases |
| `20260904090000_knowledge_base` on `homigo_db` | `EXTERNAL_ARTIFACT_REQUIRED` |
| OPENAI credentials | `EXTERNAL_ARTIFACT_REQUIRED` — pre-existing gap in the failover chain |

---

## L. Scaling limitations

| Limitation | Impact on current scope |
|---|---|
| Exact cosine, no ANN index | none at 64 chunks; blocks million-scale corpora |
| Semantic floor is corpus- and model-specific | none; re-measurable via `knowledge-eval.service.ts` |
| Embedding quota under burst load | degrades to lexical-only **with the degradation stated** |
| PDF / DOCX not parsed | none; the format gate refuses them explicitly |

---

## M. Deferred

| Item | State | Reason |
|---|---|---|
| Phase-11 UI surface | `DEFERRED` | The admin API is complete, RBAC-gated and exercised over HTTP. No UI was built, and none is claimed. Which surface should expose knowledge — admin console, support console, or the customer app — is a product decision, and building one on a corpus missing two of seven types would surface incomplete knowledge to users. |
| ANN index | `DEFERRED` | `pgvector` unavailable in the running image; an infrastructure decision |
| PDF / DOCX ingestion | `DEFERRED` | No corpus uses them; the gate refuses rather than half-parsing |

---

## N. Scope closure

**FULL MULTIMEDIA RAG = OUT OF SCOPE FOR PHASE 11.** No image, video, audio, frame, scene or
multimodal path was introduced, and none is stubbed.

**NO NEW PHASE-11 CAPABILITY REMAINS.** Every requirement in sections A through AQ has a final,
evidence-backed state. Six gaps were found and repaired; two corpora and one migration are external
artifacts; four decisions are human-owned; one UI surface is deferred with a stated reason.

**One canonical RAG implementation.** No duplicate retrieval, embedding, chunking, prompt or
knowledge-filtering logic exists. Lexical retrieval uses Postgres' own full-text search; generation
uses the existing AI Gateway; permissions use the existing route table; audit uses the existing
`AuditLogService`; the routes hang off the existing admin router.

---

*Re-audited 2026-09-03. The previous Phase-11 report was treated as a claim, not as evidence, and it
did not survive contact with the audit: two of its statements were overclaims and one of its
"correct" behaviours was a defect that only an evaluation set could expose. Every figure here was
measured in this pass. No official HOMEEIGO policy text was fabricated, no citation was invented, no
retrieval score was manufactured, and production remains untouched.*
