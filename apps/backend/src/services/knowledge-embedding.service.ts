import crypto from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, observeHist } from "../lib/metrics";
import { aiConfig } from "../ai/config";
import { checkAiRateLimit } from "../ai/rate-limit/ai-rate-limit";
import { recordAiRequest } from "../ai/audit/ai-audit.service";
import { hashContent } from "../ai/security/prompt-security";
import { recordEmbeddingSpend } from "./ai-budget.service";

/**
 * Phase 11 — embeddings for the knowledge base.
 *
 * ── Why this is not another provider abstraction ───────────────────────────────
 *
 * The AI Gateway routes *chat completions* through GROQ → GEMINI → OPENAI. Embeddings are a
 * different endpoint with a different response shape and no failover chain in this project, so
 * sending them through the completion gateway would mean widening that gateway for a payload it was
 * never designed to carry. This module reuses the gateway's **credentials and configuration**
 * (`aiConfig.gemini`) and adds one endpoint call — it does not introduce a second provider registry,
 * a second key source, or a second model catalogue.
 *
 * ── Vector compatibility is enforced, not assumed ──────────────────────────────
 *
 * Every stored vector records the model that produced it, and retrieval refuses to compare vectors
 * from different models. Comparing a 768-dimension vector to a 1,536-dimension one silently produces
 * a number, and that number is meaningless — which is exactly the kind of failure that looks like
 * working retrieval.
 */

/**
 * The embedding model, chosen by asking the provider rather than by assumption.
 *
 * An earlier constant said `text-embedding-004` and every call returned HTTP 404 — the key's model
 * list offers `gemini-embedding-001`. The dimension is recorded from the first successful response
 * rather than hardcoded, because a wrong constant here silently produces vectors that compare
 * against nothing.
 */
export const EMBEDDING_MODEL = "gemini-embedding-001";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

/** Observed dimension of the first successful embedding. Reported, never assumed. */
let observedDim: number | null = null;
export function observedEmbeddingDim(): number | null { return observedDim; }
const TIMEOUT_MS = 15_000;

export type EmbedResult =
  | { ok: true; vector: number[]; model: string; dim: number }
  | { ok: false; reason: "NO_CREDENTIALS" | "PROVIDER_ERROR" | "INVALID_RESPONSE" | "RATE_LIMITED"; detail: string };

/** True when an embedding call can even be attempted. Checked before work is queued, not after. */
export function embeddingAvailable(): boolean {
  return Boolean(aiConfig.gemini.apiKey);
}

export const knowledgeEmbeddingService = {
  /**
   * Embed one piece of text.
   *
   * Never throws. A provider outage returns a typed failure so the caller can mark the document
   * `EMBEDDING_FAILED` and carry on serving lexical retrieval — a knowledge base that answers
   * nothing because one vector call failed is worse than one that answers lexically and says so.
   */
  async embed(text: string, actor?: { actorId: string; actorRole: "ADMIN" | "SUPPORT" | "SYSTEM" }): Promise<EmbedResult> {
    const key = aiConfig.gemini.apiKey;
    if (!key) {
      return { ok: false, reason: "NO_CREDENTIALS", detail: "GEMINI_API_KEY is not configured." };
    }

    /**
     * ── Governance for a path that had none ─────────────────────────────────────
     *
     * This called Gemini's `embedContent` endpoint by raw `fetch`, so it reached a paid provider
     * without the rate limit, the request accounting or the AI audit trail — and it runs on
     * **every RAG query**, not occasionally. The Phase-14 bypass guard did not catch it because
     * that guard looks for the named adapter functions (`callGemini`, `callGeminiVision`), and a
     * raw fetch to the provider host uses none of them. The guard has since been widened.
     *
     * The controls are applied here rather than by routing through `invokeAiGateway`, for the
     * reason the header already gives: embeddings are a different endpoint with a different
     * response shape and no failover chain, and widening the completion gateway to carry them
     * would bend it around a payload it was never designed for.
     */
    const who = actor ?? { actorId: "system:knowledge", actorRole: "SYSTEM" as const };
    const rate = await checkAiRateLimit(who.actorId, who.actorRole);
    if (!rate.allowed) {
      incCounter("knowledge_embedding_total", { result: "rate_limited" });
      return { ok: false, reason: "RATE_LIMITED", detail: "AI rate limit exceeded for this actor." };
    }

    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text: text.slice(0, 8_000) }] },
        }),
        signal: controller.signal,
      });
      observeHist("knowledge_embedding_latency_seconds", (Date.now() - t0) / 1000);

      if (!res.ok) {
        incCounter("knowledge_embedding_total", { result: "provider_error" });
        return { ok: false, reason: "PROVIDER_ERROR", detail: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const vector = body.embedding?.values;
      if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
        incCounter("knowledge_embedding_total", { result: "invalid_response" });
        return { ok: false, reason: "INVALID_RESPONSE", detail: "No usable embedding vector in response." };
      }
      incCounter("knowledge_embedding_total", { result: "ok" });
      observedDim ??= vector.length;

      /**
       * Cost is recorded as **UNKNOWN**, not computed.
       *
       * `computeTokenCostDetailed` would happily return a number for GEMINI — but its price table
       * is for *generation*, and embeddings are billed at a different, much lower rate. Pricing an
       * embedding with the generation table would put a wrong figure into the spend accounting and
       * make it look measured. An honest UNKNOWN is counted separately and never folded in as zero,
       * which is the same distinction Phase 13 established for unpriced providers.
       */
      /**
       * Logged, not swallowed.
       *
       * These were `.catch(() => undefined)`, which made this path weaker than the gateway's own —
       * there `recordAiRequest` sits inside a `Promise.all` and its failure fails the request. An
       * embedding is a read-side operation and failing a RAG query because an audit row did not
       * write would be disproportionate, so these stay non-fatal. Silent is a different matter: an
       * accounting increment that vanishes makes the spend undercount invisible, which is the
       * failure mode this whole line of work exists to prevent.
       */
      await recordEmbeddingSpend({ provider: "GEMINI", actorRole: who.actorRole }).catch((err) => {
        logger.warn("knowledge_embedding_spend_unrecorded", {
          category: "APPLICATION",
          error: err instanceof Error ? err.message : String(err),
        });
        incCounter("knowledge_embedding_total", { result: "spend_unrecorded" });
      });
      await recordAiRequest({
        requestId: crypto.randomUUID(),
        actorId: who.actorId,
        actorRole: who.actorRole,
        templateId: "knowledge.embed",
        // The embedded text is never stored or logged; its hash makes the record traceable.
        promptHash: hashContent(text),
        provider: "GEMINI",
        status: "SUCCESS",
        latencyMs: Date.now() - t0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        fallbackUsed: false,
      }).catch((err) => {
        logger.warn("knowledge_embedding_audit_failed", {
          category: "APPLICATION",
          error: err instanceof Error ? err.message : String(err),
        });
        incCounter("knowledge_embedding_total", { result: "audit_failed" });
      });

      return { ok: true, vector, model: EMBEDDING_MODEL, dim: vector.length };
    } catch (err) {
      incCounter("knowledge_embedding_total", { result: "error" });
      return { ok: false, reason: "PROVIDER_ERROR", detail: String(err).slice(0, 160) };
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Embed every chunk of a document and mark its index state.
   *
   * Partial success is a real outcome and is recorded as one: if some chunks embed and others do
   * not, the document is `EMBEDDING_FAILED` rather than `INDEXED`, because a half-embedded document
   * would answer some questions and silently miss others.
   */
  async indexDocument(documentId: string): Promise<{ ok: boolean; embedded: number; total: number; detail: string }> {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { documentId },
      select: { id: true, content: true },
      orderBy: { chunkIndex: "asc" },
    });
    if (chunks.length === 0) {
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { indexState: "INDEX_FAILED", indexError: "No chunks to embed." },
      });
      return { ok: false, embedded: 0, total: 0, detail: "No chunks to embed." };
    }

    if (!embeddingAvailable()) {
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { indexState: "EMBEDDING_FAILED", indexError: "NO_CREDENTIALS" },
      });
      return {
        ok: false, embedded: 0, total: chunks.length,
        detail: "No embedding credentials; lexical retrieval remains available for this document.",
      };
    }

    let embedded = 0;
    let lastError = "";
    for (const chunk of chunks) {
      const r = await this.embed(chunk.content);
      if (!r.ok) { lastError = `${r.reason}: ${r.detail}`; continue; }
      await prisma.knowledgeChunk.update({
        where: { id: chunk.id },
        data: { embedding: r.vector, embeddingModel: r.model },
      });
      embedded++;
    }

    const complete = embedded === chunks.length;
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        indexState: complete ? "INDEXED" : "EMBEDDING_FAILED",
        indexedAt: complete ? new Date() : null,
        indexError: complete ? null : lastError.slice(0, 500),
        embeddingModel: EMBEDDING_MODEL,
        embeddingDim: observedDim,
      },
    });
    logger.info("knowledge_indexed", { documentId, embedded, total: chunks.length, complete });
    return {
      ok: complete, embedded, total: chunks.length,
      detail: complete
        ? `All ${embedded} chunks embedded with ${EMBEDDING_MODEL}.`
        : `${embedded} of ${chunks.length} chunks embedded; document marked EMBEDDING_FAILED.`,
    };
  },
};
