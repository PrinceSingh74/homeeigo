/**
 * Phase 11 — the contracts the enterprise knowledge layer speaks in.
 *
 * ── Two kinds of truth, kept apart ─────────────────────────────────────────────
 *
 * A knowledge document says what the *rule* is. A business service says what is *currently
 * happening*. "The cancellation policy allows a free cancellation two hours before" and "this
 * booking is still cancellable" are different claims from different systems, and merging them is how
 * a policy document becomes an eligibility decision it was never entitled to make.
 *
 * `AnswerKind` exists to keep that line visible in the response itself.
 */

import type { AuthorityResolution } from "./knowledge-authority.service";

/**
 * Bumped from `knowledge.v1` when conflict resolution by declared authority was added. The version
 * appears on every retrieval result, so an answer recorded under `v1` is known to predate the
 * authority model rather than merely to have found no conflict.
 */
export const KNOWLEDGE_RULES_VERSION = "knowledge.v2";

/** Why retrieval or generation could not produce a grounded answer. Never a silent empty result. */
export const KNOWLEDGE_REASON = {
  NO_RELEVANT_KNOWLEDGE: "NO_RELEVANT_KNOWLEDGE",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  KNOWLEDGE_NOT_AUTHORIZED: "KNOWLEDGE_NOT_AUTHORIZED",
  KNOWLEDGE_STALE: "KNOWLEDGE_STALE",
  POLICY_NOT_APPROVED: "POLICY_NOT_APPROVED",
  CONFLICTING_KNOWLEDGE: "CONFLICTING_KNOWLEDGE",
  ANSWER_REQUIRES_LIVE_BUSINESS_DATA: "ANSWER_REQUIRES_LIVE_BUSINESS_DATA",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  /**
   * The prompt firewall rejected the request before it reached a provider.
   *
   * Distinct from MODEL_UNAVAILABLE because the cause is entirely different and the fix is too: the
   * model is fine, and something in the retrieved *document text* tripped the injection detector. A
   * conflict E2E surfaced this — a fixture containing "Ignore previous instructions" was blocked,
   * and reporting it as a model outage would have sent an operator to look at the provider instead
   * of at the document that needs withdrawing.
   */
  KNOWLEDGE_CONTENT_BLOCKED: "KNOWLEDGE_CONTENT_BLOCKED",
  EMBEDDING_UNAVAILABLE: "EMBEDDING_UNAVAILABLE",
  EXTERNAL_ARTIFACT_REQUIRED: "EXTERNAL_ARTIFACT_REQUIRED",
  HUMAN_DECISION_REQUIRED: "HUMAN_DECISION_REQUIRED",
} as const;
export type KnowledgeReason = (typeof KNOWLEDGE_REASON)[keyof typeof KNOWLEDGE_REASON];

/** Ingestion failure states. Each names the stage that failed, never a generic error. */
export const INGEST_STATE = {
  OK: "OK",
  INVALID_DOCUMENT: "INVALID_DOCUMENT",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  MISSING_APPROVAL: "MISSING_APPROVAL",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  CHUNKING_FAILED: "CHUNKING_FAILED",
  EMBEDDING_FAILED: "EMBEDDING_FAILED",
  INDEX_FAILED: "INDEX_FAILED",
  NOT_RETRIEVAL_ELIGIBLE: "NOT_RETRIEVAL_ELIGIBLE",
} as const;
export type IngestState = (typeof INGEST_STATE)[keyof typeof INGEST_STATE];

/**
 * Who is asking, resolved before anything is retrieved.
 *
 * Permission is an input to the query, not a filter applied to its results. That ordering is the
 * whole security model: unauthorised knowledge never enters the candidate set, so it can never
 * reach the model's context and be "ignored".
 */
export type KnowledgeActor = {
  actorId: string;
  role: "admin" | "support" | "partner" | "customer" | "anonymous";
};

/** One retrieved chunk with everything a citation needs to be checkable. */
export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentKey: string;
  title: string;
  type: string;
  version: number;
  section: string | null;
  content: string;
  startOffset: number;
  endOffset: number;
  sourceRef: string;
  effectiveFrom: string | null;
  /** Measured, never fabricated. Null when that retrieval arm did not return this chunk. */
  lexicalRank: number | null;
  semanticRank: number | null;
  lexicalScore: number | null;
  semanticScore: number | null;
  /** Reciprocal-rank-fusion score. A ranking number, explicitly not a probability of correctness. */
  fusedScore: number;
};

export type RetrievalResult = {
  state: "RETRIEVED" | "NO_RESULTS" | "NOT_AUTHORIZED" | "DEGRADED";
  chunks: RetrievedChunk[];
  /** Which arms actually ran. A semantic outage is reported, not silently dropped. */
  arms: { lexical: boolean; semantic: boolean };
  reasonCode?: KnowledgeReason;
  /**
   * Present when two or more policy-authoritative types were retrieved.
   *
   * Deliberately named overlap, not conflict. Overlap is common and usually benign — an FAQ and the
   * cancellation policy both covering cancellation is the system working, and every source stays in
   * the result. `authority` is the precedence that *would* apply if these sources turned out to
   * disagree; it is carried, not applied. Whether they actually disagree is established from their
   * text in the answer layer, never from this histogram of types.
   */
  overlap?: {
    types: string[];
    authority: AuthorityResolution | null;
  };
  limitations: string[];
  timings: { lexicalMs: number; semanticMs: number; totalMs: number };
  rulesVersion: string;
};

/**
 * What kind of claim an answer is making. Keeps policy text apart from live business state.
 *
 * `REQUIRES_HUMAN_REVIEW` was added with the authority model. It is not a refusal — approved,
 * relevant sources were found — and it is not an answer either: two policy documents were retrieved,
 * no declared precedence says which governs, and merging them would produce a confident statement
 * the platform has no basis for. The sources are returned so a person can read them and decide.
 */
export type AnswerKind = "KNOWLEDGE" | "REFUSAL" | "REQUIRES_LIVE_DATA" | "REQUIRES_HUMAN_REVIEW";

export type Citation = {
  documentKey: string;
  title: string;
  type: string;
  version: number;
  section: string | null;
  chunkId: string;
  sourceRef: string;
};

export type GroundedAnswer = {
  kind: AnswerKind;
  answer: string;
  /** True only when the model answered from retrieved text. A retrieval alone never sets it. */
  grounded: boolean;
  citations: Citation[];
  retrieval: RetrievalResult;
  refusalReason?: KnowledgeReason;
  model: { provider: string | null; model: string | null; latencyMs: number | null };
  limitations: string[];
  generatedAt: string;
  rulesVersion: string;
};
