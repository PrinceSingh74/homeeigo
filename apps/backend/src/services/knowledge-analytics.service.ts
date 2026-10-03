import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { KNOWLEDGE_RULES_VERSION } from "./knowledge.types";
import { embeddingAvailable, EMBEDDING_MODEL, observedEmbeddingDim } from "./knowledge-embedding.service";

/**
 * Phase 11 — knowledge base analytics.
 *
 * ── Only what the tables can answer ────────────────────────────────────────────
 *
 * Every number is a `GROUP BY` over rows the platform actually wrote. Measures the audit asks for
 * that have no source — retrieval counts, permission denials, grounded-answer rate — are returned as
 * explicit `unmeasurable` entries naming what is missing, because those live in Prometheus counters
 * and are not queryable from Postgres. Reporting them as zero would be a different claim entirely.
 */
export const knowledgeAnalyticsService = {
  async summary(): Promise<Record<string, unknown>> {
    const generatedAt = new Date().toISOString();
    try {
      const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
      const [totals, byType, byStatus, byAudience, byIndex, chunkStats, staleIndex] = await Promise.all([
        q<{ documents: number; chunks: number; embedded: number }>(
          `SELECT (SELECT count(*) FROM knowledge_documents)::int documents,
                  (SELECT count(*) FROM knowledge_chunks)::int chunks,
                  (SELECT count(*) FROM knowledge_chunks WHERE array_length(embedding,1) IS NOT NULL)::int embedded`),
        q<{ k: string; n: number }>(`SELECT type::text k, count(*)::int n FROM knowledge_documents GROUP BY 1 ORDER BY 1`),
        q<{ k: string; n: number }>(`SELECT status::text k, count(*)::int n FROM knowledge_documents GROUP BY 1 ORDER BY 1`),
        q<{ k: string; n: number }>(`SELECT audience::text k, count(*)::int n FROM knowledge_documents GROUP BY 1 ORDER BY 1`),
        q<{ k: string; n: number }>(`SELECT index_state::text k, count(*)::int n FROM knowledge_documents GROUP BY 1 ORDER BY 1`),
        q<{ avg_tokens: number | null; max_tokens: number | null; docs_with_chunks: number }>(
          `SELECT avg(token_estimate)::int avg_tokens, max(token_estimate)::int max_tokens,
                  count(DISTINCT document_id)::int docs_with_chunks FROM knowledge_chunks`),
        /**
         * Index consistency: a document flagged INDEXED that still holds a chunk with no vector.
         *
         * That state is a lie the retrieval path acts on. `index_state` is what an operator reads
         * and what the console reports, while the semantic arm only ever sees chunks that actually
         * carry a vector — so a partially-embedded document reports as fully indexed and answers
         * silently from a fraction of its text. Measured rather than assumed absent.
         */
        q<{ n: number }>(
          `SELECT count(*)::int n FROM knowledge_documents d
            WHERE d.index_state = 'INDEXED'
              AND EXISTS (SELECT 1 FROM knowledge_chunks c
                           WHERE c.document_id = d.id AND array_length(c.embedding,1) IS NULL)`),
      ]);

      const t = totals[0] ?? { documents: 0, chunks: 0, embedded: 0 };
      const tally = (rows: Array<{ k: string; n: number }>) =>
        Object.fromEntries(rows.map((r) => [r.k, r.n]));
      const statuses = tally(byStatus);

      return {
        generatedAt,
        rulesVersion: KNOWLEDGE_RULES_VERSION,
        documents: t.documents,
        approvedDocuments: statuses.APPROVED ?? 0,
        chunks: t.chunks,
        embeddedChunks: t.embedded,
        /** Share of chunks carrying a vector. Null rather than 0 when there are no chunks at all. */
        embeddingCoverage: t.chunks === 0
          ? { value: null, numerator: 0, denominator: 0, reasonCode: "INSUFFICIENT_EVIDENCE" }
          : { value: Math.round((t.embedded / t.chunks) * 10000) / 10000, numerator: t.embedded, denominator: t.chunks },
        distributions: {
          type: tally(byType), status: tally(byStatus),
          audience: tally(byAudience), indexState: tally(byIndex),
        },
        chunking: chunkStats[0] ?? { avg_tokens: null, max_tokens: null, docs_with_chunks: 0 },
        embedding: {
          model: EMBEDDING_MODEL,
          available: embeddingAvailable(),
          /** Observed from a real provider response, never a hardcoded constant. */
          observedDimension: observedEmbeddingDim(),
        },
        indexConsistency: {
          documentsMarkedIndexedWithUnembeddedChunks: staleIndex[0]?.n ?? 0,
        },
        /** Measures with no queryable source. Named, never reported as zero. */
        unmeasurable: [
          { metric: "retrievalRequests", missingSource: "counted in Prometheus (knowledge_retrieval_total), not persisted to Postgres" },
          { metric: "permissionDenials", missingSource: "a denied retrieval returns zero rows; there is no denial row to count" },
          { metric: "groundedAnswerRate", missingSource: "answers are not persisted; only the Prometheus counter exists" },
          { metric: "providerFallbackRate", missingSource: "owned by the AI Gateway's own telemetry, not by this service" },
        ],
      };
    } catch (err) {
      logger.warn("knowledge_analytics_unavailable", { error: String(err).slice(0, 200) });
      return {
        generatedAt, state: "SOURCE_UNAVAILABLE",
        detail: "Knowledge analytics could not be read.",
      };
    }
  },
};
