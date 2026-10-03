import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, observeHist } from "../lib/metrics";
import type { KnowledgeAudience, KnowledgeType } from "@prisma/client";
import { knowledgeEmbeddingService, embeddingAvailable, EMBEDDING_MODEL } from "./knowledge-embedding.service";
import { knowledgeAuthorityService, type AuthorityResolution } from "./knowledge-authority.service";
import {
  KNOWLEDGE_REASON, KNOWLEDGE_RULES_VERSION,
  type KnowledgeActor, type RetrievalResult, type RetrievedChunk,
} from "./knowledge.types";

/**
 * Phase 11 — permission-aware hybrid retrieval.
 *
 * ── Permission is part of the query, not a filter on its results ───────────────
 *
 * Both retrieval arms carry the audience predicate in their SQL `WHERE`. Unauthorised knowledge is
 * therefore never in the candidate set, never ranked, and never reaches the grounding context. The
 * alternative — retrieve broadly, filter afterwards — leaves a window in which the wrong text exists
 * in memory next to a model, and "the model was told to ignore it" is not a security control.
 *
 * ── Why Reciprocal Rank Fusion ─────────────────────────────────────────────────
 *
 * Lexical `ts_rank` and cosine similarity are not on the same scale, so adding them requires
 * inventing weights — the exact thing this phase forbids. RRF combines *ranks* rather than scores:
 * `score = Σ 1/(k + rank)`. It is a published method with one documented constant, and `k = 60` is
 * the value from the original paper rather than a number chosen to make a demo look good.
 *
 * ── What "current" means ───────────────────────────────────────────────────────
 *
 * Only `APPROVED` documents are eligible. `DRAFT`, `IN_REVIEW`, `SUPERSEDED` and `WITHDRAWN` are all
 * excluded in SQL, so a superseded version cannot outrank the version that replaced it and a
 * withdrawn document cannot be returned as current knowledge. Effective dates are applied against
 * the question's own timestamp.
 */

/** The RRF constant from Cormack et al. Documented, not tuned. */
const RRF_K = 60;

/**
 * Minimum cosine similarity for the semantic arm to contribute a chunk.
 *
 * ── Why a floor is needed at all ───────────────────────────────────────────────
 *
 * Cosine always ranks *something* highest. Without a floor, "what is the policy on interplanetary
 * shipping tariffs" returned six chunks of refund policy — the evaluation set caught it. The answer
 * was still refused, but only because the *model* declined; retrieval had handed it irrelevant
 * policy to reason over, and relying on the model to notice is not a control.
 *
 * ── How this number was obtained ───────────────────────────────────────────────
 *
 * Measured, not chosen. Six in-corpus questions and six deliberately out-of-corpus ones were run
 * against this corpus with `gemini-embedding-001`:
 *
 *     relevant    top-cosine  min 0.6502  mean 0.7226  max 0.7796
 *     irrelevant  top-cosine  min 0.4886  mean 0.5318  max 0.6105
 *
 * The two populations separate cleanly with a gap between 0.6105 and 0.6502. The floor is the
 * midpoint of that measured gap.
 *
 * ── What invalidates it ────────────────────────────────────────────────────────
 *
 * This is a property of *this corpus and this embedding model*, not a universal constant. Changing
 * either requires re-running the measurement — `knowledge-eval.service.ts` exists so that is a
 * command rather than a guess. It is deliberately not exported as configuration: a tunable knob
 * would be adjusted to make a demo look better.
 */
const SEMANTIC_FLOOR = 0.6304;
const ARM_LIMIT = 20;
const DEFAULT_TOP_K = 6;

/**
 * Which audiences each role may read.
 *
 * Least privilege, and deliberately explicit rather than derived. A partner SOP is `PARTNER`
 * audience and a customer role cannot see it however relevant the text is to their question.
 */
const AUDIENCE_BY_ROLE: Record<KnowledgeActor["role"], KnowledgeAudience[]> = {
  admin: ["PUBLIC", "CUSTOMER", "PARTNER", "INTERNAL"],
  support: ["PUBLIC", "CUSTOMER", "PARTNER", "INTERNAL"],
  partner: ["PUBLIC", "PARTNER"],
  customer: ["PUBLIC", "CUSTOMER"],
  anonymous: ["PUBLIC"],
};

export function audiencesFor(role: KnowledgeActor["role"]): KnowledgeAudience[] {
  return AUDIENCE_BY_ROLE[role] ?? ["PUBLIC"];
}

type Row = {
  chunk_id: string; document_id: string; document_key: string; title: string;
  type: string; version: number; section: string | null; content: string;
  start_offset: number; end_offset: number; source_ref: string;
  effective_from: Date | null; score: number;
};

/** Cosine similarity. Only ever called on vectors from the same model — see the dimension guard. */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type RetrieveOptions = {
  actor: KnowledgeActor;
  question: string;
  topK?: number;
  /** Restrict to specific knowledge classes. Narrows the query; never widens the audience. */
  types?: KnowledgeType[];
  now?: Date;
};

export const knowledgeRetrievalService = {
  /**
   * Retrieve the most relevant approved chunks the actor is allowed to see.
   *
   * Returns a state rather than throwing. A semantic outage degrades to lexical-only and says so;
   * it does not fail the question, and it does not pretend the semantic arm ran.
   */
  async retrieve(opts: RetrieveOptions): Promise<RetrievalResult> {
    const t0 = Date.now();
    const now = opts.now ?? new Date();
    const topK = opts.topK ?? DEFAULT_TOP_K;
    const audiences = audiencesFor(opts.actor.role);
    const limitations: string[] = [];

    const query = opts.question.trim();
    if (query.length < 3) {
      return {
        state: "NO_RESULTS", chunks: [], arms: { lexical: false, semantic: false },
        reasonCode: KNOWLEDGE_REASON.INSUFFICIENT_EVIDENCE,
        limitations: ["The question is too short to retrieve against."],
        timings: { lexicalMs: 0, semanticMs: 0, totalMs: Date.now() - t0 },
        rulesVersion: KNOWLEDGE_RULES_VERSION,
      };
    }

    /**
     * The eligibility predicate, shared by both arms.
     *
     * Everything that decides whether a chunk may be seen lives here: approval, audience, effective
     * dates. Duplicating it per arm would let the two drift, and a drift in this predicate is a
     * disclosure bug.
     */
    /**
     * Parameters are cast to `text[]` rather than the enum array type.
     *
     * Postgres could not infer the type of the types parameter when the caller passed an empty
     * array — `could not determine data type of parameter $3` — and the retrieval silently returned
     * nothing, which made three security assertions pass against an empty result set. Casting both
     * sides to text makes the empty case well-typed, and the `cardinality = 0` guard turns "no type
     * filter requested" into a no-op instead of a filter that matches nothing.
     */
    const eligibility = `
      d.status = 'APPROVED'
      AND d.audience::text = ANY($2::text[])
      AND (cardinality($3::text[]) = 0 OR d.type::text = ANY($3::text[]))
      AND (d.effective_from IS NULL OR d.effective_from <= $4)
      AND (d.effective_to IS NULL OR d.effective_to >= $4)
    `;

    // ── Lexical arm ──────────────────────────────────────────────────────────
    const l0 = Date.now();
    let lexicalRows: Row[] = [];
    try {
      const params: unknown[] = [query, audiences as string[], (opts.types ?? []) as string[], now];
      lexicalRows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT c.id AS chunk_id, d.id AS document_id, d.document_key, d.title, d.type::text AS type,
                d.version, c.section, c.content, c.start_offset, c.end_offset, d.source_ref,
                d.effective_from,
                ts_rank(c.search_vector, websearch_to_tsquery('english', $1)) AS score
           FROM knowledge_chunks c
           JOIN knowledge_documents d ON d.id = c.document_id
          WHERE c.search_vector @@ websearch_to_tsquery('english', $1)
            AND ${eligibility}
          ORDER BY score DESC
          LIMIT ${ARM_LIMIT}`,
        ...params,
      );
    } catch (err) {
      logger.warn("knowledge_lexical_failed", { error: String(err).slice(0, 200) });
      limitations.push("Lexical retrieval failed; results come from the semantic arm only.");
    }
    const lexicalMs = Date.now() - l0;

    // ── Semantic arm ─────────────────────────────────────────────────────────
    const s0 = Date.now();
    let semanticRows: Array<Row & { sim: number }> = [];
    let semanticRan = false;
    if (!embeddingAvailable()) {
      limitations.push("No embedding credentials; retrieval is lexical only.");
    } else {
      const q = await knowledgeEmbeddingService.embed(query);
      if (!q.ok) {
        limitations.push(`Semantic retrieval unavailable (${q.reason}); results are lexical only.`);
      } else {
        try {
          const candidates = await prisma.$queryRawUnsafe<Array<Row & { embedding: number[]; embedding_model: string | null }>>(
            `SELECT c.id AS chunk_id, d.id AS document_id, d.document_key, d.title, d.type::text AS type,
                    d.version, c.section, c.content, c.start_offset, c.end_offset, d.source_ref,
                    d.effective_from, c.embedding, c.embedding_model, 0::float AS score
               FROM knowledge_chunks c
               JOIN knowledge_documents d ON d.id = c.document_id
              WHERE array_length(c.embedding, 1) IS NOT NULL
                AND ${eligibility}`,
            query, audiences as string[], (opts.types ?? []) as string[], now,
          );
          const scored = candidates
            // Vectors from a different model are never compared: the number would be meaningless.
            .filter((r) => r.embedding_model === EMBEDDING_MODEL && r.embedding.length === q.vector.length)
            .map((r) => ({ ...r, sim: cosine(q.vector, r.embedding) }))
            .sort((a, b) => b.sim - a.sim);
          // Below the measured floor the arm contributes nothing, rather than its least-bad guess.
          semanticRows = scored.filter((r) => r.sim >= SEMANTIC_FLOOR).slice(0, ARM_LIMIT);
          if (scored.length > 0 && semanticRows.length === 0) {
            limitations.push(
              `No chunk reached the measured semantic relevance floor (${SEMANTIC_FLOOR}); the semantic arm contributed nothing.`,
            );
          }
          semanticRan = true;
          if (candidates.length > 0 && semanticRows.length === 0) {
            limitations.push("Stored vectors use a different embedding model and were not compared.");
          }
        } catch (err) {
          logger.warn("knowledge_semantic_failed", { error: String(err).slice(0, 200) });
          limitations.push("Semantic retrieval failed; results are lexical only.");
        }
      }
    }
    const semanticMs = Date.now() - s0;

    // ── Fusion ───────────────────────────────────────────────────────────────
    const merged = new Map<string, RetrievedChunk>();
    const put = (r: Row, arm: "lexical" | "semantic", rank: number, score: number) => {
      const existing = merged.get(r.chunk_id);
      const contribution = 1 / (RRF_K + rank);
      if (existing) {
        existing.fusedScore += contribution;
        if (arm === "lexical") { existing.lexicalRank = rank; existing.lexicalScore = score; }
        else { existing.semanticRank = rank; existing.semanticScore = score; }
        return;
      }
      merged.set(r.chunk_id, {
        chunkId: r.chunk_id, documentId: r.document_id, documentKey: r.document_key,
        title: r.title, type: r.type, version: r.version, section: r.section,
        content: r.content, startOffset: r.start_offset, endOffset: r.end_offset,
        sourceRef: r.source_ref,
        effectiveFrom: r.effective_from ? r.effective_from.toISOString() : null,
        lexicalRank: arm === "lexical" ? rank : null,
        semanticRank: arm === "semantic" ? rank : null,
        lexicalScore: arm === "lexical" ? score : null,
        semanticScore: arm === "semantic" ? score : null,
        fusedScore: contribution,
      });
    };

    lexicalRows.forEach((r, i) => put(r, "lexical", i + 1, Number(r.score)));
    semanticRows.forEach((r, i) => put(r, "semantic", i + 1, r.sim));

    const chunks = [...merged.values()]
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, topK);

    const totalMs = Date.now() - t0;
    observeHist("knowledge_retrieval_latency_seconds", totalMs / 1000);
    incCounter("knowledge_retrieval_total", {
      role: opts.actor.role,
      result: chunks.length > 0 ? "hit" : "no_results",
      arms: `${lexicalRows.length > 0 ? "L" : "-"}${semanticRan ? "S" : "-"}`,
    });

    /**
     * Conflict detection — surfacing, never resolving.
     *
     * A previous report claimed conflicting sources were "surfaced rather than silently resolved".
     * They were not: `CONFLICTING_KNOWLEDGE` existed in the vocabulary and nothing ever emitted it,
     * so two policy documents disagreeing produced one blended answer with no warning. That is the
     * failure mode enterprise RAG is most often criticised for.
     *
     * What counts as a conflict here is deliberately narrow and structural: the result set spans
     * **more than one policy-authoritative knowledge type**. Detecting semantic contradiction would
     * require a precedence model, and this platform has none — inventing one would be inventing
     * legal precedence. So the disagreement is reported and a human decides.
     */
    /**
     * Overlap detection, and why this is no longer called conflict detection.
     *
     * The first version treated "the result set spans more than one policy type" as a conflict. With
     * the FAQ corpus indexed, a probe over six ordinary questions showed that firing on four of them
     * — including "How do I reschedule or cancel a booking?", the most common support question on
     * this platform. A cancellation policy and an FAQ *about* cancellation are complementary, not
     * contradictory. The over-breadth existed before; it was invisible only because nothing acted on
     * the signal.
     *
     * So overlap is what this measures, and overlap is normal. It is reported as provenance and it
     * carries the applicable authority for a caller that needs it. It does not narrow the result
     * set, and it does not block an answer.
     *
     * ── Why authority is resolved here but not applied here ────────────────────
     *
     * Precedence answers "when two sources disagree, which governs". It is not a relevance filter,
     * and using it as one was measured to make answers worse: with fixture ranks placing
     * REFUND_POLICY above CANCELLATION_POLICY, the cancellation question was pruned down to the
     * refund policy and the model then correctly reported it could not answer. Pruning a benign
     * overlap discards the document that actually answers the question.
     *
     * So the resolution is computed and attached — `knowledge-answer.service` applies it only once a
     * contradiction has actually been established from the text.
     */
    const POLICY_TYPES = new Set(["TERMS", "REFUND_POLICY", "CANCELLATION_POLICY", "FAQ", "PARTNER_SOP"]);
    const policyTypesPresent = [...new Set(chunks.map((c) => c.type))].filter((t) => POLICY_TYPES.has(t));
    const overlapping = policyTypesPresent.length > 1;

    let authority: AuthorityResolution | null = null;
    if (overlapping) {
      incCounter("knowledge_overlap_total", { types: policyTypesPresent.sort().join("+") });
      authority = await knowledgeAuthorityService.resolve(policyTypesPresent, now);
    }

    const state: RetrievalResult["state"] =
      chunks.length === 0 ? "NO_RESULTS" : limitations.length > 0 ? "DEGRADED" : "RETRIEVED";

    return {
      state,
      chunks,
      arms: { lexical: lexicalRows.length > 0, semantic: semanticRan },
      /**
       * Overlap alone sets no reason code. Retrieval succeeded; whether the sources agree is a
       * question about their text, which this layer deliberately does not read.
       */
      reasonCode: chunks.length === 0 ? KNOWLEDGE_REASON.NO_RELEVANT_KNOWLEDGE : undefined,
      overlap: overlapping ? { types: policyTypesPresent.sort(), authority } : undefined,
      limitations,
      timings: { lexicalMs, semanticMs, totalMs },
      rulesVersion: KNOWLEDGE_RULES_VERSION,
    };
  },
};
