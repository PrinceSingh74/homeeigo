# PHASE 11 — Discovery (read-only)

Performed 2026-09-03 before any code was written.

## What exists

| Thing | Location | State |
|---|---|---|
| AI Gateway + GROQ→GEMINI→OPENAI failover | `ai/gateway/ai-gateway.ts` | **REAL** — GROQ and GEMINI keys present, verified by a live call in Phase 10 |
| Prompt firewall | `ai/security/prompt-security.ts` | **REAL** — `detectPromptInjection`, `sanitizeInput`, `isolateSystemPrompt` |
| `ai-brain` context / memory | `ai-brain/` | **REAL** — but it is conversation context, **not** vector retrieval |
| Admin RBAC | `lib/admin-route-permissions.ts` + `middleware/admin-rbac.ts` | **REAL** |
| Audit | `services/audit-log.service.ts` | **REAL** |
| Feature flags | `services/feature-flag.service.ts` | **REAL**, fail-closed |
| Official Terms / Refund / Cancellation text | `apps/web/src/lib/legal/legal-data.ts` (324 lines) | **REAL** — `TERMS_SECTIONS`, `REFUND_SECTIONS`, `REFUND_TIERS`, effective `2026-07-06` |
| Partner training corpus | `partner_academy_modules` | **REAL** — model with `body`, `isPublished`; 1 published row live |
| Service catalogue | `services` | **REAL** — 55 live rows |

## What is missing

- **No vector infrastructure at all.** No `pgvector` extension (`btree_gist`, `pg_stat_statements`, `plpgsql` only), and the `postgres:16-alpine` image does not bundle it.
- No embedding code anywhere — the single `embedding` hit in the repo is a comment about a cache key.
- No knowledge / document / chunk model, no ingestion, no retrieval, no RAG service, no hybrid search.
- No FAQ corpus. The only "FAQ" hits are UI labels.

## Consequences for the architecture

**Lexical retrieval → Postgres native full-text search.** `tsvector` + `ts_rank` ships with Postgres
and needs no extension. Adding a search engine would be the duplicate architecture this phase
forbids.

**Semantic retrieval → Gemini embeddings, vectors stored as `Float[]`, cosine in SQL.** `pgvector`
is not installed and not available in the running image; requiring it would make Phase 11 depend on
an infrastructure change. At development corpus size (hundreds of chunks) exact cosine over stored
vectors is correct and measurable, and it keeps the honest limitation visible: this does not scale to
millions of chunks without an ANN index.

**Hybrid fusion → Reciprocal Rank Fusion.** A published, parameter-light method. The alternative —
inventing lexical/semantic weights — is exactly the "magical weights" the directive rejects.

**Generation → the existing AI Gateway.** No second LLM path.

## Knowledge artifacts: what is real and what is missing

| Type | Source | State |
|---|---|---|
| `TERMS` | `legal-data.ts` `TERMS_SECTIONS` | **real official content** |
| `REFUND_POLICY` | `legal-data.ts` `REFUND_SECTIONS`, `REFUND_TIERS` | **real official content** |
| `CANCELLATION_POLICY` | same document (it is a combined "Refund & Cancellation Policy") | **real official content** |
| `SERVICE_INFORMATION` | `services` table, 55 rows | **real operational content** |
| `TRAINING_DOCUMENTS` | `partner_academy_modules` | **real**, 1 published row |
| `PARTNER_SOP` | — | **`EXTERNAL_ARTIFACT_REQUIRED`** — no SOP corpus exists |
| `FAQ` | — | **`EXTERNAL_ARTIFACT_REQUIRED`** — no FAQ corpus exists |

No official HOMEEIGO policy text will be fabricated for the two missing types. Where a fixture is
needed to exercise a code path it is labelled `TEST_FIXTURE_ONLY` and never presented as official
knowledge.
